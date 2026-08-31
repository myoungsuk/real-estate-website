import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  AccessAuthError,
  authenticateAccess,
  normalizeTeamDomain,
  parseAllowedEmails,
} from "../worker/access-auth.mjs";
import { handleAdminApi } from "../worker/admin-api.mjs";
import { getAdminResourcePath, validateAdminResource } from "../worker/admin-resource-validation.mjs";
import {
  createCsrfToken,
  isAdminWriteEnabled,
  parseAdminAllowedOrigins,
  validateAdminWriteRequest,
  verifyCsrfToken,
} from "../worker/admin-security.mjs";
import { handleRequest, isAdminApiPath } from "../worker/index.mjs";

const authEnv = {
  CF_ACCESS_TEAM_DOMAIN: "https://leaderscityhappy.cloudflareaccess.com",
  CF_ACCESS_AUD: "test-audience",
  ADMIN_ALLOWED_EMAILS: "owner@example.com,backup@example.com",
};

const authenticated = async () => ({ email: "owner@example.com", subject: "subject-1" });
const resourceFiles = {
  listings: "listings.json",
  "naver-listings": "naver-listings.json",
  "listing-review-state": "../../.github/listing-review-state.json",
  office: "office.json",
  complexes: "complexes.json",
  "complexes-overview": "complexes-overview.json",
  "external-links": "external-links.json",
  "home-content": "home-content.json",
  faq: "faq.json",
  reviews: "reviews.json",
};
const currentResources = Object.fromEntries(await Promise.all(
  Object.entries(resourceFiles).map(async ([resource, file]) => [
    resource,
    JSON.parse(await readFile(new URL(`../src/data/${file}`, import.meta.url), "utf8")),
  ]),
));
const currentSnapshot = {
  baseCommitSha: "a".repeat(40),
  treeSha: "b".repeat(40),
  resources: Object.fromEntries(Object.keys(resourceFiles).map((resource) => [
    resource,
    {
      resource,
      sha: `${resource}-sha`,
      data: structuredClone(currentResources[resource]),
    },
  ])),
};
const strictCurrentSnapshot = {
  ...currentSnapshot,
  resources: Object.fromEntries(Object.entries(currentSnapshot.resources).map(([resource, value], index) => [
    resource,
    { ...value, sha: (index + 1).toString(16).repeat(40) },
  ])),
};

test("단지와 네이버 매물 JSON은 관리자 허용 경로로만 연결한다", () => {
  assert.equal(getAdminResourcePath("complexes-overview"), "src/data/complexes-overview.json");
  assert.equal(getAdminResourcePath("naver-listings"), "src/data/naver-listings.json");
  assert.equal(getAdminResourcePath("listing-review-state"), ".github/listing-review-state.json");
  assert.equal(getAdminResourcePath("../complexes-overview"), null);
});

test("관리자 FAQ 저장도 공개 카테고리 스키마를 검증한다", () => {
  assert.deepEqual(validateAdminResource("faq", [
    { category: "가격과 시세", question: "호가란 무엇인가요?", answer: "소유자가 제시한 희망 가격입니다." },
  ]), []);
  assert.match(validateAdminResource("faq", [
    { question: "카테고리가 없으면 어떻게 되나요?", answer: "저장을 거부합니다." },
  ]).join("\n"), /category/);
  const securityErrors = validateAdminResource("faq", [{
    category: "가격과 시세",
    question: "비공개 문의인가요?",
    answer: "고객 연락처 010-1111-2222",
    privateNote: "내부 메모",
  }]).join("\n");
  assert.match(securityErrors, /허용되지 않은 필드/);
  assert.match(securityErrors, /공개 저장 금지 필드/);
  assert.match(securityErrors, /휴대전화번호/);
});

test("관리자 매물 재확인 상태는 공개 ID·출처·날짜만 허용한다", () => {
  const state = structuredClone(currentResources["listing-review-state"]);
  assert.deepEqual(validateAdminResource("listing-review-state", state, currentResources), []);
  const firstId = Object.keys(state.items)[0];
  state.items[firstId].privateNote = "내부 문구";
  const errors = validateAdminResource("listing-review-state", state, currentResources).join("\n");
  assert.match(errors, /형식|공개 저장 금지/u);
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

test("관리 API는 저장 commit과 Production resource digest를 분리해 공개 완료를 판정한다", async () => {
  const commit = "c".repeat(40);
  const digest = "d".repeat(64);
  const query = new URLSearchParams({
    commit,
    resource: "home-content",
    digest,
    savedAt: "2026-08-31T00:00:00.000Z",
  });
  const env = {
    ...authEnv,
    CF_VERSION_METADATA: {
      id: "12345678-abcd-1234-abcd-1234567890ab",
      timestamp: "2026-08-31T00:00:30Z",
    },
  };
  const response = await handleAdminApi(
    new Request(`https://leaderscityhappy.com/api/admin/v1/deployment-status?${query}`),
    env,
    {
      authenticate: authenticated,
      now: () => Date.parse("2026-08-31T00:01:00Z"),
      readDeploymentMarker: async () => ({
        schemaVersion: 2,
        algorithm: "sha256",
        source: { commit, branch: "master", provider: "workers-builds" },
        resources: { "home-content": digest },
      }),
    },
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.data.state, "published");
  assert.equal(body.data.resourceMatched, true);
  assert.equal(body.data.workerVersion.id, env.CF_VERSION_METADATA.id);
  assert.equal(body.data.activeCommit, commit);
});

test("배포 상태 API의 잘못된 query와 쓰기 메서드는 명확히 거부한다", async () => {
  const invalid = await handleAdminApi(
    new Request("https://leaderscityhappy.com/api/admin/v1/deployment-status?commit=bad"),
    authEnv,
    { authenticate: authenticated },
  );
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error.code, "DEPLOYMENT_COMMIT_INVALID");

  const method = await handleAdminApi(
    new Request("https://leaderscityhappy.com/api/admin/v1/deployment-status", { method: "POST" }),
    authEnv,
    { authenticate: authenticated },
  );
  assert.equal(method.status, 405);
  assert.equal(method.headers.get("allow"), "GET");
});

test("관리 API는 허용 resource의 Git 변경 이력과 현재 규칙 검증 결과만 반환한다", async () => {
  const env = {
    ...authEnv,
    ADMIN_WRITE_ENABLED: "true",
    ADMIN_CSRF_SECRET: "12345678901234567890123456789012",
    GITHUB_CONTENTS_TOKEN: "test-token",
    GITHUB_REPOSITORY: "owner/repository",
    GITHUB_BRANCH: "master",
  };
  const sourceCommit = "c".repeat(40);
  const historical = structuredClone(currentResources["home-content"]);
  historical.broker.headline = "과거에 공개했던 대표 문장입니다.";
  const listResponse = await handleAdminApi(
    new Request("https://leaderscityhappy.com/api/admin/v1/content-history/home-content?limit=10"),
    env,
    {
      authenticate: authenticated,
      readResourceHistory: async (resource, options) => ({
        resource,
        entries: [{ commitSha: sourceCommit, title: "관리자: 공개 문구 수정", committedAt: "2026-08-30T00:00:00.000Z" }],
        nextCursor: options.limit === "10" ? "Mg" : null,
      }),
    },
  );
  const listBody = await listResponse.json();
  assert.equal(listResponse.status, 200);
  assert.equal(listBody.data.resource, "home-content");
  assert.equal(listBody.data.nextCursor, "Mg");

  const detailResponse = await handleAdminApi(
    new Request(`https://leaderscityhappy.com/api/admin/v1/content-history/home-content/${sourceCommit}`),
    env,
    {
      authenticate: authenticated,
      readResourceRevision: async () => ({
        resource: "home-content",
        sourceCommit,
        sha: "d".repeat(40),
        data: historical,
      }),
      readResourcesSnapshot: async () => strictCurrentSnapshot,
      readDeploymentMarker: async () => ({
        schemaVersion: 2,
        algorithm: "sha256",
        resources: { "home-content": "f".repeat(64) },
      }),
    },
  );
  const detailBody = await detailResponse.json();
  assert.equal(detailResponse.status, 200);
  assert.equal(detailBody.data.validation.valid, true);
  assert.equal(detailBody.data.source.commitSha, sourceCommit);
  assert.equal(detailBody.data.current.resourceBlobSha, strictCurrentSnapshot.resources["home-content"].sha);
  assert.equal(detailBody.data.source.productionMatched, false);
  assert.equal(detailBody.data.confirmation, "home-content 이전 내용으로 복원");
});

test("콘텐츠 복원은 2차 문구와 최신 SHA를 확인하고 force 없는 새 커밋 writer만 호출한다", async () => {
  const env = {
    ...authEnv,
    ADMIN_WRITE_ENABLED: "true",
    ADMIN_CSRF_SECRET: "12345678901234567890123456789012",
    GITHUB_CONTENTS_TOKEN: "test-token",
    GITHUB_REPOSITORY: "owner/repository",
    GITHUB_BRANCH: "master",
  };
  const csrfToken = await createCsrfToken("owner@example.com", env.ADMIN_CSRF_SECRET);
  const sourceCommit = "c".repeat(40);
  const restoredData = structuredClone(currentResources["home-content"]);
  restoredData.broker.headline = "과거 공개 문장으로 안전하게 복원합니다.";
  let writerCall = null;
  const auditEvents = [];
  const response = await handleAdminApi(
    new Request("https://leaderscityhappy.com/api/admin/v1/content/restore", {
      method: "POST",
      headers: {
        Origin: "https://leaderscityhappy.com",
        "Content-Type": "application/json",
        "X-Admin-CSRF": csrfToken,
      },
      body: JSON.stringify({
        sourceCommit,
        resources: [{
          resource: "home-content",
          expectedCurrentSha: strictCurrentSnapshot.resources["home-content"].sha,
        }],
        confirmation: "home-content 이전 내용으로 복원",
      }),
    }),
    env,
    {
      authenticate: authenticated,
      readResourcesRevision: async () => ({
        baseCommitSha: sourceCommit,
        resources: {
          "home-content": { resource: "home-content", sha: "d".repeat(40), data: restoredData },
        },
      }),
      readResourcesSnapshot: async () => strictCurrentSnapshot,
      writeResources: async (changes, _env, options) => {
        writerCall = { changes, options };
        return {
          resources: [{ resource: "home-content", contentSha: "e".repeat(40), resourceDigest: "f".repeat(64) }],
          commitSha: "9".repeat(40),
          baseCommitSha: "9".repeat(40),
        };
      },
      auditLog: (entry) => auditEvents.push(entry),
    },
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(writerCall.changes[0].sha, strictCurrentSnapshot.resources["home-content"].sha);
  assert.deepEqual(writerCall.changes[0].data, restoredData);
  assert.equal(writerCall.options.snapshot, strictCurrentSnapshot);
  assert.equal(writerCall.options.commitMessage, `관리자: home-content를 ${sourceCommit.slice(0, 8)} 시점 내용으로 복원`);
  assert.equal(body.data.commitSha, "9".repeat(40));
  assert.equal(body.data.sourceCommit, sourceCommit);
  assert.equal(auditEvents[0].operation, "content-restore");
  assert.equal(auditEvents[0].result, "success");
  assert.doesNotMatch(JSON.stringify(auditEvents), /owner@example\.com|test-token|과거 공개 문장/u);
});

test("콘텐츠 복원은 잘못된 확인 문구, schema 불일치와 중간 SHA 변경 시 쓰지 않는다", async () => {
  const env = {
    ...authEnv,
    ADMIN_WRITE_ENABLED: "true",
    ADMIN_CSRF_SECRET: "12345678901234567890123456789012",
    GITHUB_CONTENTS_TOKEN: "test-token",
    GITHUB_REPOSITORY: "owner/repository",
    GITHUB_BRANCH: "master",
  };
  const csrfToken = await createCsrfToken("owner@example.com", env.ADMIN_CSRF_SECRET);
  const sourceCommit = "c".repeat(40);
  const invalidHistorical = structuredClone(currentResources["home-content"]);
  invalidHistorical.internalNote = "공개 금지";
  let writerCalls = 0;
  const request = (confirmation, expectedCurrentSha) => new Request("https://leaderscityhappy.com/api/admin/v1/content/restore", {
    method: "POST",
    headers: {
      Origin: "https://leaderscityhappy.com",
      "Content-Type": "application/json",
      "X-Admin-CSRF": csrfToken,
    },
    body: JSON.stringify({
      sourceCommit,
      resources: [{ resource: "home-content", expectedCurrentSha }],
      confirmation,
    }),
  });
  const options = {
    authenticate: authenticated,
    readResourcesRevision: async () => ({
      baseCommitSha: sourceCommit,
      resources: { "home-content": { sha: "d".repeat(40), data: invalidHistorical } },
    }),
    readResourcesSnapshot: async () => strictCurrentSnapshot,
    writeResources: async () => { writerCalls += 1; return {}; },
    auditLog: () => {},
  };

  const confirmationFailure = await handleAdminApi(
    request("복원", strictCurrentSnapshot.resources["home-content"].sha),
    env,
    options,
  );
  assert.equal(confirmationFailure.status, 400);
  assert.equal((await confirmationFailure.json()).error.code, "RESTORE_CONFIRMATION_INVALID");

  const schemaFailure = await handleAdminApi(
    request("home-content 이전 내용으로 복원", strictCurrentSnapshot.resources["home-content"].sha),
    env,
    options,
  );
  assert.equal(schemaFailure.status, 422);
  assert.equal((await schemaFailure.json()).error.code, "CONTENT_VALIDATION_FAILED");

  const conflictOptions = {
    ...options,
    readResourcesRevision: async () => ({
      baseCommitSha: sourceCommit,
      resources: { "home-content": { sha: "d".repeat(40), data: currentResources["home-content"] } },
    }),
  };
  const conflict = await handleAdminApi(
    request("home-content 이전 내용으로 복원", "f".repeat(40)),
    env,
    conflictOptions,
  );
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).error.code, "GITHUB_CONFLICT");
  assert.equal(writerCalls, 0);
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
  let snapshotReads = 0;
  const auditEvents = [];
  const response = await handleAdminApi(
    new Request("https://leaderscityhappy.com/api/admin/v1/content/listings", {
      method: "PUT",
      headers: {
        Origin: "https://leaderscityhappy.com",
        "Content-Type": "application/json",
        "X-Admin-CSRF": csrfToken,
      },
      body: JSON.stringify({ sha: "listings-sha", data: [] }),
    }),
    env,
    {
      authenticate: authenticated,
      readResourcesSnapshot: async () => {
        snapshotReads += 1;
        return currentSnapshot;
      },
      writeResource: async (resource, data, sha, _env, options) => {
        received = { resource, data, sha, snapshot: options.snapshot };
        return { resource, commitSha: "commit-sha", contentSha: "content-sha", baseCommitSha: "commit-sha" };
      },
      auditLog: (entry) => auditEvents.push(entry),
    },
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(received, {
    resource: "listings",
    data: [],
    sha: "listings-sha",
    snapshot: currentSnapshot,
  });
  assert.equal(body.data.commitSha, "commit-sha");
  assert.equal(snapshotReads, 1);
  assert.equal(auditEvents.length, 1);
  assert.deepEqual(auditEvents[0], {
    event: "admin_write",
    actorId: auditEvents[0].actorId,
    requestId: body.requestId,
    operation: "content-write",
    resource: "listings",
    result: "success",
    commitSha: "commit-sha",
  });
  assert.match(auditEvents[0].actorId, /^[A-Za-z0-9_-]{16}$/u);
  assert.doesNotMatch(JSON.stringify(auditEvents), /owner@example\.com|test-token|listings-sha|\[\]/u);
});

test("관리 API는 두 JSON 후보를 한 snapshot으로 검증하고 batch writer를 한 번 호출한다", async () => {
  const env = {
    ...authEnv,
    ADMIN_WRITE_ENABLED: "true",
    ADMIN_CSRF_SECRET: "12345678901234567890123456789012",
    GITHUB_CONTENTS_TOKEN: "test-token",
    GITHUB_REPOSITORY: "owner/repository",
    GITHUB_BRANCH: "master",
  };
  const csrfToken = await createCsrfToken("owner@example.com", env.ADMIN_CSRF_SECRET);
  const changes = [
    {
      resource: "home-content",
      sha: "home-content-sha",
      data: structuredClone(currentResources["home-content"]),
    },
    {
      resource: "faq",
      sha: "faq-sha",
      data: structuredClone(currentResources.faq),
    },
  ];
  let snapshotReads = 0;
  let received = null;
  const auditEvents = [];
  const response = await handleAdminApi(
    new Request("https://leaderscityhappy.com/api/admin/v1/content", {
      method: "PUT",
      headers: {
        Origin: "https://leaderscityhappy.com",
        "Content-Type": "application/json",
        "X-Admin-CSRF": csrfToken,
      },
      body: JSON.stringify({ changes }),
    }),
    env,
    {
      authenticate: authenticated,
      readResourcesSnapshot: async () => {
        snapshotReads += 1;
        return currentSnapshot;
      },
      writeResources: async (receivedChanges, _env, options) => {
        received = { changes: receivedChanges, snapshot: options.snapshot };
        return {
          resources: receivedChanges.map(({ resource }) => ({ resource, contentSha: `${resource}-new-sha` })),
          commitSha: "batch-commit-sha",
          baseCommitSha: "batch-commit-sha",
        };
      },
      auditLog: (entry) => auditEvents.push(entry),
    },
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(snapshotReads, 1);
  assert.deepEqual(received, { changes, snapshot: currentSnapshot });
  assert.equal(body.data.commitSha, "batch-commit-sha");
  assert.deepEqual(body.data.resources, [
    { resource: "home-content", contentSha: "home-content-new-sha" },
    { resource: "faq", contentSha: "faq-new-sha" },
  ]);
  assert.deepEqual(auditEvents[0], {
    event: "admin_write",
    actorId: auditEvents[0].actorId,
    requestId: body.requestId,
    operation: "content-batch-write",
    resource: "batch",
    resources: ["home-content", "faq"],
    result: "success",
    commitSha: "batch-commit-sha",
  });
  assert.doesNotMatch(JSON.stringify(auditEvents), /owner@example\.com|test-token|home-content-sha|faq-sha/u);
});

test("콘텐츠 사전 검증은 같은 snapshot 규칙을 사용하고 GitHub 쓰기를 호출하지 않는다", async () => {
  const env = {
    ...authEnv,
    ADMIN_WRITE_ENABLED: "true",
    ADMIN_CSRF_SECRET: "12345678901234567890123456789012",
    GITHUB_CONTENTS_TOKEN: "test-token",
    GITHUB_REPOSITORY: "owner/repository",
    GITHUB_BRANCH: "master",
  };
  const csrfToken = await createCsrfToken("owner@example.com", env.ADMIN_CSRF_SECRET);
  const candidate = structuredClone(currentResources["home-content"]);
  candidate.broker.headline = `${candidate.broker.headline} 사전 검증`;
  let snapshotReads = 0;
  let writerCalls = 0;
  const response = await handleAdminApi(
    new Request("https://leaderscityhappy.com/api/admin/v1/content/validate", {
      method: "POST",
      headers: {
        Origin: "https://leaderscityhappy.com",
        "Content-Type": "application/json",
        "X-Admin-CSRF": csrfToken,
      },
      body: JSON.stringify({
        changes: [{ resource: "home-content", sha: "home-content-sha", data: candidate }],
      }),
    }),
    env,
    {
      authenticate: authenticated,
      readResourcesSnapshot: async () => {
        snapshotReads += 1;
        return currentSnapshot;
      },
      writeResource: async () => { writerCalls += 1; },
      writeResources: async () => { writerCalls += 1; },
      auditLog: () => {},
    },
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.data.valid, true);
  assert.equal(body.data.snapshotCommit, currentSnapshot.baseCommitSha);
  assert.deepEqual(body.data.changedResources, ["home-content"]);
  assert.equal(snapshotReads, 1);
  assert.equal(writerCalls, 0);
});

test("콘텐츠 사전 검증은 변경 없음과 잘못된 메서드를 거부한다", async () => {
  const env = {
    ...authEnv,
    ADMIN_WRITE_ENABLED: "true",
    ADMIN_CSRF_SECRET: "12345678901234567890123456789012",
    GITHUB_CONTENTS_TOKEN: "test-token",
    GITHUB_REPOSITORY: "owner/repository",
    GITHUB_BRANCH: "master",
  };
  const csrfToken = await createCsrfToken("owner@example.com", env.ADMIN_CSRF_SECRET);
  const unchanged = await handleAdminApi(
    new Request("https://leaderscityhappy.com/api/admin/v1/content/validate", {
      method: "POST",
      headers: {
        Origin: "https://leaderscityhappy.com",
        "Content-Type": "application/json",
        "X-Admin-CSRF": csrfToken,
      },
      body: JSON.stringify({
        changes: [{ resource: "home-content", sha: "home-content-sha", data: currentResources["home-content"] }],
      }),
    }),
    env,
    { authenticate: authenticated, readResourcesSnapshot: async () => currentSnapshot, auditLog: () => {} },
  );
  assert.equal(unchanged.status, 400);
  assert.equal((await unchanged.json()).error.code, "NO_CONTENT_CHANGES");

  const wrongMethod = await handleAdminApi(
    new Request("https://leaderscityhappy.com/api/admin/v1/content/validate", { method: "PUT" }),
    env,
    { authenticate: authenticated },
  );
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get("allow"), "POST");
});

test("관리 API 일괄 저장은 서로 의존하는 두 후보를 결합한 상태로 교차 검증한다", async () => {
  const env = {
    ...authEnv,
    ADMIN_WRITE_ENABLED: "true",
    ADMIN_CSRF_SECRET: "12345678901234567890123456789012",
    GITHUB_CONTENTS_TOKEN: "test-token",
    GITHUB_REPOSITORY: "owner/repository",
    GITHUB_BRANCH: "master",
  };
  const csrfToken = await createCsrfToken("owner@example.com", env.ADMIN_CSRF_SECRET);
  const relatedId = currentResources["complexes-overview"].relatedContentIds[0];
  const externalLinksCandidate = currentResources["external-links"].filter((item) => item.id !== relatedId);
  const overviewCandidate = {
    ...structuredClone(currentResources["complexes-overview"]),
    relatedContentIds: currentResources["complexes-overview"].relatedContentIds.filter((id) => id !== relatedId),
  };
  const unchangedResources = Object.fromEntries(
    Object.entries(currentResources).filter(([resource]) => resource !== "external-links"),
  );
  assert.match(
    validateAdminResource("external-links", externalLinksCandidate, unchangedResources).join("\n"),
    /external-links\.json에 없는 ID/,
  );

  const changes = [
    { resource: "external-links", sha: "external-links-sha", data: externalLinksCandidate },
    { resource: "complexes-overview", sha: "complexes-overview-sha", data: overviewCandidate },
  ];
  let received = null;
  const response = await handleAdminApi(
    new Request("https://leaderscityhappy.com/api/admin/v1/content", {
      method: "PUT",
      headers: {
        Origin: "https://leaderscityhappy.com",
        "Content-Type": "application/json",
        "X-Admin-CSRF": csrfToken,
      },
      body: JSON.stringify({ changes }),
    }),
    env,
    {
      authenticate: authenticated,
      readResourcesSnapshot: async () => currentSnapshot,
      writeResources: async (receivedChanges) => {
        received = receivedChanges;
        return {
          resources: receivedChanges.map(({ resource }) => ({ resource, contentSha: `${resource}-new-sha` })),
          commitSha: "cross-resource-commit-sha",
          baseCommitSha: "cross-resource-commit-sha",
        };
      },
      auditLog: () => {},
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(received, changes);
});

test("콘텐츠 일괄 경로는 PUT만 허용하고 쓰기 capability를 노출한다", async () => {
  for (const method of ["GET", "POST"]) {
    const response = await handleAdminApi(
      new Request("https://leaderscityhappy.com/api/admin/v1/content", { method }),
      authEnv,
      { authenticate: authenticated },
    );
    const body = await response.json();
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "PUT");
    assert.equal(body.error.code, "METHOD_NOT_ALLOWED");
  }

  const env = {
    ...authEnv,
    ADMIN_WRITE_ENABLED: "true",
    ADMIN_CSRF_SECRET: "12345678901234567890123456789012",
    GITHUB_CONTENTS_TOKEN: "test-token",
    GITHUB_REPOSITORY: "owner/repository",
    GITHUB_BRANCH: "master",
  };
  const response = await handleAdminApi(
    new Request("https://leaderscityhappy.com/api/admin/v1/system"),
    env,
    { authenticate: authenticated },
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.data.writeEnabled, true);
  assert.equal(body.data.capabilities.includes("content-batch-write"), true);
});

test("관리 API 일괄 저장은 빈 변경, 중복, 비허용 resource, data 누락을 snapshot 조회 전에 거부한다", async () => {
  const env = {
    ...authEnv,
    ADMIN_WRITE_ENABLED: "true",
    ADMIN_CSRF_SECRET: "12345678901234567890123456789012",
    GITHUB_CONTENTS_TOKEN: "test-token",
    GITHUB_REPOSITORY: "owner/repository",
    GITHUB_BRANCH: "master",
  };
  const csrfToken = await createCsrfToken("owner@example.com", env.ADMIN_CSRF_SECRET);
  const cases = [
    { changes: [], code: "CHANGES_REQUIRED" },
    {
      changes: [
        { resource: "faq", sha: "faq-sha", data: currentResources.faq },
        { resource: "faq", sha: "faq-sha", data: currentResources.faq },
      ],
      code: "DUPLICATE_RESOURCE",
    },
    {
      changes: [{ resource: "../faq", sha: "faq-sha", data: currentResources.faq }],
      code: "RESOURCE_NOT_ALLOWED",
    },
    { changes: [{ resource: "faq", sha: "faq-sha" }], code: "DATA_REQUIRED" },
  ];

  for (const { changes, code } of cases) {
    let snapshotReads = 0;
    let writeCalled = false;
    const response = await handleAdminApi(
      new Request("https://leaderscityhappy.com/api/admin/v1/content", {
        method: "PUT",
        headers: {
          Origin: "https://leaderscityhappy.com",
          "Content-Type": "application/json",
          "X-Admin-CSRF": csrfToken,
        },
        body: JSON.stringify({ changes }),
      }),
      env,
      {
        authenticate: authenticated,
        readResourcesSnapshot: async () => { snapshotReads += 1; return currentSnapshot; },
        writeResources: async () => { writeCalled = true; return {}; },
        auditLog: () => {},
      },
    );
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.equal(body.error.code, code);
    assert.equal(snapshotReads, 0);
    assert.equal(writeCalled, false);
  }
});

test("단일 콘텐츠 경로의 비허용 resource는 기존 404를 유지한다", async () => {
  const env = {
    ...authEnv,
    ADMIN_WRITE_ENABLED: "true",
    ADMIN_CSRF_SECRET: "12345678901234567890123456789012",
    GITHUB_CONTENTS_TOKEN: "test-token",
    GITHUB_REPOSITORY: "owner/repository",
    GITHUB_BRANCH: "master",
  };
  const csrfToken = await createCsrfToken("owner@example.com", env.ADMIN_CSRF_SECRET);
  let snapshotReads = 0;
  const response = await handleAdminApi(
    new Request("https://leaderscityhappy.com/api/admin/v1/content/not-allowed", {
      method: "PUT",
      headers: {
        Origin: "https://leaderscityhappy.com",
        "Content-Type": "application/json",
        "X-Admin-CSRF": csrfToken,
      },
      body: JSON.stringify({ sha: "not-allowed-sha", data: {} }),
    }),
    env,
    {
      authenticate: authenticated,
      readResourcesSnapshot: async () => { snapshotReads += 1; return currentSnapshot; },
      auditLog: () => {},
    },
  );
  const body = await response.json();

  assert.equal(response.status, 404);
  assert.equal(body.error.code, "RESOURCE_NOT_ALLOWED");
  assert.equal(snapshotReads, 0);
});

test("콘텐츠 일괄 저장의 정확한 URL도 잘못된 CSRF 토큰을 차단한다", async () => {
  const env = {
    ...authEnv,
    ADMIN_WRITE_ENABLED: "true",
    ADMIN_CSRF_SECRET: "12345678901234567890123456789012",
    GITHUB_CONTENTS_TOKEN: "test-token",
    GITHUB_REPOSITORY: "owner/repository",
    GITHUB_BRANCH: "master",
  };
  let snapshotReads = 0;
  let writeCalled = false;
  const response = await handleAdminApi(
    new Request("https://leaderscityhappy.com/api/admin/v1/content", {
      method: "PUT",
      headers: {
        Origin: "https://leaderscityhappy.com",
        "Content-Type": "application/json",
        "X-Admin-CSRF": "invalid-token",
      },
      body: JSON.stringify({
        changes: [{ resource: "faq", sha: "faq-sha", data: currentResources.faq }],
      }),
    }),
    env,
    {
      authenticate: authenticated,
      readResourcesSnapshot: async () => { snapshotReads += 1; return currentSnapshot; },
      writeResources: async () => { writeCalled = true; return {}; },
      auditLog: () => {},
    },
  );
  const body = await response.json();

  assert.equal(response.status, 403);
  assert.equal(body.error.code, "CSRF_INVALID");
  assert.equal(snapshotReads, 0);
  assert.equal(writeCalled, false);
});

test("관리 API 일괄 저장은 한 파일이라도 검증 실패하면 Git 쓰기를 호출하지 않는다", async () => {
  const env = {
    ...authEnv,
    ADMIN_WRITE_ENABLED: "true",
    ADMIN_CSRF_SECRET: "12345678901234567890123456789012",
    GITHUB_CONTENTS_TOKEN: "test-token",
    GITHUB_REPOSITORY: "owner/repository",
    GITHUB_BRANCH: "master",
  };
  const csrfToken = await createCsrfToken("owner@example.com", env.ADMIN_CSRF_SECRET);
  let writeCalled = false;
  const response = await handleAdminApi(
    new Request("https://leaderscityhappy.com/api/admin/v1/content", {
      method: "PUT",
      headers: {
        Origin: "https://leaderscityhappy.com",
        "Content-Type": "application/json",
        "X-Admin-CSRF": csrfToken,
      },
      body: JSON.stringify({
        changes: [
          {
            resource: "home-content",
            sha: "home-content-sha",
            data: currentResources["home-content"],
          },
          {
            resource: "faq",
            sha: "faq-sha",
            data: [{ question: "카테고리가 없으면 어떻게 되나요?", answer: "저장을 거부합니다." }],
          },
        ],
      }),
    }),
    env,
    {
      authenticate: authenticated,
      readResourcesSnapshot: async () => currentSnapshot,
      writeResources: async () => { writeCalled = true; return {}; },
      auditLog: () => {},
    },
  );
  const body = await response.json();

  assert.equal(response.status, 422);
  assert.equal(body.error.code, "CONTENT_VALIDATION_FAILED");
  assert.match(body.error.details.join("\n"), /category/);
  assert.equal(writeCalled, false);
});

test("관리 API 일괄 저장은 한 파일의 SHA가 오래됐으면 Git 쓰기를 호출하지 않는다", async () => {
  const env = {
    ...authEnv,
    ADMIN_WRITE_ENABLED: "true",
    ADMIN_CSRF_SECRET: "12345678901234567890123456789012",
    GITHUB_CONTENTS_TOKEN: "test-token",
    GITHUB_REPOSITORY: "owner/repository",
    GITHUB_BRANCH: "master",
  };
  const csrfToken = await createCsrfToken("owner@example.com", env.ADMIN_CSRF_SECRET);
  let writeCalled = false;
  const response = await handleAdminApi(
    new Request("https://leaderscityhappy.com/api/admin/v1/content", {
      method: "PUT",
      headers: {
        Origin: "https://leaderscityhappy.com",
        "Content-Type": "application/json",
        "X-Admin-CSRF": csrfToken,
      },
      body: JSON.stringify({
        changes: [
          { resource: "home-content", sha: "home-content-sha", data: currentResources["home-content"] },
          { resource: "faq", sha: "stale-sha", data: currentResources.faq },
        ],
      }),
    }),
    env,
    {
      authenticate: authenticated,
      readResourcesSnapshot: async () => currentSnapshot,
      writeResources: async () => { writeCalled = true; return {}; },
      auditLog: () => {},
    },
  );
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.equal(body.error.code, "GITHUB_CONFLICT");
  assert.equal(writeCalled, false);
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
    { authenticate: authenticated, auditLog: () => {} },
  );
  const body = await response.json();
  assert.equal(response.status, 403);
  assert.equal(body.error.code, "ORIGIN_DENIED");
});

test("관리자 쓰기는 명시적 HTTPS 오리진과 정확한 JSON media type만 허용한다", async () => {
  const env = {
    ...authEnv,
    ADMIN_WRITE_ENABLED: "true",
    ADMIN_CSRF_SECRET: "12345678901234567890123456789012",
    GITHUB_CONTENTS_TOKEN: "test-token",
    GITHUB_REPOSITORY: "owner/repository",
    GITHUB_BRANCH: "master",
  };
  const actor = await authenticated();
  const csrfToken = await createCsrfToken(actor.email, env.ADMIN_CSRF_SECRET);
  const request = (url, origin, contentType = "application/json") => new Request(url, {
    method: "PUT",
    headers: { Origin: origin, "Content-Type": contentType, "X-Admin-CSRF": csrfToken },
    body: "{}",
  });

  await validateAdminWriteRequest(
    request("https://leaderscityhappy.com/api/admin/v1/content/faq", "https://leaderscityhappy.com", "application/json; charset=utf-8"),
    actor,
    env,
  );
  await validateAdminWriteRequest(
    request("https://preview.example.com/api/admin/v1/content/faq", "https://preview.example.com"),
    actor,
    { ...env, ADMIN_ALLOWED_ORIGINS: "https://preview.example.com" },
  );
  await assert.rejects(
    validateAdminWriteRequest(
      request("https://leaderscityhappy.example.workers.dev/api/admin/v1/content/faq", "https://leaderscityhappy.example.workers.dev"),
      actor,
      env,
    ),
    (error) => error.code === "ORIGIN_DENIED" && error.status === 403,
  );
  await assert.rejects(
    validateAdminWriteRequest(
      request("http://localhost:4321/api/admin/v1/content/faq", "http://localhost:4321"),
      actor,
      env,
    ),
    (error) => error.code === "ORIGIN_DENIED" && error.status === 403,
  );
  await assert.rejects(
    validateAdminWriteRequest(
      request("https://leaderscityhappy.com/api/admin/v1/content/faq", "https://leaderscityhappy.com", "application/jsonp"),
      actor,
      env,
    ),
    (error) => error.code === "CONTENT_TYPE_REQUIRED" && error.status === 415,
  );

  assert.deepEqual([...parseAdminAllowedOrigins(undefined)], ["https://leaderscityhappy.com"]);
  assert.deepEqual(
    [...parseAdminAllowedOrigins("https://preview.example.com, https://leaderscityhappy.com")],
    ["https://preview.example.com", "https://leaderscityhappy.com"],
  );
  assert.throws(
    () => parseAdminAllowedOrigins("http://localhost:4321"),
    (error) => error.code === "ORIGIN_CONFIG_INVALID" && error.status === 503,
  );
  assert.equal(isAdminWriteEnabled({ ...env, ADMIN_ALLOWED_ORIGINS: "http://localhost:4321" }), false);
});

test("관리자 JSON 본문은 Content-Length와 무관하게 실제 3MB를 넘으면 중단한다", async () => {
  const env = {
    ...authEnv,
    ADMIN_WRITE_ENABLED: "true",
    ADMIN_CSRF_SECRET: "12345678901234567890123456789012",
    GITHUB_CONTENTS_TOKEN: "test-token",
    GITHUB_REPOSITORY: "owner/repository",
    GITHUB_BRANCH: "master",
  };
  const csrfToken = await createCsrfToken("owner@example.com", env.ADMIN_CSRF_SECRET);
  const encoder = new TextEncoder();
  const bodyStream = (...chunks) => new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk));
      controller.close();
    },
  });
  const headers = {
    Origin: "https://leaderscityhappy.com",
    "Content-Type": "application/json",
    "X-Admin-CSRF": csrfToken,
  };
  let previewCalls = 0;
  const options = {
    authenticate: authenticated,
    fetchLinkPreview: async (body) => {
      previewCalls += 1;
      return { title: body.url, summary: "", thumbnailDataUrl: null };
    },
  };

  const validResponse = await handleAdminApi(
    new Request("https://leaderscityhappy.com/api/admin/v1/external-links/preview", {
      method: "POST",
      headers,
      body: bodyStream('{"type":"blog",', '"url":"https://blog.naver.com/p5468300/1"}'),
      duplex: "half",
    }),
    env,
    options,
  );
  assert.equal(validResponse.status, 200);
  assert.equal(previewCalls, 1);

  const oversizedResponse = await handleAdminApi(
    new Request("https://leaderscityhappy.com/api/admin/v1/external-links/preview", {
      method: "POST",
      headers: { ...headers, "Content-Length": "1" },
      body: bodyStream(new Uint8Array((3 * 1024 * 1024) + 1).fill(0x20)),
      duplex: "half",
    }),
    env,
    options,
  );
  const oversizedBody = await oversizedResponse.json();
  assert.equal(oversizedResponse.status, 413);
  assert.equal(oversizedBody.error.code, "REQUEST_TOO_LARGE");
  assert.equal(previewCalls, 1);
});

test("관리자 저장은 한 commit snapshot의 관련 JSON 전체를 검증한 뒤 GitHub 쓰기를 중단한다", async () => {
  const env = {
    ...authEnv,
    ADMIN_WRITE_ENABLED: "true",
    ADMIN_CSRF_SECRET: "12345678901234567890123456789012",
    GITHUB_CONTENTS_TOKEN: "test-token",
    GITHUB_REPOSITORY: "owner/repository",
    GITHUB_BRANCH: "master",
  };
  const csrfToken = await createCsrfToken("owner@example.com", env.ADMIN_CSRF_SECRET);
  const relatedId = currentResources["complexes-overview"].relatedContentIds[0];
  const candidate = currentResources["external-links"].filter((item) => item.id !== relatedId);
  let writeCalled = false;
  const auditEvents = [];
  const response = await handleAdminApi(
    new Request("https://leaderscityhappy.com/api/admin/v1/content/external-links", {
      method: "PUT",
      headers: {
        Origin: "https://leaderscityhappy.com",
        "Content-Type": "application/json",
        "X-Admin-CSRF": csrfToken,
      },
      body: JSON.stringify({ sha: "external-links-sha", data: candidate }),
    }),
    env,
    {
      authenticate: authenticated,
      readResourcesSnapshot: async () => currentSnapshot,
      writeResource: async () => { writeCalled = true; return {}; },
      auditLog: (entry) => auditEvents.push(entry),
    },
  );
  const body = await response.json();

  assert.equal(response.status, 422);
  assert.equal(body.error.code, "CONTENT_VALIDATION_FAILED");
  assert.match(body.error.details.join("\n"), /external-links\.json에 없는 ID/);
  assert.equal(writeCalled, false);
  assert.equal(auditEvents[0].errorCode, "CONTENT_VALIDATION_FAILED");
  assert.doesNotMatch(JSON.stringify(auditEvents), /owner@example\.com|external-links-sha/u);
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
