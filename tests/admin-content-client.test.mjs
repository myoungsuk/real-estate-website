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
