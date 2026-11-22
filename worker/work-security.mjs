// 업무 도구 API(단계 2)의 사용 여부·설정 확인과 쓰기 보호. 기존 콘텐츠 API(admin-security.mjs)의 함수는 고치지 않고,
// 안쪽 HMAC 도우미만 함께 쓴다. CSRF 서명 메시지에 "work:" 접두어를 붙여 콘텐츠 API 토큰과 서로 통하지 않게 한다(설계서 5.3절).
import {
  base64UrlToBytes,
  bytesToBase64Url,
  CSRF_MAX_AGE_SECONDS,
  importCsrfKey,
  parseAdminAllowedOrigins,
} from "./admin-security.mjs";

const encoder = new TextEncoder();

export class WorkApiError extends Error {
  constructor(code, message, status, retryable = false, details = []) {
    super(message);
    this.name = "WorkApiError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    // 칸 이름만 담는다(입력값은 담지 않음, 설계서 10.4절 VALIDATION_FAILED).
    this.details = details;
  }
}

export function hasD1(binding) {
  return Boolean(binding) && typeof binding.prepare === "function" && typeof binding.batch === "function";
}

// "disabled": WORK_TOOLS_ENABLED가 정확히 "true"가 아님 / "config_missing": 켰지만 D1·CSRF Secret·허용 출처 중 하나가 없거나 틀림 / "enabled"
export function getWorkConfigState(env, db = env?.WORK_DB) {
  if (env?.WORK_TOOLS_ENABLED !== "true") return "disabled";
  if (!hasD1(db) || typeof env?.ADMIN_CSRF_SECRET !== "string" || env.ADMIN_CSRF_SECRET.length < 32) return "config_missing";
  try {
    parseAdminAllowedOrigins(env.ADMIN_ALLOWED_ORIGINS);
  } catch {
    return "config_missing";
  }
  return "enabled";
}

export function isWorkToolsEnabled(env, db = env?.WORK_DB) {
  return getWorkConfigState(env, db) === "enabled";
}

// R2 바인딩 모양(put·get·delete). 시험은 같은 모양의 가짜를 넣는다.
export function hasR2(binding) {
  return Boolean(binding) && typeof binding.put === "function" && typeof binding.get === "function" && typeof binding.delete === "function";
}

// 파일(사진) API 켜기: Secret WORK_FILES_ENABLED가 정확히 "true"이고 WORK_FILES 바인딩이 있을 때만(업무 도구 켜기 값은 따로 먼저 본다).
// 처리방침에 사진 문장을 넣고 공개한 뒤에 등록한다(photo-pr-plan 0절).
export function isWorkFilesEnabled(env, files = env?.WORK_FILES) {
  return env?.WORK_FILES_ENABLED === "true" && hasR2(files);
}

export async function createWorkCsrfToken(email, secret, now = Date.now()) {
  const issuedAt = Math.floor(now / 1000);
  const key = await importCsrfKey(secret);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(`work:${email}:${issuedAt}`)));
  return `${issuedAt}.${bytesToBase64Url(signature)}`;
}

export async function verifyWorkCsrfToken(token, email, secret, now = Date.now()) {
  if (typeof token !== "string") return false;
  const [issuedAtValue, signatureValue, extra] = token.split(".");
  if (extra !== undefined || !/^\d+$/u.test(issuedAtValue ?? "") || !signatureValue) return false;
  const issuedAt = Number(issuedAtValue);
  const currentTime = Math.floor(now / 1000);
  if (!Number.isSafeInteger(issuedAt) || issuedAt > currentTime + 60 || currentTime - issuedAt > CSRF_MAX_AGE_SECONDS) return false;
  try {
    const key = await importCsrfKey(secret);
    return await crypto.subtle.verify("HMAC", key, base64UrlToBytes(signatureValue), encoder.encode(`work:${email}:${issuedAt}`));
  } catch {
    return false;
  }
}

function assertWorkOrigin(request, env) {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  const allowedOrigins = parseAdminAllowedOrigins(env.ADMIN_ALLOWED_ORIGINS);
  if (origin !== url.origin || !allowedOrigins.has(url.origin)) {
    throw new WorkApiError("ORIGIN_DENIED", "허용되지 않은 요청 출처입니다.", 403);
  }
}

async function assertWorkCsrf(request, actor, env, now) {
  const valid = await verifyWorkCsrfToken(request.headers.get("X-Admin-CSRF"), actor.email, env.ADMIN_CSRF_SECRET, now);
  if (!valid) {
    throw new WorkApiError("CSRF_INVALID", "업무 도구 보안 토큰이 만료되었거나 올바르지 않습니다.", 403);
  }
}

// 쓰기 요청(POST·PATCH·PUT·DELETE): 같은 출처의 허용된 Origin → JSON → 업무 CSRF 순서로 확인한다.
export async function validateWorkJsonWrite(request, actor, env, now = Date.now()) {
  assertWorkOrigin(request, env);
  const mediaType = (request.headers.get("Content-Type") ?? "").split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "application/json") {
    throw new WorkApiError("CONTENT_TYPE_REQUIRED", "JSON 요청만 허용합니다.", 415);
  }
  await assertWorkCsrf(request, actor, env, now);
}

// 파일 바이트를 그대로 보내는 쓰기(사진 올리기·미리보기 올리기): Origin → 업무 CSRF. 본문 종류는 work-files.mjs가 허용 MIME으로 본다(415 UNSUPPORTED_MEDIA_TYPE).
export async function validateWorkUploadWrite(request, actor, env, now = Date.now()) {
  assertWorkOrigin(request, env);
  await assertWorkCsrf(request, actor, env, now);
}
