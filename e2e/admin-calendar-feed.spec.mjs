// '계약 일정' 화면의 휴대폰 캘린더 구독 칸(단계 3 C-b, 사용자 결정 2026-11-23 08:55:04 "가안: 맨 아래 칸 하나 (Recommended)")을 가짜 업무 API로 본다.
// 구독 주소·토큰은 가상 값이다. 실제 서버·D1은 부르지 않는다.
import { expect, test } from "@playwright/test";
import { googleCalendarUrl, webcalUrl } from "../src/lib/work/calendar-feed-view.mjs";
import { encodeQr } from "../src/lib/work/qr.mjs";

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
// 누르는 곳: 휴대폰·태블릿은 44px, 마우스를 쓰는 1221px 이상 PC는 36px(사용자 승인 2026-11-23 11:34:13).
const tapMin = (page) => (page.viewportSize().width >= 1221 ? 36 : 44);
async function expectControls(panel, label) {
  const controls = panel.locator("button:visible, a.work-secondary-button:visible");
  expect(await controls.count(), `${label}: 보이는 단추`).toBeGreaterThan(0);
  for (const control of await controls.all()) {
    const box = await control.boundingBox();
    const text = (await control.textContent()).trim();
    expect(box.height, `${label} '${text}' 높이`).toBeGreaterThanOrEqual(tapMin(panel.page()));
    expect(box.width, `${label} '${text}' 너비`).toBeGreaterThanOrEqual(44);
    expect(await lineCount(control), `${label} '${text}' 한 줄`).toBe(1);
  }
}
// 주소(토큰)가 화면 주소·브라우저 저장소·제목에 남지 않았는지
const tokenLeaks = (page) => page.evaluate((token) => {
  const stores = [localStorage, sessionStorage].flatMap((store) => Object.keys(store).map((key) => `${key}=${store.getItem(key)}`));
  return [location.href, document.title, ...stores].filter((text) => text.includes(token));
}, TOKEN);
// canvas에 그려진 QR을 칸마다(가운데 픽셀) 읽어 0·1 줄로. 둘레 조용한 띠 4칸 포함. 한 칸은 화면 픽셀 정수 배(3 ~ 6px)여야 한다.
const QR_QUIET = 4;
const canvasModules = (canvas, count) => canvas.evaluate((node, count) => {
  const context = node.getContext("2d");
  const pixels = node.width / count;
  if (!Number.isInteger(pixels) || pixels < 3 || pixels > 6 || node.width !== node.height) return { pixels, size: [node.width, node.height], rows: [] };
  const rows = [];
  for (let y = 0; y < count; y += 1) {
    let row = "";
    for (let x = 0; x < count; x += 1) {
      const [r, g, b, a] = context.getImageData(x * pixels + pixels / 2, y * pixels + pixels / 2, 1, 1).data;
      row += r === 0 && g === 0 && b === 0 && a === 255 ? "1" : r === 255 && g === 255 && b === 255 && a === 255 ? "0" : "?";
    }
    rows.push(row);
  }
  return { rows };
}, count);
const expectedModules = (text) => {
  const { size, modules } = encodeQr(text);
  const side = size + QR_QUIET * 2;
  const blank = "0".repeat(side);
  const rows = modules.map((row) => "0".repeat(QR_QUIET) + row.map((dark) => (dark ? "1" : "0")).join("") + "0".repeat(QR_QUIET));
  return { rows: [...new Array(QR_QUIET).fill(blank), ...rows, ...new Array(QR_QUIET).fill(blank)] };
};

test("구독 칸: 주소가 없으면 '구독 주소 만들기', 만들면 그 한 번만 주소·복사·iPhone(webcal)·Google 넣기가 보이고, 다시 열면 '주소 있음'으로 바뀌어 주소가 다시 보이지 않는다", async ({ page, context }) => {
  const assertNoErrors = collectErrors(page);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const { calls } = await setup(page);
  await page.goto(PAGE);
  const panel = page.locator("[data-cf-panel]");
  await expect(panel.getByRole("heading", { name: "휴대폰 캘린더 구독" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "구독 주소 만들기" })).toBeVisible();
  await expect(panel).toContainText("취소한 거래의 일정은 빠집니다");
  const alarmHelp = panel.locator("[data-cf-alarm]");
  await expect(alarmHelp, "주소가 없으면 알림 안내도 없음").toBeHidden();
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
  // 알림 안내는 접힌 채 보이고, 펼치면 Google 캘린더 두 단계가 번호 목록으로 나온다
  await expect(alarmHelp).toBeVisible();
  await expect(alarmHelp.locator("ol")).toBeHidden();
  await alarmHelp.getByText("알림이 오지 않을 때", { exact: true }).click();
  await expect(alarmHelp.locator("ol li")).toHaveCount(2);
  await expect(alarmHelp.locator("ol li").first()).toContainText("'종일 일정 알림'");
  await expect(alarmHelp.locator("ol li").last()).toContainText("'동기화'");
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
  await expect(alarmHelp, "이미 넣은 휴대폰도 볼 수 있게 주소가 있을 때도 보임").toBeVisible();
  expect(await panel.locator("[data-cf-url]").inputValue()).toBe("");
  expect(await page.content()).not.toContain(TOKEN);
  expect(await tokenLeaks(page)).toEqual([]);
  assertNoErrors();
});
test("다른 휴대폰에 넘기기: QR은 단추를 눌러야 canvas에만 그려지고(iPhone용 = webcal 주소, Android용 = Google 캘린더 주소), 숨기거나 화면을 다시 열면 지워지며 서버·밖으로 아무것도 보내지 않는다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const { calls } = await setup(page);
  await page.goto(PAGE);
  const panel = page.locator("[data-cf-panel]");
  await expect(panel.getByRole("button", { name: "구독 주소 만들기" })).toBeVisible();
  await expect(panel.getByRole("button", { name: /QR/u })).toHaveCount(0); // 주소가 없을 때는 QR 단추가 없음
  await panel.getByRole("button", { name: "구독 주소 만들기" }).click();
  await expect(panel.getByLabel("구독 주소", { exact: true })).toHaveValue(SUBSCRIBE);

  const ios = panel.getByRole("button", { name: "iPhone용 QR 보기" });
  const android = panel.getByRole("button", { name: "Android용 QR 보기" });
  const canvas = panel.locator("[data-cf-qr-canvas]");
  const qrBox = panel.locator("[data-cf-qr-box]");
  await expect(panel.getByRole("heading", { name: "다른 휴대폰에 넘기기" })).toBeVisible();
  await expect(qrBox, "처음에는 펼쳐 두지 않음").toBeHidden();
  expect(await canvas.evaluate((node) => [node.width, node.height])).toEqual([0, 0]);
  await expect(ios).toHaveAttribute("aria-expanded", "false");

  const requests = [];
  page.on("request", (request) => requests.push(request.url()));
  const callsBefore = calls.all.length;

  await ios.click();
  await expect(qrBox).toBeVisible();
  await expect(ios).toHaveAttribute("aria-expanded", "true");
  await expect(android).toHaveAttribute("aria-expanded", "false");
  await expect(canvas).toHaveAttribute("aria-label", "iPhone용 구독 주소 QR 그림");
  await expect(panel.locator("[data-cf-qr-how]")).toHaveText("iPhone 카메라로 이 QR을 비추고, 화면에 뜨는 안내를 눌러 구독을 더하세요.");
  await expect(qrBox).toContainText("화면을 찍어 두거나 남에게 보내지 마세요.");
  const iosWant = expectedModules(webcalUrl(SUBSCRIBE));
  expect(await canvasModules(canvas, iosWant.rows.length), "iPhone용 QR = webcal 주소").toEqual(iosWant);

  await android.click();
  await expect(android).toHaveAttribute("aria-expanded", "true");
  await expect(ios).toHaveAttribute("aria-expanded", "false");
  await expect(canvas).toHaveAttribute("aria-label", "Android용 구독 주소 QR 그림");
  await expect(panel.locator("[data-cf-qr-how]")).toContainText("Google 캘린더 사이트가 열립니다.");
  const androidWant = expectedModules(googleCalendarUrl(SUBSCRIBE));
  expect(await canvasModules(canvas, androidWant.rows.length), "Android용 QR = Google 캘린더 주소").toEqual(androidWant);

  // 같은 단추를 다시 누르면 숨기고 픽셀째 지운다.
  await android.click();
  await expect(qrBox).toBeHidden();
  expect(await canvas.evaluate((node) => [node.width, node.height])).toEqual([0, 0]);
  await expect(android).toHaveAttribute("aria-expanded", "false");
  // 'QR 숨기기'는 열었던 단추로 초점을 돌려준다.
  await ios.click();
  await panel.getByRole("button", { name: "QR 숨기기" }).click();
  await expect(qrBox).toBeHidden();
  await expect(ios).toBeFocused();
  expect(await canvas.evaluate((node) => [node.width, node.height])).toEqual([0, 0]);

  // 그림은 canvas에만: img·링크·주소·저장소에 주소가 들어가지 않고, QR을 띄우는 동안 어떤 요청도 나가지 않는다.
  await ios.click();
  expect(await panel.locator("img, [src^='data:'], [src^='blob:'], [href^='data:'], [href^='blob:']").count()).toBe(0);
  expect(await tokenLeaks(page)).toEqual([]);
  expect(requests, "QR을 띄우는 동안 나간 요청").toEqual([]);
  expect(calls.all.slice(callsBefore)).toEqual([]);

  // 화면을 다시 열면 주소도 QR도 다시 보이지 않는다.
  await page.reload();
  await expect(panel.locator("[data-cf-existing]")).toBeVisible();
  await expect(panel.getByRole("button", { name: /QR/u })).toHaveCount(0);
  expect(await canvas.evaluate((node) => [node.width, node.height])).toEqual([0, 0]);
  expect(await page.content()).not.toContain(TOKEN);
  assertNoErrors();
});

test("화면을 떠날 때(pagehide) 구독 주소 입력칸·넣기 고리·QR 그림을 지우고, 뒤로 가기 캐시로 돌아오면(pageshow) '주소 있음'으로 다시 읽는다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const { calls } = await setup(page);
  await page.goto(PAGE);
  const panel = page.locator("[data-cf-panel]");
  await panel.getByRole("button", { name: "구독 주소 만들기" }).click();
  const urlInput = panel.getByLabel("구독 주소", { exact: true });
  await expect(urlInput).toHaveValue(SUBSCRIBE);
  const canvas = panel.locator("[data-cf-qr-canvas]");
  await panel.getByRole("button", { name: "iPhone용 QR 보기" }).click();
  await expect(panel.locator("[data-cf-qr-box]")).toBeVisible();
  expect((await canvas.evaluate((node) => node.width)) > 0, "떠나기 전에는 QR이 그려져 있음").toBe(true);
  expect(await panel.locator(`a[href*="${TOKEN}"]`).count(), "떠나기 전에는 넣기 고리에 주소가 있음").toBeGreaterThan(0);

  // 떠날 때: 뒤로 가기 캐시에 화면이 남아도 주소·QR은 남지 않는다.
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
  expect(await urlInput.inputValue(), "입력칸을 비움").toBe("");
  expect(await canvas.evaluate((node) => [node.width, node.height]), "QR 그림을 픽셀째 지움").toEqual([0, 0]);
  await expect(panel.locator("[data-cf-qr-box]")).toBeHidden();
  expect(await panel.locator(`a[href*="${TOKEN}"]`).count(), "넣기 고리에서 주소를 뺌").toBe(0);
  expect(await page.content()).not.toContain(TOKEN);
  expect(await tokenLeaks(page)).toEqual([]);

  // 돌아올 때: 목록을 다시 읽어 '주소 있음'으로 바꾼다(주소는 다시 보이지 않음).
  const callsBefore = calls.all.length;
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  await expect(panel.locator("[data-cf-existing]")).toBeVisible();
  await expect(panel.getByRole("button", { name: /QR/u })).toHaveCount(0);
  expect(calls.all.slice(callsBefore).length, "돌아오면 서버에 다시 물음").toBeGreaterThan(0);
  expect(await page.content()).not.toContain(TOKEN);
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
  test(`구독 칸 ${width}px: 세 상태 모두 단추 44px(마우스 PC는 36px) 이상·한 줄이고 가로로 넘치지 않는다`, async ({ page }) => {
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
    // QR을 띄운 모습: 그림이 칸 밖으로 나가지 않고, CSS로 늘이거나 줄이지 않으며(그린 크기 = 보이는 크기), 한 칸이 화면 픽셀 정수 배로 4px 이상
    for (const [name, text] of [["iPhone용 QR 보기", webcalUrl(SUBSCRIBE)], ["Android용 QR 보기", googleCalendarUrl(SUBSCRIBE)]]) {
      await panel.getByRole("button", { name }).click();
      const canvas = panel.locator("[data-cf-qr-canvas]");
      const inner = await panel.locator("[data-cf-qr-box]").boundingBox();
      const shown = await canvas.evaluate((node) => ({ drawn: node.width, width: node.clientWidth, height: node.clientHeight, left: node.getBoundingClientRect().left, right: node.getBoundingClientRect().right }));
      const side = expectedModules(text).rows.length;
      expect([shown.width, shown.height], `${name} 그린 크기 그대로·정사각형`).toEqual([shown.drawn, shown.drawn]);
      expect(shown.right, `${name} 칸 안`).toBeLessThanOrEqual(inner.x + inner.width + 0.5);
      expect(Number.isInteger(shown.drawn / side), `${name} 한 칸은 정수 픽셀`).toBe(true);
      expect(shown.drawn / side, `${name} 한 칸 크기`).toBeGreaterThanOrEqual(4);
      await expectControls(panel, `${name} 띄움`);
    }
    expect(await overflowOf(page)).toBeLessThanOrEqual(0);
    assertNoErrors();
  });
}
