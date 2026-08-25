export class AdminWriteError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = "AdminWriteError";
    this.code = code;
    this.status = status;
  }
}

const encoder = new TextEncoder();
const CSRF_MAX_AGE_SECONDS = 2 * 60 * 60;

function bytesToBase64Url(bytes) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64UrlToBytes(value) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function importCsrfKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export function isAdminWriteEnabled(env) {
  return env?.ADMIN_WRITE_ENABLED === "true"
    && typeof env?.ADMIN_CSRF_SECRET === "string"
    && env.ADMIN_CSRF_SECRET.length >= 32
    && typeof env?.GITHUB_CONTENTS_TOKEN === "string"
    && env.GITHUB_CONTENTS_TOKEN.length > 0
    && typeof env?.GITHUB_REPOSITORY === "string"
    && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(env.GITHUB_REPOSITORY)
    && typeof env?.GITHUB_BRANCH === "string"
    && env.GITHUB_BRANCH.length > 0;
}

export async function createCsrfToken(email, secret, now = Date.now()) {
  const issuedAt = Math.floor(now / 1000);
  const message = `${email}:${issuedAt}`;
  const key = await importCsrfKey(secret);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
  return `${issuedAt}.${bytesToBase64Url(signature)}`;
}

export async function verifyCsrfToken(token, email, secret, now = Date.now()) {
  if (typeof token !== "string") return false;
  const [issuedAtValue, signatureValue, extra] = token.split(".");
  if (extra !== undefined || !/^\d+$/u.test(issuedAtValue ?? "") || !signatureValue) return false;
  const issuedAt = Number(issuedAtValue);
  const currentTime = Math.floor(now / 1000);
  if (!Number.isSafeInteger(issuedAt) || issuedAt > currentTime + 60 || currentTime - issuedAt > CSRF_MAX_AGE_SECONDS) return false;
  try {
    const key = await importCsrfKey(secret);
    return crypto.subtle.verify(
      "HMAC",
      key,
      base64UrlToBytes(signatureValue),
      encoder.encode(`${email}:${issuedAt}`),
    );
  } catch {
    return false;
  }
}

export async function validateAdminWriteRequest(request, actor, env) {
  if (!isAdminWriteEnabled(env)) {
    throw new AdminWriteError("WRITE_DISABLED", "관리자 저장 연결이 아직 활성화되지 않았습니다.", 503);
  }

  const url = new URL(request.url);
  if (request.headers.get("Origin") !== url.origin) {
    throw new AdminWriteError("ORIGIN_DENIED", "허용되지 않은 요청 출처입니다.", 403);
  }

  const contentType = request.headers.get("Content-Type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new AdminWriteError("CONTENT_TYPE_REQUIRED", "JSON 요청만 허용합니다.", 415);
  }

  const csrfToken = request.headers.get("X-Admin-CSRF");
  const csrfValid = await verifyCsrfToken(csrfToken, actor.email, env.ADMIN_CSRF_SECRET);
  if (!csrfValid) {
    throw new AdminWriteError("CSRF_INVALID", "관리자 보안 토큰이 만료되었거나 올바르지 않습니다.", 403);
  }
}
