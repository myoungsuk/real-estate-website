// 가짜 대신 진짜 업무 API(worker/admin-api.mjs → worker/work-*.mjs)를 브라우저 요청에 이어 붙인다.
// - 자료는 시험마다 새로 만든 메모리 DB(node:sqlite, migrations/work 전부, tests/work-test-kit.mjs)에만 쓴다. 원격 D1·외부 요청은 없다.
// - Access 로그인은 시험용 열쇠로 서명한 토큰을 붙여 흉내 내고, 쓰기 요청은 브라우저가 받은 CSRF 값을 그대로 넘긴다(서버가 검사).
// - 업무 API 밖(/api/admin/v1/work 아닌 곳)은 가짜 API와 같이 503으로 막는다.
import { randomUUID } from "node:crypto";
import { ORIGIN, authenticate, freshDb, rows, signToken, workEnv } from "../../tests/work-test-kit.mjs";
import { handleAdminApi } from "../../worker/admin-api.mjs";

const offline = { status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, error: { code: "TEST_OFFLINE", message: "시험 오류", retryable: true, details: [] }, requestId: "test" }) };

/**
 * @param {import("@playwright/test").Page} page
 * @param {{ now: Date }} options now: 서버 시각(브라우저 시계는 시험이 page.clock으로 따로 정함)
 */
export async function setupRealWorkApi(page, { now }) {
  const { database, db } = freshDb();
  const env = workEnv(db);
  const token = await signToken();
  const serverNow = now.getTime();
  const calls = [];
  await page.route("**/api/admin/**", (route) => route.fulfill(offline));
  await page.route("**/api/admin/v1/work/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const reading = method === "GET" || method === "HEAD";
    /** @type {Record<string, string>} */
    const headers = { "Cf-Access-Jwt-Assertion": token };
    const sent = request.headers();
    if (sent["x-admin-csrf"]) headers["X-Admin-CSRF"] = sent["x-admin-csrf"];
    if (!reading) {
      headers.Origin = ORIGIN;
      if (sent["content-type"]) headers["Content-Type"] = sent["content-type"];
    }
    calls.push(`${method} ${url.pathname.replace(/^.*\/api\/admin\/v1\/work/u, "")}${url.search}`);
    const response = await handleAdminApi(
      new Request(`${ORIGIN}${url.pathname}${url.search}`, { method, headers, body: reading ? undefined : request.postData() ?? undefined }),
      env,
      {
        authenticate,
        work: {
          now: () => serverNow,
          auditLog() {},
          randomUUID,
          openaiFetch: async () => {
            throw new Error("이 시험은 OpenAI를 부르지 않아야 함");
          },
        },
      },
    );
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
  });
  return { calls, rows: (sql, ...values) => rows(database, sql, ...values) };
}
