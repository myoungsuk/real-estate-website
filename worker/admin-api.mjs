import { AccessAuthError, authenticateAccess } from "./access-auth.mjs";
import { validateAdminResource } from "./admin-resource-validation.mjs";
import { AdminWriteError, createCsrfToken, isAdminWriteEnabled, validateAdminWriteRequest } from "./admin-security.mjs";
import { GithubContentError, readAdminResource, uploadAdminImage, writeAdminResource } from "./github-content.mjs";
import { createRequestId, errorResponse, jsonResponse } from "./http.mjs";
import { fetchExternalLinkPreview } from "./link-preview.mjs";

const API_VERSION_ROOT = "/api/admin/v1";
const READ_ONLY_PATHS = new Set([
  `${API_VERSION_ROOT}/health`,
  `${API_VERSION_ROOT}/session`,
  `${API_VERSION_ROOT}/system`,
]);

function maskEmail(email) {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "관리자";
  const visible = local.slice(0, 1);
  return `${visible}${"*".repeat(Math.max(3, local.length - 1))}@${domain}`;
}

function successResponse(data, requestId, status = 200) {
  return jsonResponse(
    { ok: true, data, requestId },
    { status, headers: { "X-Request-Id": requestId } },
  );
}

async function readJsonBody(request) {
  const contentLength = Number(request.headers.get("Content-Length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 3 * 1024 * 1024) {
    throw new AdminWriteError("REQUEST_TOO_LARGE", "요청 데이터가 너무 큽니다.", 413);
  }
  try {
    return await request.json();
  } catch {
    throw new AdminWriteError("JSON_INVALID", "JSON 요청 내용을 읽지 못했습니다.", 400);
  }
}

function operationErrorResponse(error, requestId) {
  if (error instanceof AdminWriteError || error instanceof GithubContentError) {
    return errorResponse({
      code: error.code,
      message: error.message,
      requestId,
      status: error.status,
      retryable: error.status >= 500,
    });
  }
  return errorResponse({
    code: "ADMIN_OPERATION_FAILED",
    message: "관리자 요청을 처리하지 못했습니다.",
    requestId,
    status: 500,
    retryable: true,
  });
}

export async function handleAdminApi(request, env, options = {}) {
  const requestId = createRequestId();
  const authenticate = options.authenticate ?? authenticateAccess;
  const readResource = options.readResource ?? readAdminResource;
  const writeResource = options.writeResource ?? writeAdminResource;
  const uploadImage = options.uploadImage ?? uploadAdminImage;
  const fetchLinkPreview = options.fetchLinkPreview ?? fetchExternalLinkPreview;

  let actor;
  try {
    actor = await authenticate(request, env);
  } catch (error) {
    if (error instanceof AccessAuthError) {
      const message = error.code.startsWith("AUTH_CONFIG_")
        ? "관리자 인증 설정이 완료되지 않았습니다."
        : error.message;
      return errorResponse({
        code: error.code,
        message,
        requestId,
        status: error.status,
        retryable: error.status === 503,
      });
    }
    return errorResponse({
      code: "AUTH_UNAVAILABLE",
      message: "관리자 인증을 확인하지 못했습니다.",
      requestId,
      status: 503,
      retryable: true,
    });
  }

  const url = new URL(request.url);
  const writeEnabled = isAdminWriteEnabled(env);

  if (request.method === "GET" && url.pathname === `${API_VERSION_ROOT}/health`) {
    return successResponse(
      {
        service: "leaderscityhappy-admin-api",
        status: "ready",
        runtime: "workers-static-assets-same-worker",
      },
      requestId,
    );
  }

  if (request.method === "GET" && url.pathname === `${API_VERSION_ROOT}/session`) {
    const csrfToken = writeEnabled
      ? await createCsrfToken(actor.email, env.ADMIN_CSRF_SECRET)
      : null;
    return successResponse(
      {
        authenticated: true,
        administrator: maskEmail(actor.email),
        authentication: "cloudflare-access-email-otp",
        writeEnabled,
        csrfToken,
      },
      requestId,
    );
  }

  if (request.method === "GET" && url.pathname === `${API_VERSION_ROOT}/system`) {
    return successResponse(
      {
        deployment: "cloudflare-workers-static-assets",
        apiRuntime: "same-worker",
        apiVersion: "v1",
        writeEnabled,
        capabilities: writeEnabled
          ? ["health", "session", "system", "content-read", "content-write", "media-upload", "link-preview"]
          : ["health", "session", "system"],
      },
      requestId,
    );
  }

  if (READ_ONLY_PATHS.has(url.pathname)) {
    return errorResponse({
      code: "METHOD_NOT_ALLOWED",
      message: "이 관리 API 경로는 조회만 지원합니다.",
      requestId,
      status: 405,
      headers: { Allow: "GET" },
    });
  }

  const contentMatch = new RegExp(`^${API_VERSION_ROOT}/content/([a-z-]+)$`, "u").exec(url.pathname);
  if (contentMatch && request.method === "GET") {
    if (!writeEnabled) {
      return operationErrorResponse(new AdminWriteError("WRITE_DISABLED", "관리자 저장 연결이 아직 활성화되지 않았습니다.", 503), requestId);
    }
    try {
      const result = await readResource(contentMatch[1], env);
      return successResponse(result, requestId);
    } catch (error) {
      return operationErrorResponse(error, requestId);
    }
  }

  if (contentMatch && request.method === "PUT") {
    try {
      await validateAdminWriteRequest(request, actor, env);
      const body = await readJsonBody(request);
      const errors = validateAdminResource(contentMatch[1], body.data);
      if (errors.length > 0) {
        return errorResponse({
          code: "CONTENT_VALIDATION_FAILED",
          message: "공개 콘텐츠 입력값을 다시 확인해 주세요.",
          details: errors,
          requestId,
          status: 422,
        });
      }
      const result = await writeResource(contentMatch[1], body.data, body.sha, env);
      return successResponse(result, requestId);
    } catch (error) {
      return operationErrorResponse(error, requestId);
    }
  }

  if (url.pathname === `${API_VERSION_ROOT}/media` && request.method === "POST") {
    try {
      await validateAdminWriteRequest(request, actor, env);
      const body = await readJsonBody(request);
      const result = await uploadImage(body, env);
      return successResponse(result, requestId, 201);
    } catch (error) {
      return operationErrorResponse(error, requestId);
    }
  }

  if (url.pathname === `${API_VERSION_ROOT}/external-links/preview` && request.method === "POST") {
    try {
      await validateAdminWriteRequest(request, actor, env);
      const body = await readJsonBody(request);
      const result = await fetchLinkPreview(body);
      return successResponse(result, requestId);
    } catch (error) {
      return operationErrorResponse(error, requestId);
    }
  }

  if (contentMatch) {
    return errorResponse({
      code: "METHOD_NOT_ALLOWED",
      message: "이 콘텐츠 경로에서는 조회와 저장만 지원합니다.",
      requestId,
      status: 405,
      headers: { Allow: "GET, PUT" },
    });
  }

  if (url.pathname === `${API_VERSION_ROOT}/media`) {
    return errorResponse({
      code: "METHOD_NOT_ALLOWED",
      message: "이미지 업로드는 POST 요청만 지원합니다.",
      requestId,
      status: 405,
      headers: { Allow: "POST" },
    });
  }


  if (url.pathname === `${API_VERSION_ROOT}/external-links/preview`) {
    return errorResponse({
      code: "METHOD_NOT_ALLOWED",
      message: "링크 미리보기는 POST 요청만 지원합니다.",
      requestId,
      status: 405,
      headers: { Allow: "POST" },
    });
  }

  return errorResponse({
    code: "NOT_FOUND",
    message: "관리 API 경로를 찾을 수 없습니다.",
    requestId,
    status: 404,
  });
}
