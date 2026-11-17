// 관리 API와 업무 도구 API가 함께 쓰는 작업자 표시·감사 식별자. admin-api.mjs 안에 있던 함수를 동작 그대로 옮겼다.
const auditEncoder = new TextEncoder();

export function maskEmail(email) {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "관리자";
  const visible = local.slice(0, 1);
  return `${visible}${"*".repeat(Math.max(3, local.length - 1))}@${domain}`;
}

// Worker 로그에는 이메일 원문 대신 이 HMAC 값만 남긴다(ADMIN_CSRF_SECRET + "admin-audit:" 접두어).
export async function getAuditActorId(email, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    auditEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign(
    "HMAC",
    key,
    auditEncoder.encode(`admin-audit:${email.toLowerCase()}`),
  ));
  let binary = "";
  for (const byte of signature.subarray(0, 12)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}
