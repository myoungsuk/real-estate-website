import test from "node:test";
import assert from "node:assert/strict";
import {
  AccessAuthError,
  authenticateAccess,
  normalizeTeamDomain,
  parseAllowedEmails,
} from "../worker/access-auth.mjs";
import { handleAdminApi } from "../worker/admin-api.mjs";
import { getAdminResourcePath } from "../worker/admin-resource-validation.mjs";
import { createCsrfToken, verifyCsrfToken } from "../worker/admin-security.mjs";
import { handleRequest, isAdminApiPath } from "../worker/index.mjs";

const authEnv = {
  CF_ACCESS_TEAM_DOMAIN: "https://leaderscityhappy.cloudflareaccess.com",
  CF_ACCESS_AUD: "test-audience",
  ADMIN_ALLOWED_EMAILS: "owner@example.com,backup@example.com",
};

const authenticated = async () => ({ email: "owner@example.com", subject: "subject-1" });

test("단지 전체 안내 JSON은 관리자 허용 경로로만 연결한다", () => {
  assert.equal(getAdminResourcePath("complexes-overview"), "src/data/complexes-overview.json");
  assert.equal(getAdminResourcePath("../complexes-overview"), null);
});

test("관리 API 경로만 같은 Worker에서 먼저 처리한다", () => {
  assert.equal(isAdminApiPath("/api/admin"), true);
  assert.equal(isAdminApiPath("/api/admin/v1/session"), true);
  assert.equal(isAdminApiPath("/api/public"), false);
  assert.equal(isAdminApiPath("/admin/"), false);
});

test("공개 정적 요청은 ASSETS 바인딩으로 전달한다", async () => {
  let requestedUrl = null;
  const request = new Request("https://leaderscityhappy.com/office/");
  const response = await handleRequest(request, {
    ASSETS: {
      fetch(received) {
        requestedUrl = received.url;
        return new Response("asset", { status: 200 });
      },
    },
  });

  assert.equal(response.status, 200);
  assert.equal(await response.text(), "asset");
  assert.equal(requestedUrl, request.url);
});

test("Access 설정이 없으면 fail closed한다", async () => {
  await assert.rejects(
    authenticateAccess(new Request("https://leaderscityhappy.com/api/admin/v1/session"), {}),
    (error) => error instanceof AccessAuthError && error.code === "AUTH_CONFIG_MISSING" && error.status === 503,
  );
});

test("Cloudflare Access JWT 헤더가 없으면 거부한다", async () => {
  await assert.rejects(
    authenticateAccess(new Request("https://leaderscityhappy.com/api/admin/v1/session"), authEnv),
    (error) => error instanceof AccessAuthError && error.code === "AUTH_REQUIRED" && error.status === 401,
  );
});

test("서명 검증된 이메일이 허용된 두 주소 중 하나와 정확히 일치해야 한다", async () => {
  const request = new Request("https://leaderscityhappy.com/api/admin/v1/session", {
    headers: { "Cf-Access-Jwt-Assertion": "signed-token" },
  });

  const actor = await authenticateAccess(request, authEnv, async (token, options) => {
    assert.equal(token, "signed-token");
    assert.equal(options.teamDomain, authEnv.CF_ACCESS_TEAM_DOMAIN);
    assert.equal(options.audience, authEnv.CF_ACCESS_AUD);
    return { email: "OWNER@example.com", sub: "subject-1" };
  });

  assert.deepEqual(actor, { email: "owner@example.com", subject: "subject-1" });
});

test("허용 이메일이 아닌 JWT는 거부한다", async () => {
  const request = new Request("https://leaderscityhappy.com/api/admin/v1/session", {
    headers: { "Cf-Access-Jwt-Assertion": "signed-token" },
  });

  await assert.rejects(
    authenticateAccess(request, authEnv, async () => ({ email: "other@example.com" })),
    (error) => error instanceof AccessAuthError && error.code === "AUTH_EMAIL_DENIED" && error.status === 403,
  );
});

test("세션 API는 이메일을 마스킹하고 쓰기를 비활성화한다", async () => {
  const response = await handleAdminApi(
    new Request("https://leaderscityhappy.com/api/admin/v1/session"),
    authEnv,
    { authenticate: authenticated },
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(body.ok, true);
  assert.equal(response.headers.get("x-request-id"), body.requestId);
  assert.equal(body.data.administrator, "o****@example.com");
  assert.equal(body.data.authentication, "cloudflare-access-email-otp");
  assert.equal(body.data.writeEnabled, false);
});

test("관리 API는 구현되지 않은 쓰기 요청을 거부한다", async () => {
  const response = await handleAdminApi(
    new Request("https://leaderscityhappy.com/api/admin/v1/system", { method: "POST" }),
    authEnv,
    { authenticate: authenticated },
  );
  const body = await response.json();

  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET");
  assert.equal(body.error.code, "METHOD_NOT_ALLOWED");
});

test("쓰기 설정과 CSRF가 있으면 허용된 콘텐츠를 GitHub 저장 함수로 전달한다", async () => {
  const env = {
    ...authEnv,
    ADMIN_WRITE_ENABLED: "true",
    ADMIN_CSRF_SECRET: "12345678901234567890123456789012",
    GITHUB_CONTENTS_TOKEN: "test-token",
    GITHUB_REPOSITORY: "owner/repository",
    GITHUB_BRANCH: "master",
  };
  const csrfToken = await createCsrfToken("owner@example.com", env.ADMIN_CSRF_SECRET);
  let received = null;
  const response = await handleAdminApi(
    new Request("https://leaderscityhappy.com/api/admin/v1/content/listings", {
      method: "PUT",
      headers: {
        Origin: "https://leaderscityhappy.com",
        "Content-Type": "application/json",
        "X-Admin-CSRF": csrfToken,
      },
      body: JSON.stringify({ sha: "source-sha", data: [] }),
    }),
    env,
    {
      authenticate: authenticated,
      writeResource: async (resource, data, sha) => {
        received = { resource, data, sha };
        return { resource, commitSha: "commit-sha", contentSha: "content-sha" };
      },
    },
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(received, { resource: "listings", data: [], sha: "source-sha" });
  assert.equal(body.data.commitSha, "commit-sha");
});

test("다른 출처의 관리자 저장 요청은 CSRF 토큰이 있어도 차단한다", async () => {
  const env = {
    ...authEnv,
    ADMIN_WRITE_ENABLED: "true",
    ADMIN_CSRF_SECRET: "12345678901234567890123456789012",
    GITHUB_CONTENTS_TOKEN: "test-token",
    GITHUB_REPOSITORY: "owner/repository",
    GITHUB_BRANCH: "master",
  };
  const csrfToken = await createCsrfToken("owner@example.com", env.ADMIN_CSRF_SECRET);
  const response = await handleAdminApi(
    new Request("https://leaderscityhappy.com/api/admin/v1/content/listings", {
      method: "PUT",
      headers: { Origin: "https://attacker.example", "Content-Type": "application/json", "X-Admin-CSRF": csrfToken },
      body: JSON.stringify({ sha: "source-sha", data: [] }),
    }),
    env,
    { authenticate: authenticated },
  );
  const body = await response.json();
  assert.equal(response.status, 403);
  assert.equal(body.error.code, "ORIGIN_DENIED");
});

test("CSRF 토큰은 발급 이메일과 만료 시간을 검증한다", async () => {
  const secret = "12345678901234567890123456789012";
  const now = Date.now();
  const token = await createCsrfToken("owner@example.com", secret, now);
  assert.equal(await verifyCsrfToken(token, "owner@example.com", secret, now + 1000), true);
  assert.equal(await verifyCsrfToken(token, "other@example.com", secret, now + 1000), false);
  assert.equal(await verifyCsrfToken(token, "owner@example.com", secret, now + (3 * 60 * 60 * 1000)), false);
});

test("시스템 API는 Secret과 허용 이메일 원문을 반환하지 않는다", async () => {
  const env = {
    ...authEnv,
    GITHUB_CONTENTS_TOKEN: "github-secret-token",
  };
  const response = await handleAdminApi(
    new Request("https://leaderscityhappy.com/api/admin/v1/system"),
    env,
    { authenticate: authenticated },
  );
  const text = await response.text();

  assert.equal(response.status, 200);
  assert.doesNotMatch(text, /github-secret-token/);
  assert.doesNotMatch(text, /owner@example\.com/);
  assert.doesNotMatch(text, /test-audience/);
});

test("팀 도메인은 HTTPS cloudflareaccess.com 원점만 허용한다", () => {
  assert.equal(
    normalizeTeamDomain("https://leaderscityhappy.cloudflareaccess.com"),
    "https://leaderscityhappy.cloudflareaccess.com",
  );
  assert.throws(
    () => normalizeTeamDomain("https://example.com"),
    (error) => error instanceof AccessAuthError && error.code === "AUTH_CONFIG_INVALID",
  );
});

test("허용 이메일은 서로 다른 유효 주소 정확히 2개여야 한다", () => {
  assert.deepEqual(
    parseAllowedEmails(" OWNER@example.com, backup@example.com "),
    ["owner@example.com", "backup@example.com"],
  );
  assert.throws(
    () => parseAllowedEmails("owner@example.com"),
    (error) => error instanceof AccessAuthError && error.code === "AUTH_CONFIG_INVALID",
  );
  assert.throws(
    () => parseAllowedEmails("owner@example.com,OWNER@example.com"),
    (error) => error instanceof AccessAuthError && error.code === "AUTH_CONFIG_INVALID",
  );
});
