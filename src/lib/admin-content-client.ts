interface ApiErrorBody {
  code?: string;
  message?: string;
  details?: string[];
}

interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: ApiErrorBody;
  requestId?: string;
}

class AdminApiError extends Error {
  code: string | null;
  status: number;

  constructor(message: string, { code = null, status = 0 }: { code?: string | null; status?: number } = {}) {
    super(message);
    this.name = "AdminApiError";
    this.code = code;
    this.status = status;
  }
}

export interface AdminSession {
  authenticated: boolean;
  administrator: string;
  authentication: string;
  writeEnabled: boolean;
  csrfToken: string | null;
}

export interface AdminResource<T> {
  resource: string;
  sha: string;
  data: T;
}

let sessionPromise: Promise<AdminSession> | null = null;

async function readEnvelope<T>(response: Response) {
  const type = (response.headers.get("Content-Type") ?? "").split(";", 1)[0].trim().toLowerCase();
  if (type !== "application/json") {
    throw new AdminApiError(
      response.redirected || [401, 403].includes(response.status)
        ? "관리자 로그인이 만료되었거나 Access 인증이 필요합니다. 페이지를 새로고침해 다시 로그인해 주세요."
        : "관리자 API가 예상하지 못한 응답을 반환했습니다.",
      { status: response.status },
    );
  }

  let body: ApiEnvelope<T>;
  try {
    body = await response.json() as ApiEnvelope<T>;
  } catch {
    throw new AdminApiError("관리자 API 응답을 읽지 못했습니다.", { status: response.status });
  }
  if (!response.ok || !body.ok || !body.data) {
    const details = body.error?.details?.length ? `\n${body.error.details.join("\n")}` : "";
    throw new AdminApiError(
      `${body.error?.message ?? "관리자 요청을 처리하지 못했습니다."}${details}`,
      { code: body.error?.code ?? null, status: response.status },
    );
  }
  return body.data;
}

export function getAdminSession({ refresh = false } = {}) {
  if (refresh || !sessionPromise) {
    const nextSessionPromise = fetch("/api/admin/v1/session", {
      headers: { Accept: "application/json" },
      credentials: "same-origin",
    })
      .then((response) => readEnvelope<AdminSession>(response));
    sessionPromise = nextSessionPromise;
    void nextSessionPromise.catch(() => {
      if (sessionPromise === nextSessionPromise) {
        sessionPromise = null;
      }
    });
  }
  return sessionPromise;
}

async function withWritableSession<T>(disabledMessage: string, request: (csrfToken: string) => Promise<Response>) {
  let session = await getAdminSession();
  if (!session.writeEnabled || !session.csrfToken) throw new Error(disabledMessage);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await request(session.csrfToken);
    try {
      return await readEnvelope<T>(response);
    } catch (error) {
      if (!(error instanceof AdminApiError) || error.code !== "CSRF_INVALID" || attempt > 0) throw error;
      session = await getAdminSession({ refresh: true });
      if (!session.writeEnabled || !session.csrfToken) throw new Error(disabledMessage);
    }
  }

  throw new Error("관리자 요청을 처리하지 못했습니다.");
}

export async function readAdminContent<T>(resource: string) {
  const response = await fetch(`/api/admin/v1/content/${resource}`, {
    headers: { Accept: "application/json" },
    credentials: "same-origin",
  });
  return readEnvelope<AdminResource<T>>(response);
}

export async function writeAdminContent<T>(resource: string, sha: string, data: T) {
  return withWritableSession<{ resource: string; commitSha: string | null; contentSha: string | null }>(
    "관리자 저장 연결이 아직 활성화되지 않았습니다.",
    (csrfToken) => fetch(`/api/admin/v1/content/${resource}`, {
      method: "PUT",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Admin-CSRF": csrfToken,
      },
      credentials: "same-origin",
      body: JSON.stringify({ sha, data }),
    }),
  );
}

export async function uploadAdminImage(category: string, dataUrl: string) {
  return withWritableSession<{ src: string; commitSha: string | null }>(
    "관리자 이미지 저장 연결이 아직 활성화되지 않았습니다.",
    (csrfToken) => fetch("/api/admin/v1/media", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Admin-CSRF": csrfToken,
      },
      credentials: "same-origin",
      body: JSON.stringify({ category, dataUrl }),
    }),
  );
}

export async function fetchExternalLinkPreview(type: "blog" | "youtube", url: string) {
  return withWritableSession<{ title: string; summary: string; thumbnailDataUrl: string | null }>(
    "관리자 링크 미리보기 연결이 아직 활성화되지 않았습니다.",
    (csrfToken) => fetch("/api/admin/v1/external-links/preview", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Admin-CSRF": csrfToken,
      },
      credentials: "same-origin",
      body: JSON.stringify({ type, url }),
    }),
  );
}

export async function convertDataUrlToWebp(dataUrl: string, maxSide = 1600, quality = 0.82) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return convertImageFileToWebp(new File([blob], "preview-image", { type: blob.type }), maxSide, quality);
}

export async function convertImageFileToWebp(file: File, maxSide = 1600, quality = 0.82) {
  if (!file.type.startsWith("image/")) throw new Error("이미지 파일을 선택해 주세요.");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("이미지를 처리하지 못했습니다.");
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const dataUrl = canvas.toDataURL("image/webp", quality);
  if (!dataUrl.startsWith("data:image/webp;base64,")) throw new Error("WebP 이미지 변환에 실패했습니다.");
  const approximateBytes = Math.ceil((dataUrl.length - dataUrl.indexOf(",") - 1) * 0.75);
  if (approximateBytes > 2 * 1024 * 1024) throw new Error("최적화 후 이미지가 2MB를 넘습니다. 더 작은 사진을 선택해 주세요.");
  return dataUrl;
}

export function setAdminFormStatus(element: HTMLElement | null, message: string, state: "idle" | "saving" | "success" | "error" = "idle") {
  if (!element) return;
  element.textContent = message;
  element.dataset.state = state;
}
