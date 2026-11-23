// '계약 일정' 화면의 휴대폰 캘린더 구독 칸(단계 3 C-b, 사용자 결정 2026-11-23 08:55:04 "가안: 맨 아래 칸 하나 (Recommended)")을 가짜 업무 API로 본다.
// 구독 주소·토큰은 가상 값이다. 실제 서버·D1은 부르지 않는다.
import { expect, test } from "@playwright/test";

const NOW = new Date("2026-11-23T01:00:00Z"); // 한국 11월 23일(월) 10:00
const PAGE = "/admin/work/schedule/";
const TOKEN = "Q2x7mVt0aKc9PzL1sWn4dR8yXb3uE6fHj5oGiTqNw0A";
const SUBSCRIBE = `http://127.0.0.1:4321/api/calendar/${TOKEN}.ics`;
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const envelope = (data, status = 200) => ({ status, json: { ok: true, data, requestId: "test" } });
const failure = (status, code) => ({ status, json: { ok: false, error: { code, message: "시험 오류", retryable: false }, requestId: "test" } });
const feedRow = (n, createdAt, lastUsedAt = null) => ({ id: uuid(n), label: "", createdAt, lastUsedAt, revokedAt: null });

async function setup(page, { width = 390, enabled = true, feeds = [], failCreate = null } = {}) {
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

function collectErrors(page) {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !/Failed to load resource/u.test(message.text())) errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return () => expect(errors, "브라우저 콘솔 오류가 없어야 합니다").toEqual([]);
}
const overflowOf = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const lineCount = (locator) => locator.evaluate((node) => {
  const tops = [];
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    if (!walker.currentNode.textContent.trim()) continue;
    const range = document.createRange();
    range.selectNodeContents(walker.currentNode);
    for (const rect of range.getClientRects()) if (rect.width > 0) tops.push(rect.top);
  }
  tops.sort((a, b) => a - b);
  return tops.filter((top, index) => index === 0 || top - tops[index - 1] > 4).length;
});
async function expectControls(panel, label) {
  const controls = panel.locator("button:visible, a.work-secondary-button:visible");
  expect(await controls.count(), `${label}: 보이는 단추`).toBeGreaterThan(0);
  for (const control of await controls.all()) {
    const box = await control.boundingBox();
    const text = (await control.textContent()).trim();
    expect(box.height, `${label} '${text}' 높이`).toBeGreaterThanOrEqual(44);
    expect(box.width, `${label} '${text}' 너비`).toBeGreaterThanOrEqual(44);
    expect(await lineCount(control), `${label} '${text}' 한 줄`).toBe(1);
  }
}
// 주소(토큰)가 화면 주소·브라우저 저장소·제목에 남지 않았는지
const tokenLeaks = (page) => page.evaluate((token) => {
  const stores = [localStorage, sessionStorage].flatMap((store) => Object.keys(store).map((key) => `${key}=${store.getItem(key)}`));
  return [location.href, document.title, ...stores].filter((text) => text.includes(token));
}, TOKEN);

test("구독 칸: 주소가 없으면 '구독 주소 만들기', 만들면 그 한 번만 주소·복사·iPhone(webcal)·Google 넣기가 보이고, 다시 열면 '주소 있음'으로 바뀌어 주소가 다시 보이지 않는다", async ({ page, context }) => {
  const assertNoErrors = collectErrors(page);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const { calls } = await setup(page);
  await page.goto(PAGE);
  const panel = page.locator("[data-cf-panel]");
  await expect(panel.getByRole("heading", { name: "휴대폰 캘린더 구독" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "구독 주소 만들기" })).toBeVisible();
  await expect(panel).toContainText("취소한 거래의 일정은 빠집니다");
  // 위 계산기는 그대로(서버와 상관없이 처음 안내가 나옴)
  await expect(page.locator("[data-schedule-message]")).toHaveText("실제 거래가격을 넣으면 자금조달계획서 대상까지 판정합니다.");
  const box = await panel.boundingBox();
  const legal = await page.locator(".work-tool").boundingBox();
  expect(box.y, "칸은 계산기 아래").toBeGreaterThan(legal.y + legal.height - 1);

  await panel.getByRole("button", { name: "구독 주소 만들기" }).click();
  await expect(panel.locator("[data-cf-status]")).toHaveText("✓ 구독 주소를 만들었습니다. 아래 단추로 휴대폰 캘린더에 넣으세요.");
  expect(calls.writes).toEqual([{ method: "POST", path: "/calendar-feeds", csrf: "test-csrf", body: {} }]);
  await expect(panel.getByLabel("구독 주소", { exact: true })).toHaveValue(SUBSCRIBE);
  await expect(panel).toContainText("이 주소는 지금 한 번만 보입니다.");
  await expect(panel.getByRole("link", { name: "iPhone 캘린더에 넣기" })).toHaveAttribute("href", `webcal://127.0.0.1:4321/api/calendar/${TOKEN}.ics`);
  const google = new URL(await panel.getByRole("link", { name: "Google 캘린더에 넣기" }).getAttribute("href"));
  expect(google.origin + google.pathname).toBe("https://calendar.google.com/calendar/r");
  expect(google.searchParams.get("cid")).toBe(`webcal://127.0.0.1:4321/api/calendar/${TOKEN}.ics`);
  await expect(panel.getByRole("link", { name: "Google 캘린더에 넣기" })).toHaveAttribute("rel", "noopener noreferrer");
  await panel.getByRole("button", { name: "주소 복사" }).click();
  await expect(panel.locator("[data-cf-status]")).toContainText("✓ 주소를 복사했습니다.");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(SUBSCRIBE);
  expect(await tokenLeaks(page)).toEqual([]);

  await page.reload();
  await expect(panel.locator("[data-cf-existing]")).toBeVisible();
  await expect(panel.locator("[data-cf-made]")).toHaveText("11월 23일(월)");
  await expect(panel.locator("[data-cf-used]")).toHaveText("아직 받아 가지 않음");
  expect(await panel.locator("[data-cf-url]").inputValue()).toBe("");
  expect(await page.content()).not.toContain(TOKEN);
  expect(await tokenLeaks(page)).toEqual([]);
  assertNoErrors();
});

test("주소 있음: '새 주소 만들기'·'구독 주소 취소'는 칸 안에서 한 번 더 묻고, 그만두면 아무것도 보내지 않으며, 취소하면 주소 없음으로 돌아간다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const { calls } = await setup(page, { feeds: [feedRow(1, "2026-11-22T01:00:00.000Z", "2026-11-22T15:10:00.000Z")] });
  await page.goto(PAGE);
  const panel = page.locator("[data-cf-panel]");
  await expect(panel.locator("[data-cf-made]")).toHaveText("11월 22일(일)");
  await expect(panel.locator("[data-cf-used]")).toHaveText("11월 23일(월)");
  const replace = panel.getByRole("button", { name: "새 주소 만들기" }).first();
  const revoke = panel.getByRole("button", { name: "구독 주소 취소" }).first();
  const confirm = panel.locator("[data-cf-confirm]");

  await replace.click();
  await expect(replace).toHaveAttribute("aria-expanded", "true");
  await expect(confirm).toContainText("지금 주소를 끊고 새 주소를 만들까요?");
  await confirm.getByRole("button", { name: "그만두기" }).click();
  await expect(confirm).toBeHidden();
  await expect(replace).toBeFocused();
  expect(calls.writes).toEqual([]);

  await revoke.click();
  await expect(confirm).toContainText("구독 주소를 취소할까요?");
  await confirm.getByRole("button", { name: "구독 주소 취소" }).click();
  await expect(panel.locator("[data-cf-status]")).toHaveText("✓ 구독 주소를 취소했습니다. 휴대폰 캘린더에서도 이 구독을 지워 주세요.");
  expect(calls.writes).toEqual([{ method: "DELETE", path: `/calendar-feeds/${uuid(1)}`, csrf: "test-csrf", body: {} }]);
  await expect(panel.getByRole("button", { name: "구독 주소 만들기" })).toBeVisible();

  await page.reload();
  await page.locator("[data-cf-panel]").getByRole("button", { name: "구독 주소 만들기" }).click();
  await expect(panel.getByLabel("구독 주소", { exact: true })).toHaveValue(SUBSCRIBE);
  await page.reload();
  await panel.getByRole("button", { name: "새 주소 만들기" }).first().click();
  await confirm.getByRole("button", { name: "새 주소 만들기" }).click();
  await expect(panel.getByLabel("구독 주소", { exact: true })).toHaveValue(SUBSCRIBE);
  expect(calls.writes.map((item) => `${item.method} ${item.path}`)).toEqual([`DELETE /calendar-feeds/${uuid(1)}`, "POST /calendar-feeds", "POST /calendar-feeds"]);
  assertNoErrors();
});

test("업무 도구가 꺼져 있으면 구독 목록을 부르지 않고 까닭만 보인다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const off = await setup(page, { enabled: false });
  await page.goto(PAGE);
  const panel = page.locator("[data-cf-panel]");
  await expect(panel.locator("[data-cf-state-text]")).toHaveText("업무 도구가 켜지면 구독 주소를 만들 수 있습니다.");
  await expect(panel.getByRole("button")).toHaveCount(0);
  expect(off.calls.all).toEqual(["GET /session"]);
  assertNoErrors();
});

test("해시 키가 없으면(503 WORK_CONFIG_MISSING) 구독 주소를 만들지 못한 까닭을 알리고 다시 누를 수 있다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  await setup(page, { failCreate: "WORK_CONFIG_MISSING" });
  await page.goto(PAGE);
  const panel = page.locator("[data-cf-panel]");
  await panel.getByRole("button", { name: "구독 주소 만들기" }).click();
  await expect(panel.locator("[data-cf-status]")).toHaveText("만들지 못했습니다. 구독 주소 설정이 아직 끝나지 않았습니다. 개발 담당에게 '구독 주소 설정 누락'이라고 알려 주세요.");
  await expect(panel.getByRole("button", { name: "구독 주소 만들기" })).toBeEnabled();
  assertNoErrors();
});

for (const width of [360, 390, 430, 768, 1280]) {
  test(`구독 칸 ${width}px: 세 상태 모두 단추 44px 이상·한 줄이고 가로로 넘치지 않는다`, async ({ page }) => {
    const assertNoErrors = collectErrors(page);
    await setup(page, { width, feeds: [feedRow(1, "2026-11-22T01:00:00.000Z")] });
    await page.goto(PAGE);
    const panel = page.locator("[data-cf-panel]");
    await expect(panel.locator("[data-cf-existing]")).toBeVisible();
    await expectControls(panel, "주소 있음");
    await panel.getByRole("button", { name: "구독 주소 취소" }).first().click();
    await expectControls(panel, "취소 확인");
    await panel.locator("[data-cf-confirm]").getByRole("button", { name: "구독 주소 취소" }).click();
    await expect(panel.getByRole("button", { name: "구독 주소 만들기" })).toBeVisible();
    await expectControls(panel, "주소 없음");
    await panel.getByRole("button", { name: "구독 주소 만들기" }).click();
    await expect(panel.getByLabel("구독 주소", { exact: true })).toHaveValue(SUBSCRIBE);
    await expectControls(panel, "막 만듦");
    const url = await panel.getByLabel("구독 주소", { exact: true }).evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
    expect(url, "주소 칸 16px 이상(iPhone 확대 방지)").toBeGreaterThanOrEqual(16);
    expect(await overflowOf(page)).toBeLessThanOrEqual(0);
    assertNoErrors();
  });
}
