import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const clientSource = await readFile(new URL("../src/lib/admin-content-client.ts", import.meta.url), "utf8");

async function loadClient() {
  const source = ts.transpileModule(clientSource, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const encoded = Buffer.from(`${source}\n// test-module-${crypto.randomUUID()}`).toString("base64");
  return import(`data:text/javascript;base64,${encoded}`);
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

test("만료된 CSRF는 새 세션을 받은 뒤 한 번만 재시도한다", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const calls = [];
  let sessionCount = 0;
  globalThis.fetch = async (url, init = {}) => {
    const csrf = init.headers?.["X-Admin-CSRF"] ?? null;
    calls.push({ url: String(url), csrf });
    if (String(url).endsWith("/session")) {
      sessionCount += 1;
      return jsonResponse({
        ok: true,
        data: {
          authenticated: true,
          administrator: "o***@example.com",
          authentication: "cloudflare-access-email-otp",
          writeEnabled: true,
          csrfToken: sessionCount === 1 ? "expired-token" : "fresh-token",
        },
      });
    }
    if (csrf === "expired-token") {
      return jsonResponse({ ok: false, error: { code: "CSRF_INVALID", message: "만료" } }, 403);
    }
    return jsonResponse({ ok: true, data: { resource: "faq", commitSha: "commit", contentSha: "content" } });
  };

  const client = await loadClient();
  const result = await client.writeAdminContent("faq", "source", []);

  assert.equal(result.commitSha, "commit");
  assert.deepEqual(calls, [
    { url: "/api/admin/v1/session", csrf: null },
    { url: "/api/admin/v1/content/faq", csrf: "expired-token" },
    { url: "/api/admin/v1/session", csrf: null },
    { url: "/api/admin/v1/content/faq", csrf: "fresh-token" },
  ]);
});

test("일괄 저장 클라이언트는 복수 변경과 non-null SHA 결과를 전달한다", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/session")) {
      return jsonResponse({
        ok: true,
        data: {
          authenticated: true,
          administrator: "o***@example.com",
          authentication: "cloudflare-access-email-otp",
          writeEnabled: true,
          csrfToken: "batch-token",
        },
      });
    }
    return jsonResponse({
      ok: true,
      data: {
        resources: [
          { resource: "external-links", contentSha: "external-links-new-sha" },
          { resource: "complexes-overview", contentSha: "complexes-overview-new-sha" },
        ],
        commitSha: "batch-commit-sha",
        baseCommitSha: "batch-commit-sha",
      },
    });
  };
  const changes = [
    { resource: "external-links", sha: "external-links-sha", data: [] },
    { resource: "complexes-overview", sha: "complexes-overview-sha", data: {} },
  ];

  const client = await loadClient();
  const result = await client.writeAdminContentBatch(changes);

  assert.equal(result.commitSha, "batch-commit-sha");
  assert.equal(result.baseCommitSha, "batch-commit-sha");
  assert.equal(result.resources[0].contentSha, "external-links-new-sha");
  assert.equal(calls[1].url, "/api/admin/v1/content");
  assert.equal(calls[1].init.method, "PUT");
  assert.equal(calls[1].init.headers["X-Admin-CSRF"], "batch-token");
  assert.deepEqual(JSON.parse(calls[1].init.body), { changes });
});

test("사전 검증 클라이언트는 저장과 분리된 POST 경로를 사용한다", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/session")) {
      return jsonResponse({
        ok: true,
        data: {
          authenticated: true,
          administrator: "o***@example.com",
          authentication: "cloudflare-access-email-otp",
          writeEnabled: true,
          csrfToken: "validate-token",
        },
      });
    }
    return jsonResponse({
      ok: true,
      data: {
        valid: true,
        snapshotCommit: "a".repeat(40),
        changedResources: ["home-content"],
        warnings: [],
      },
    });
  };
  const changes = [{ resource: "home-content", sha: "home-sha", data: { broker: {} } }];

  const client = await loadClient();
  const result = await client.validateAdminContent(changes);

  assert.equal(result.valid, true);
  assert.equal(calls[1].url, "/api/admin/v1/content/validate");
  assert.equal(calls[1].init.method, "POST");
  assert.equal(calls[1].init.headers["X-Admin-CSRF"], "validate-token");
  assert.deepEqual(JSON.parse(calls[1].init.body), { changes });
});

test("저장 결과의 commit과 resource digest를 기억하고 배포 상태 API로 조회한다", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalLocalStorage = globalThis.localStorage;
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalLocalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalLocalStorage;
  });
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const commit = "a".repeat(40);
  const digest = "b".repeat(64);
  const savedAt = "2026-08-31T00:00:00.000Z";
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/session")) {
      return jsonResponse({ ok: true, data: { writeEnabled: true, csrfToken: "token" } });
    }
    if (String(url).includes("/deployment-status?")) {
      return jsonResponse({ ok: true, data: {
        state: "published",
        savedCommit: commit,
        activeCommit: commit,
        branch: "master",
        sourceProvider: "workers-builds",
        resource: "faq",
        resourceMatched: true,
        workerVersion: null,
        checkedAt: savedAt,
        savedAt,
        pollAfterMs: null,
        reason: null,
      } });
    }
    return jsonResponse({ ok: true, data: {
      resource: "faq",
      commitSha: commit,
      contentSha: "content-sha",
      resourceDigest: digest,
      savedAt,
    } });
  };

  const client = await loadClient();
  await client.writeAdminContent("faq", "source-sha", []);
  const target = client.readRememberedAdminDeployment();
  assert.deepEqual(target, { commit, resource: "faq", digest, savedAt });
  const status = await client.readAdminDeploymentStatus(target);
  assert.equal(status.state, "published");
  assert.match(calls.at(-1).url, /commit=a{40}[^]*resource=faq[^]*digest=b{64}/u);
});

test("변경 이력 조회·과거 diff 대상·2차 확인 복원은 분리된 API를 사용한다", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalLocalStorage = globalThis.localStorage;
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalLocalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalLocalStorage;
  });
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const sourceCommit = "a".repeat(40);
  const currentCommit = "b".repeat(40);
  const currentBlob = "c".repeat(40);
  const restoreCommit = "d".repeat(40);
  const digest = "e".repeat(64);
  const savedAt = "2026-08-31T01:02:03.000Z";
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/session")) {
      return jsonResponse({ ok: true, data: { writeEnabled: true, csrfToken: "restore-token" } });
    }
    if (String(url).includes(`/content-history/home-content/${sourceCommit}`)) {
      return jsonResponse({ ok: true, data: {
        resource: "home-content",
        source: { commitSha: sourceCommit, resourceBlobSha: "f".repeat(40), resourceDigest: "1".repeat(64), data: { title: "과거" }, productionMatched: false },
        current: { commitSha: currentCommit, resourceBlobSha: currentBlob, data: { title: "현재" } },
        validation: { valid: true, errors: [] },
        confirmation: "home-content 이전 내용으로 복원",
      } });
    }
    if (String(url).includes("/content-history/home-content?")) {
      return jsonResponse({ ok: true, data: {
        resource: "home-content",
        entries: [{ commitSha: sourceCommit, title: "관리자: 수정" }],
        nextCursor: "Mg",
      } });
    }
    return jsonResponse({ ok: true, data: {
      resources: [{ resource: "home-content", contentSha: "2".repeat(40), resourceDigest: digest }],
      commitSha: restoreCommit,
      baseCommitSha: restoreCommit,
      sourceCommit,
      restoredResources: ["home-content"],
      savedAt,
    } });
  };

  const client = await loadClient();
  const history = await client.readAdminContentHistory("home-content", "Mg");
  assert.equal(history.nextCursor, "Mg");
  assert.match(calls[0].url, /content-history\/home-content\?limit=10&cursor=Mg/u);
  const revision = await client.readAdminContentRevision("home-content", sourceCommit);
  const result = await client.restoreAdminContent(revision, revision.confirmation);

  assert.equal(result.commitSha, restoreCommit);
  assert.equal(calls.at(-1).url, "/api/admin/v1/content/restore");
  assert.equal(calls.at(-1).init.method, "POST");
  assert.equal(calls.at(-1).init.headers["X-Admin-CSRF"], "restore-token");
  assert.deepEqual(JSON.parse(calls.at(-1).init.body), {
    sourceCommit,
    resources: [{ resource: "home-content", expectedCurrentSha: currentBlob }],
    confirmation: "home-content 이전 내용으로 복원",
  });
  assert.deepEqual(client.readRememberedAdminDeployment(), {
    commit: restoreCommit,
    resource: "home-content",
    digest,
    savedAt,
  });
});

test("CSRF 재시도도 거부되면 세 번째 쓰기 요청을 보내지 않는다", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const calls = [];
  let sessionCount = 0;
  globalThis.fetch = async (url, init = {}) => {
    const csrf = init.headers?.["X-Admin-CSRF"] ?? null;
    calls.push({ url: String(url), csrf });
    if (String(url).endsWith("/session")) {
      sessionCount += 1;
      return jsonResponse({
        ok: true,
        data: {
          authenticated: true,
          administrator: "o***@example.com",
          authentication: "cloudflare-access-email-otp",
          writeEnabled: true,
          csrfToken: `token-${sessionCount}`,
        },
      });
    }
    return jsonResponse({ ok: false, error: { code: "CSRF_INVALID", message: "만료" } }, 403);
  };

  const client = await loadClient();
  await assert.rejects(client.writeAdminContent("faq", "source", []), /만료/u);
  assert.deepEqual(calls, [
    { url: "/api/admin/v1/session", csrf: null },
    { url: "/api/admin/v1/content/faq", csrf: "token-1" },
    { url: "/api/admin/v1/session", csrf: null },
    { url: "/api/admin/v1/content/faq", csrf: "token-2" },
  ]);
});

test("오래된 세션 실패는 더 최신 session Promise 캐시를 지우지 않는다", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const pending = [];
  globalThis.fetch = () => new Promise((resolve, reject) => pending.push({ resolve, reject }));

  const client = await loadClient();
  const staleSession = client.getAdminSession();
  const staleRejection = assert.rejects(staleSession, /오래된 세션 실패/u);
  const freshSession = client.getAdminSession({ refresh: true });
  assert.equal(pending.length, 2);

  pending[1].resolve(jsonResponse({
    ok: true,
    data: {
      authenticated: true,
      administrator: "o***@example.com",
      authentication: "cloudflare-access-email-otp",
      writeEnabled: true,
      csrfToken: "fresh-token",
    },
  }));
  assert.equal((await freshSession).csrfToken, "fresh-token");

  pending[0].reject(new Error("오래된 세션 실패"));
  await staleRejection;
  assert.equal((await client.getAdminSession()).csrfToken, "fresh-token");
  assert.equal(pending.length, 2);
});
