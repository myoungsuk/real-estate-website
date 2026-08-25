import { createRemoteJWKSet, jwtVerify } from "jose";

const remoteJwksByUrl = new Map();

export class AccessAuthError extends Error {
  constructor(code, status, message) {
    super(message);
    this.name = "AccessAuthError";
    this.code = code;
    this.status = status;
  }
}

function requiredValue(env, name) {
  const value = env?.[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw new AccessAuthError("AUTH_CONFIG_MISSING", 503, `${name} 설정이 필요합니다.`);
  }
  return value.trim();
}

export function normalizeTeamDomain(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new AccessAuthError("AUTH_CONFIG_INVALID", 503, "CF_ACCESS_TEAM_DOMAIN 형식이 올바르지 않습니다.");
  }

  const isCloudflareAccessHost = url.hostname.endsWith(".cloudflareaccess.com");
  const hasUnexpectedParts =
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== "";

  if (!isCloudflareAccessHost || hasUnexpectedParts) {
    throw new AccessAuthError(
      "AUTH_CONFIG_INVALID",
      503,
      "CF_ACCESS_TEAM_DOMAIN은 HTTPS Cloudflare Access 팀 도메인이어야 합니다.",
    );
  }

  return url.origin;
}

export function parseAllowedEmails(value) {
  const emails = [...new Set(
    value
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  )];
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (emails.length !== 2 || emails.some((email) => !validEmail.test(email))) {
    throw new AccessAuthError(
      "AUTH_CONFIG_INVALID",
      503,
      "ADMIN_ALLOWED_EMAILS에는 서로 다른 이메일 주소 2개가 필요합니다.",
    );
  }
  return emails;
}

function getRemoteJwks(teamDomain) {
  const certsUrl = `${teamDomain}/cdn-cgi/access/certs`;
  let jwks = remoteJwksByUrl.get(certsUrl);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(certsUrl));
    remoteJwksByUrl.set(certsUrl, jwks);
  }
  return jwks;
}

export async function verifyAccessToken(token, { teamDomain, audience }) {
  const { payload } = await jwtVerify(token, getRemoteJwks(teamDomain), {
    issuer: teamDomain,
    audience,
    algorithms: ["RS256"],
  });
  return payload;
}

export async function authenticateAccess(request, env, verifyToken = verifyAccessToken) {
  const teamDomain = normalizeTeamDomain(requiredValue(env, "CF_ACCESS_TEAM_DOMAIN"));
  const audience = requiredValue(env, "CF_ACCESS_AUD");
  const allowedEmails = parseAllowedEmails(requiredValue(env, "ADMIN_ALLOWED_EMAILS"));
  const token = request.headers.get("cf-access-jwt-assertion");

  if (!token) {
    throw new AccessAuthError("AUTH_REQUIRED", 401, "Cloudflare Access 로그인이 필요합니다.");
  }

  let payload;
  try {
    payload = await verifyToken(token, { teamDomain, audience });
  } catch {
    throw new AccessAuthError("AUTH_INVALID", 401, "Cloudflare Access 인증을 확인할 수 없습니다.");
  }

  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  if (email === "" || !allowedEmails.includes(email)) {
    throw new AccessAuthError("AUTH_EMAIL_DENIED", 403, "이 계정은 관리자 권한이 없습니다.");
  }

  return {
    email,
    subject: typeof payload.sub === "string" ? payload.sub : null,
  };
}
