// 휴대폰 캘린더 구독 시험(e2e/admin-calendar-feed.spec.mjs)과 사용 안내 그림 찍기(e2e/help-shots/)가 함께 쓰는 가짜 업무 API.
// 2026-11-24 시험 파일에서 그대로 옮김(사용자 결정 2026-11-24 10:46:13 "B 단계 그림 줄"). 실제 서버·D1은 부르지 않는다.

export const NOW = new Date("2026-11-23T01:00:00Z"); // 한국 11월 23일(월) 10:00
export const PAGE = "/admin/work/schedule/";
export const TOKEN = "Q2x7mVt0aKc9PzL1sWn4dR8yXb3uE6fHj5oGiTqNw0A";
export const SUBSCRIBE = `http://127.0.0.1:4321/api/calendar/${TOKEN}.ics`;
export const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const envelope = (data, status = 200) => ({ status, json: { ok: true, data, requestId: "test" } });
export const failure = (status, code) => ({ status, json: { ok: false, error: { code, message: "시험 오류", retryable: false }, requestId: "test" } });
export const feedRow = (n, createdAt, lastUsedAt = null) => ({ id: uuid(n), label: "", createdAt, lastUsedAt, revokedAt: null });

export async function setup(page, { width = 390, enabled = true, feeds = [], failCreate = null } = {}) {
  await page.clock.install({ time: NOW });
  await page.setViewportSize({ width, height: 900 });
  const calls = { all: [], writes: [] };
  const state = { feeds: feeds.map((item) => ({ ...item })), next: 500 };
  await page.route("**/api/admin/**", (route) => route.fulfill(failure(503, "TEST_OFFLINE")));
  await page.route("**/api/admin/v1/work/**", (route) => {
    const request = route.request();
    const method = request.method();
    const path = new URL(request.url()).pathname.replace(/^.*\/api\/admin\/v1\/work/u, "");
    calls.all.push(`${method} ${path}`);
    if (method !== "GET") {
      calls.writes.push({ method, path, csrf: request.headers()["x-admin-csrf"], body: request.postDataJSON() });
      if (request.headers()["x-admin-csrf"] !== "test-csrf") return route.fulfill(failure(403, "CSRF_INVALID"));
    }
    if (path === "/session") return route.fulfill(envelope({ enabled, filesEnabled: false, administrator: enabled ? "시험 관리자" : null, csrfToken: enabled ? "test-csrf" : null, schemaVersion: enabled ? 7 : null }));
    if (path === "/calendar-feeds" && method === "GET") return route.fulfill(envelope({ feeds: state.feeds }));
    if (path === "/calendar-feeds" && method === "POST") {
      if (failCreate) return route.fulfill(failure(503, failCreate));
      const feed = feedRow(state.next++, NOW.toISOString());
      state.feeds = [feed];
      return route.fulfill(envelope({ feed, subscribeUrl: SUBSCRIBE }, 201));
    }
    const one = path.match(/^\/calendar-feeds\/([^/]+)$/u);
    if (one && method === "DELETE") {
      const id = decodeURIComponent(one[1]);
      if (!state.feeds.some((item) => item.id === id)) return route.fulfill(failure(404, "NOT_FOUND"));
      state.feeds = state.feeds.filter((item) => item.id !== id);
      return route.fulfill(envelope({ revoked: true }));
    }
    return route.fulfill(failure(404, "NOT_FOUND"));
  });
  return { calls, state };
}
