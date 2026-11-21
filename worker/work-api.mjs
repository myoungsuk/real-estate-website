// 업무 도구 API(단계 2) 진입점. admin-api.mjs가 Access JWT를 다시 검증한 뒤에만 이 함수를 부른다(설계서 5.3·10장).
// 처리 순서: 사용 여부·설정 → 스키마 버전 → (쓰기면) Origin·JSON·업무 CSRF·본문 크기 → 경로 → 감사 기록.
// 이번 단계의 경로는 GET /work/session 하나다. 손님 자료 경로는 다음 PR에서 withViewAudit·writeBatchWithAudit 위에 올린다.
import { getAuditActorId, maskEmail } from "./admin-audit.mjs";
import { errorResponse, jsonResponse } from "./http.mjs";
import { WorkApiError, createWorkCsrfToken, getWorkConfigState, validateWorkJsonWrite } from "./work-security.mjs";
import { auditStatement, withViewAudit, writeBatchWithAudit } from "./work-audit.mjs";
import { routeWorkData } from "./work-customers.mjs";
import { routeWorkDeals } from "./work-deals.mjs";
import { routeWorkEvents } from "./work-events.mjs";
import { routeWorkLedger } from "./work-ledger.mjs";
import { handlePublicToolsApi, isPublicToolsRoute } from "./work-public-tools.mjs";

// 기존 시험·다른 모듈이 쓰던 이름을 그대로 내보낸다(감사 도우미는 work-audit.mjs로 옮김).
export { withViewAudit, writeBatchWithAudit };

export const WORK_API_ROOT = "/api/admin/v1/work";
export const WORK_SCHEMA_VERSION = 5; // migrations/work 0005(단계 2 매출장부)까지. 단계 2와 단계 P가 같은 번호를 쓴다
export const MAX_WORK_JSON_BYTES = 256 * 1024;
const WRITE_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);
const RAY_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/u;

export function isWorkApiPath(pathname) {
  return pathname === WORK_API_ROOT || pathname.startsWith(`${WORK_API_ROOT}/`);
}

export function workSuccess(data, requestId) {
  return jsonResponse({ ok: true, data, requestId }, { headers: { "X-Request-Id": requestId } });
}

// 파일 응답(거래 .ics). JSON 응답(http.mjs)과 같은 보안 헤더를 달고 본문 종류·내려받기 이름만 바꾼다. 파일 이름은 ASCII(손님 정보 없음).
function workFileResponse({ body, contentType, filename }, requestId) {
  return new Response(body, {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
      "X-Request-Id": requestId,
    },
  });
}

export function workError(requestId, error, headers = {}) {
  return errorResponse({
    code: error.code,
    message: error.message,
    requestId,
    status: error.status,
    retryable: error.retryable === true,
    details: Array.isArray(error.details) ? error.details : [],
    headers,
  });
}

function rayIdOf(request) {
  const ray = request.headers.get("cf-ray") ?? "";
  return RAY_ID_PATTERN.test(ray) ? ray : null;
}

// 신원 없는 거부(Access JWT 없음·틀림·허용 이메일 아님 등)는 D1에 쓰지 않는다. 이유 코드와 Ray ID만 경고 로그로 남긴다.
// JWT 원문·이메일·IP·본문·쿼리는 남기지 않는다. 로그 실패가 거부 응답을 바꾸지 않게 한다.
export function logWorkAccessDenied(request, { requestId, reasonCode, warnLog = console.warn } = {}) {
  try {
    warnLog(JSON.stringify({ event: "work_access_denied", reason: reasonCode, rayId: rayIdOf(request), requestId }));
  } catch {
    // 로그 장애는 무시한다.
  }
}

// 신원 있는 거부(Origin·CSRF·스키마 불일치)는 D1에 outcome=denied로 남긴다(업무 꺼짐은 Worker 로그만). 기록 실패는 거부 응답을 바꾸지 않는다.
export async function recordDenied(db, actor, env, request, requestId, now, reason, auditLog, { storeInD1 = true } = {}) {
  try {
    const actorId = await getAuditActorId(actor.email, env.ADMIN_CSRF_SECRET);
    auditLog({ event: "work_denied", actorId, reason, requestId });
  } catch {
    // Worker 로그 장애는 무시한다.
  }
  if (!storeInD1 || !db || typeof db.prepare !== "function") return;
  try {
    await auditStatement(db, {
      at: new Date(now).toISOString(),
      actorEmail: actor.email,
      action: "request.denied",
      requestId,
      outcome: "denied",
      reason,
    }).run();
  } catch {
    // 기록 실패해도 거부 응답은 그대로 나간다.
  }
}

export async function readSchemaVersion(db) {
  let row;
  try {
    row = await db.prepare("SELECT value_json FROM settings WHERE key = ?").bind("schema_version").first();
  } catch (error) {
    // 배포는 됐지만 마이그레이션을 아직 적용하지 않은 D1(표 없음)은 연결 오류가 아니라 구조가 뒤처진 상태다.
    if (/no such table/iu.test(String(error?.message ?? ""))) return null;
    throw error;
  }
  if (!row) return null;
  // 값이 깨져 있으면 연결 오류(재시도)가 아니라 구조가 맞지 않는 상태로 본다.
  let value;
  try {
    value = JSON.parse(row.value_json);
  } catch {
    return null;
  }
  return Number.isSafeInteger(value) ? value : null;
}

export async function readWorkJsonBody(request) {
  const declared = Number(request.headers.get("Content-Length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_WORK_JSON_BYTES) {
    throw new WorkApiError("PAYLOAD_TOO_LARGE", "요청 본문이 너무 큽니다.", 413);
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_WORK_JSON_BYTES) {
    throw new WorkApiError("PAYLOAD_TOO_LARGE", "요청 본문이 너무 큽니다.", 413);
  }
  if (bytes.byteLength === 0) return {};
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new WorkApiError("VALIDATION_FAILED", "요청 형식이 올바르지 않습니다.", 400);
  }
}

function defaultAuditLog(entry) {
  console.info(JSON.stringify(entry));
}

// 업무 자료 처리 중 5xx: Worker 로그에 요청 ID·상태·오류 코드·오류 종류 이름만 남긴다(11.7절, error.message·입력값은 남기지 않음).
function logWorkFailure(auditLog, entry) {
  try {
    auditLog({ event: "work_request_failed", ...entry });
  } catch {
    // Worker 로그 장애는 무시한다.
  }
}

export async function handleWorkApi(request, env, options = {}) {
  const { actor, requestId } = options;
  const db = options.db ?? env?.WORK_DB;
  const now = typeof options.now === "function" ? options.now() : Date.now();
  const auditLog = options.auditLog ?? defaultAuditLog;
  const url = new URL(request.url);
  const route = url.pathname.slice(WORK_API_ROOT.length) || "/";
  const method = request.method.toUpperCase();

  // 단계 P(공개 자료 도구)는 단계 2 켜기 값과 따로 켠다. Access 재검증은 admin-api.mjs에서 이미 끝났다(설계서 22.2절).
  if (isPublicToolsRoute(route)) {
    // openaiFetch: OpenAI 요청에 쓸 fetch(시험은 가짜를 넣어 실제 OpenAI를 부르지 않음).
    return handlePublicToolsApi(request, env, {
      db, actor, requestId, now, auditLog, method, route,
      randomUUID: options.randomUUID ?? (() => crypto.randomUUID()),
      openaiFetch: options.openaiFetch ?? ((...args) => fetch(...args)),
    });
  }

  const state = getWorkConfigState(env, db);
  if (state === "config_missing") {
    return workError(requestId, new WorkApiError("WORK_CONFIG_MISSING", "업무 도구 설정이 완료되지 않았습니다.", 503));
  }
  if (state === "disabled") {
    if (method === "GET" && route === "/session") {
      return workSuccess({
        enabled: false,
        filesEnabled: false,
        aiEnabled: false,
        administrator: maskEmail(actor.email),
        csrfToken: null,
        schemaVersion: null,
        aiWarnings: [],
      }, requestId);
    }
    // 꺼진 기능은 손님 자료 DB에 쓰지 않는다. 거부는 HMAC 작업자 ID만 Worker 로그에 남긴다.
    await recordDenied(db, actor, env, request, requestId, now, "WORK_DISABLED", auditLog, { storeInD1: false });
    return workError(requestId, new WorkApiError("WORK_DISABLED", "업무 도구가 아직 켜지지 않았습니다.", 503));
  }

  let schemaVersion;
  try {
    schemaVersion = await readSchemaVersion(db);
  } catch {
    return workError(requestId, new WorkApiError("STORAGE_UNAVAILABLE", "업무 자료 저장소에 연결하지 못했습니다.", 503, true));
  }
  if (schemaVersion === null || schemaVersion < WORK_SCHEMA_VERSION) {
    await recordDenied(db, actor, env, request, requestId, now, "WORK_SCHEMA_OUTDATED", auditLog);
    return workError(requestId, new WorkApiError("WORK_SCHEMA_OUTDATED", "업무 자료 구조가 아직 준비되지 않았습니다.", 503));
  }
  if (schemaVersion > WORK_SCHEMA_VERSION) {
    // 이전 코드로 되돌린 상태에서 새 구조의 자료를 읽거나 고치지 않게 읽기·쓰기 모두 막는다.
    await recordDenied(db, actor, env, request, requestId, now, "WORK_SCHEMA_AHEAD", auditLog);
    return workError(requestId, new WorkApiError("WORK_SCHEMA_AHEAD", "업무 자료 구조가 프로그램보다 새것입니다.", 503));
  }

  let body = null;
  if (WRITE_METHODS.has(method)) {
    try {
      await validateWorkJsonWrite(request, actor, env, now);
    } catch (error) {
      if (error instanceof WorkApiError) {
        if (error.code === "ORIGIN_DENIED" || error.code === "CSRF_INVALID") {
          await recordDenied(db, actor, env, request, requestId, now, error.code, auditLog);
        }
        return workError(requestId, error);
      }
      return workError(requestId, new WorkApiError("WORK_CONFIG_MISSING", "업무 도구 설정이 완료되지 않았습니다.", 503));
    }
    try {
      body = await readWorkJsonBody(request);
    } catch (error) {
      return workError(requestId, error);
    }
  } else if (method !== "GET") {
    return workError(requestId, new WorkApiError("METHOD_NOT_ALLOWED", "허용되지 않은 요청 방식입니다.", 405), { Allow: "GET" });
  }

  if (route === "/session") {
    if (method !== "GET") {
      return workError(requestId, new WorkApiError("METHOD_NOT_ALLOWED", "허용되지 않은 요청 방식입니다.", 405), { Allow: "GET" });
    }
    return workSuccess({
      enabled: true,
      filesEnabled: false,
      aiEnabled: false,
      administrator: maskEmail(actor.email),
      csrfToken: await createWorkCsrfToken(actor.email, env.ADMIN_CSRF_SECRET, now),
      schemaVersion,
      aiWarnings: [],
    }, requestId);
  }

  // 손님·메모·검색(단계 2 PR-A), 거래·참여자(PR-B1), 일정(PR-B2), 매출장부. 경로가 맞지 않으면 null을 돌려준다.
  // legalRules: 장부 법정 상한 경고에 쓸 법령 데이터(시험만 가짜를 넣음, 없으면 legal-rules.json).
  try {
    const dataContext = { db, actor, requestId, now, method, route, url, body, randomUUID: options.randomUUID ?? (() => crypto.randomUUID()), legalRules: options.legalRules };
    const handled = (await routeWorkData(dataContext)) ?? (await routeWorkDeals(dataContext)) ?? (await routeWorkEvents(dataContext))
      ?? (await routeWorkLedger(dataContext));
    if (handled?.raw) return workFileResponse(handled.raw, requestId);
    if (handled) return jsonResponse({ ok: true, data: handled.data, requestId }, { status: handled.status ?? 200, headers: { "X-Request-Id": requestId } });
  } catch (error) {
    if (error instanceof WorkApiError) {
      if (error.status >= 500) logWorkFailure(auditLog, { requestId, status: error.status, code: error.code });
      return workError(requestId, error, error.status === 405 ? { Allow: error.allow ?? "GET" } : {});
    }
    logWorkFailure(auditLog, { requestId, status: 503, code: "STORAGE_UNAVAILABLE", errorName: typeof error?.name === "string" ? error.name.slice(0, 40) : "Error" });
    return workError(requestId, new WorkApiError("STORAGE_UNAVAILABLE", "업무 자료를 처리하지 못했습니다.", 503, true));
  }

  return workError(requestId, new WorkApiError("NOT_FOUND", "요청한 업무 자료를 찾지 못했습니다.", 404));
}
