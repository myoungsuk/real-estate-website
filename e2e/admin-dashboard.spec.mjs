// 관리자 대시보드(/admin/, 2026-11-23 A안)를 가짜 업무 API로 본다. 실제 서버·D1은 부르지 않는다.
// 손님 이름·할 일 제목·거래 이름은 모두 지어낸 값(가상숲1단지 등)이다.
import { expect, test } from "@playwright/test";

const NOW = new Date("2026-11-17T05:00:00Z"); // 한국 화요일 14:00
const TODAY = "2026-11-17";
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const envelope = (data, status = 200) => ({ status, json: { ok: true, data, requestId: "test" } });
const failure = (status, code) => ({ status, json: { ok: false, error: { code, message: "시험 오류", retryable: false, details: [] }, requestId: "test" } });
const NAMES = ["가상손님매수", "가상 등기부 다시 떼기", "가상숲1단지 84㎡ 매매"];

function makeDashboard(patch = {}) {
  return {
    today: TODAY,
    tasks: { ok: true, overdue: 1, dueToday: 1, items: [
      { id: uuid(1), title: "가상 등기부 다시 떼기", dueOn: "2026-11-15", repeat: "none", deal: { id: uuid(11), title: "가상숲1단지 84㎡ 매매" } },
      { id: uuid(2), title: "가상 주간 광고 갱신", dueOn: TODAY, repeat: "weekly", deal: null },
    ] },
    events: { ok: true, until: "2026-12-01", total: 3, overdue: 1, items: [
      { id: uuid(21), kind: "middle_payment", kindLabel: "중도금", title: "중도금", dueOn: "2026-11-14", deal: { id: uuid(11), title: "가상숲1단지 84㎡ 매매", dealType: "sale" }, customer: { id: uuid(31), displayName: "가상손님매수" }, partyCount: 2 },
      { id: uuid(22), kind: "balance", kindLabel: "잔금", title: "잔금", dueOn: "2026-11-20", deal: { id: uuid(11), title: "가상숲1단지 84㎡ 매매", dealType: "sale" }, customer: { id: uuid(31), displayName: "가상손님매수" }, partyCount: 2 },
      { id: uuid(23), kind: "balance", kindLabel: "잔금", title: "잔금", dueOn: "2026-11-28", deal: { id: uuid(12), title: "가상강변 전세", dealType: "jeonse" }, customer: null, partyCount: 0 },
    ] },
    money: { ok: true, month: "2026-11", basis: "balance", receivableWon: 3_960_000, receivedWon: 1_000_000, unpaidWon: 2_960_000, unpaidCount: 2, undatedCount: 1, items: [
      { id: uuid(41), kind: "fee", label: "가상숲1단지 84㎡ 매매", payerRole: "buyer", basisOn: "2026-11-20", unpaidWon: 1_980_000 },
      { id: uuid(42), kind: "fee", label: "매도 보수", payerRole: "seller", basisOn: "2026-11-20", unpaidWon: 980_000 },
    ] },
    realprice: { ok: true, newCount: 4, watchNewCount: 1, newHighCount: 1, partial: false, items: [
      { tradeKey: "sale:202611:00000000000000000001:1", dealDate: "2026-11-10", aptName: "가상리더스시티5블록", areaM2: 84.97, priceWon: 420_000_000 },
    ] },
    ...patch,
  };
}

async function setup(page, { width = 1280, height = 900, dashboard = makeDashboard(), responses = null, prerendering = false } = {}) {
  await page.clock.install({ time: NOW });
  await page.setViewportSize({ width, height });
  const calls = [];
  const errors = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.route("**/api/admin/**", (route) => route.fulfill(failure(503, "TEST_OFFLINE")));
  await page.route("**/api/admin/v1/work/dashboard**", (route) => {
    calls.push(`${route.request().method()} ${new URL(route.request().url()).search}`);
    const next = responses ? responses.shift() ?? responses.at(-1) : null;
    return route.fulfill(next ?? envelope(dashboard));
  });
  if (prerendering) {
    await page.addInitScript(() => {
      let on = true;
      Object.defineProperty(document, "prerendering", { configurable: true, get: () => on });
      window.__endPrerender = () => {
        on = false;
        document.dispatchEvent(new Event("prerenderingchange"));
      };
    });
  }
  await page.goto("/admin/");
  return { calls, errors };
}
const panel = (page, key) => page.locator(`[data-dsh-section="${key}"]`);
const overflowOf = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const storageOf = (page) => page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) }));

test("대시보드 1280px: 숫자 띠 4칸, '14일 안 계약 일정'은 total − overdue, 칸 넷이 그려지고 이름은 주소·저장소에 없다", async ({ page }) => {
  const dashboard = makeDashboard();
  const { calls, errors } = await setup(page, { dashboard });
  const strip = page.locator("[data-dsh-strip]");
  await expect(strip).toBeVisible();
  await expect(strip.locator(".dsh-kpi")).toHaveCount(4);
  const kpi = (index) => strip.locator(".dsh-kpi").nth(index);
  await expect(kpi(0).locator(".dsh-kpi__value")).toHaveText(/^2건$/u);
  await expect(kpi(1).locator(".dsh-kpi__label")).toHaveText("14일 안 계약 일정");
  await expect(kpi(1).locator(".dsh-kpi__value")).toHaveText(`${dashboard.events.total - dashboard.events.overdue}건`);
  await expect(kpi(1).locator(".dsh-kpi__sub")).toContainText("! 지난 일정 1건");
  await expect(kpi(2).locator(".dsh-kpi__value")).toHaveText("2,960,000원");
  await expect(page.locator("[data-dsh-boot]")).toBeHidden();

  await expect(panel(page, "tasks").locator(".dsh-row")).toHaveCount(2);
  await expect(panel(page, "tasks").locator(".dsh-when.is-late")).toHaveCount(1);
  await expect(panel(page, "events").locator(".dsh-row")).toHaveCount(3);
  await expect(panel(page, "events").locator("[data-dsh-count]")).toContainText("지난 일정 1건");
  const eventHrefs = await panel(page, "events").locator("a.dsh-row").evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  expect(eventHrefs).toEqual([`/admin/work/customers/detail/?id=${uuid(31)}`, `/admin/work/customers/detail/?id=${uuid(31)}`, "/admin/work/customers/"]);
  await expect(panel(page, "events")).toContainText("가상손님매수");
  await expect(panel(page, "money").locator(".dsh-money .is-due")).toHaveCount(1);
  await expect(panel(page, "money").locator(".dsh-row")).toHaveCount(2);
  await expect(panel(page, "money").locator(".dsh-note")).toHaveCount(1);
  await expect(panel(page, "realprice").locator(".dsh-chip--high")).toHaveCount(1);
  await expect(panel(page, "realprice").locator(".dsh-listing")).toHaveAttribute("href", "/admin/listings/");

  expect(calls).toEqual(["GET "]);
  expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe("/admin/");
  expect(await storageOf(page)).toEqual({ local: [], session: [] });
  const hrefs = await page.locator("a[href]").evaluateAll((links) => links.map((link) => link.getAttribute("href")).join("\n"));
  for (const name of NAMES) expect(hrefs.includes(name), name).toBe(false);
  expect(await page.title()).not.toContain("가상");
  expect(await overflowOf(page)).toBe(0);
  expect(errors.filter((text) => !/503|Failed to load resource/u.test(text))).toEqual([]);
});

test("대시보드: 979px 이하에서는 숫자 띠를 숨기고 칸 넷은 보이며, 360px 가로 넘침 0", async ({ page }) => {
  await setup(page, { width: 980 });
  await expect(page.locator("[data-dsh-strip]")).toBeVisible();
  for (const width of [979, 768, 390, 360]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator("[data-dsh-strip]"), String(width)).toBeHidden();
    expect(await page.locator("[data-dsh-strip]").evaluate((node) => getComputedStyle(node).display), String(width)).toBe("none");
    for (const key of ["tasks", "events", "money", "realprice"]) await expect(panel(page, key), `${width} ${key}`).toBeVisible();
    expect(await overflowOf(page), String(width)).toBe(0);
  }
});

test("대시보드: 1221px 이상 + 마우스에서만 날짜·곁말 14px·줄 36px, 1220px는 16px·44px", async ({ page }) => {
  await setup(page, { width: 1280 });
  const measure = () => page.evaluate(() => {
    const px = (selector, prop) => parseFloat(getComputedStyle(document.querySelector(selector))[prop]);
    return { when: px(".dsh-when", "fontSize"), meta: px(".dsh-row .dsh-meta", "fontSize"), what: px(".dsh-what", "fontSize"), row: px(".dsh-row", "minHeight"), more: px(".dsh-more", "minHeight") };
  });
  expect(await measure()).toEqual({ when: 14, meta: 14, what: 16, row: 36, more: 36 });
  await page.setViewportSize({ width: 1220, height: 900 });
  expect(await measure()).toEqual({ when: 16, meta: 16, what: 16, row: 44, more: 44 });
});

test("대시보드: 한 칸 실패는 그 칸에만 '다시 불러오기'(누르면 한 번 더 GET), 꺼진 칸은 '꺼짐' 글자와 다시 불러오기 없음", async ({ page }) => {
  const broken = makeDashboard({ events: { ok: false, code: "STORAGE_UNAVAILABLE" }, realprice: { ok: false, code: "REALPRICE_DISABLED" } });
  const { calls } = await setup(page, { responses: [envelope(broken), envelope(makeDashboard())] });
  await expect(panel(page, "events").locator(".dsh-state.is-fail")).toContainText("!");
  await expect(panel(page, "realprice").locator(".dsh-state.is-off")).toContainText("꺼짐");
  await expect(panel(page, "realprice").getByRole("button", { name: "다시 불러오기" })).toHaveCount(0);
  await expect(panel(page, "realprice").locator(".dsh-listing")).toBeVisible();
  await expect(panel(page, "tasks").locator(".dsh-row")).toHaveCount(2);
  await expect(page.locator(".dsh-kpi").nth(1).locator(".dsh-kpi__value")).toHaveText("—");
  await panel(page, "events").getByRole("button", { name: "다시 불러오기" }).click();
  await expect(panel(page, "events").locator(".dsh-row")).toHaveCount(3);
  expect(calls).toEqual(["GET ", "GET "]);
});

test("대시보드: 응답 자체를 받지 못하면 칸 넷 모두 실패 안내, 1280px에서도 숫자 띠를 숨긴다", async ({ page }) => {
  await setup(page, { responses: [failure(503, "STORAGE_UNAVAILABLE")] });
  for (const key of ["tasks", "events", "money", "realprice"]) await expect(panel(page, key).locator(".dsh-state"), key).toBeVisible();
  await expect(page.locator("[data-dsh-strip]")).toBeHidden();
  await expect(page.locator("[data-dsh-boot]")).toBeHidden();
});

test("대시보드: 한 번 그린 뒤 다시 부를 때 응답을 받지 못하면 옛 숫자 띠를 숨기고 칸 넷을 실패 안내로 바꾼다", async ({ page }) => {
  const { calls } = await setup(page, { responses: [envelope(makeDashboard()), failure(503, "STORAGE_UNAVAILABLE")] });
  await expect(page.locator("[data-dsh-strip]")).toBeVisible();
  await expect(panel(page, "tasks").locator(".dsh-row")).toHaveCount(2);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  await expect.poll(() => calls.length).toBe(2);
  await expect(page.locator("[data-dsh-strip]")).toBeHidden();
  for (const key of ["tasks", "events", "money", "realprice"]) await expect(panel(page, key).locator(".dsh-state"), key).toBeVisible();
  await expect(panel(page, "tasks").locator(".dsh-row")).toHaveCount(0);
});

test("대시보드: 미리 그리는 동안에는 요청 0번, 화면이 보이면 한 번, 뒤로 가기 캐시에서 돌아오면 한 번 더", async ({ page }) => {
  const { calls } = await setup(page, { prerendering: true });
  await expect(page.locator("h1")).toHaveText("대시보드");
  await page.waitForTimeout(300);
  expect(calls).toEqual([]);
  await page.evaluate(() => window.__endPrerender());
  await expect(panel(page, "tasks").locator(".dsh-row")).toHaveCount(2);
  expect(calls).toEqual(["GET "]);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  await expect.poll(() => calls.length).toBe(2);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: false })));
  await page.waitForTimeout(200);
  expect(calls.length).toBe(2);
});
