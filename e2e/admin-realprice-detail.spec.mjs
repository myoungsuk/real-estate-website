// 실거래가 단지 상세 칸(2026-11-25)을 가짜 업무 API로 본다. 1221px 이상은 미리보기 칸 자리에 겹치고, 1220px 이하는 화면 전체 칸이다.
// 단지명·금액·시각은 모두 지어낸 값이다.
import { expect, test } from "@playwright/test";
import { PRODUCTION_CSP, cancelledTrade, collectErrors, envelope, failure, firstPage, overflowOf, rows, setup, trade } from "./support/realprice-mock.mjs";

const detail = (page) => page.locator("[data-rt-detail]");
// 미리보기가 담은 거래를 다시 읽는 요청(trades?ids=)에 답한다. 목록에 없는 거래도 같은 모양으로 돌려준다.
const listAndIds = (params) => {
  const ids = params.get("ids");
  if (!ids) return envelope({ items: params.get("cancelled") === "include" ? [cancelledTrade, ...firstPage] : firstPage, nextCursor: null, recordHighReady: true, coverage: {}, warnings: [] });
  const items = ids.split(",").map((id) => firstPage.find((item) => item.tradeKey === id) ?? trade(800, { tradeKey: id, areaM2: 59.92, priceWon: 268_000_000, dealDate: "2026-10-21" }));
  return envelope({ items, missing: [], receivedAt: "2026-11-19T03:10:00Z", recordHighReady: true, warnings: [] });
};
async function withListCsp(page) {
  const violations = [];
  await page.route(/\/admin\/work\/realprice\/$/u, async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), "content-security-policy": PRODUCTION_CSP } });
  });
  await page.exposeFunction("__cspViolation", (text) => violations.push(text));
  await page.addInitScript(() => document.addEventListener("securitypolicyviolation", (event) => window.__cspViolation(`${event.violatedDirective} ${event.blockedURI}`)));
  return violations;
}

test("단지 상세 1280px: 줄을 누르면 미리보기 칸 자리에 겹쳐 열고(모달 아님), 면적 탭을 바꾸면 그 면적만 한 번 읽고, Esc로 닫으면 포커스·미리보기가 그대로", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const violations = await withListCsp(page);
  const calls = await setup(page, { width: 1280, trades: listAndIds });
  await page.goto("/admin/work/realprice/");
  await expect(rows(page)).toHaveCount(30);
  expect(calls.complex, "열기 전에는 부르지 않음").toEqual([]);
  const preview = page.locator("[data-rt-preview]");
  await expect(preview).toBeVisible();

  // 담기 체크칸은 담기만 하고 칸을 열지 않음
  await rows(page).nth(4).getByRole("checkbox").check();
  await expect(detail(page)).toBeHidden();
  await expect(preview.locator("[data-rt-preview-count]")).toContainText("담은 거래 1건");

  // 줄의 빈 곳(계약일 칸)을 누르면 엶
  await rows(page).first().locator("td.rt-date").click();
  await expect(detail(page)).toBeVisible();
  expect(calls.complex).toEqual(["apt=A1&area=84.97"]);
  expect(await detail(page).evaluate((element) => element.matches(":modal")), "넓은 화면은 모달이 아님").toBe(false);
  const [panelBox, previewBox] = [await detail(page).boundingBox(), await preview.boundingBox()];
  expect(Math.abs(panelBox.x - previewBox.x) < 2 && Math.abs(panelBox.width - previewBox.width) < 2, "미리보기 칸 자리에 겹침").toBe(true);
  expect(await preview.evaluate((element) => element.inert), "겹친 동안 미리보기는 누를 수 없음").toBe(true);
  await expect(page.locator("#rt-detail-title")).toBeFocused();
  await expect(page.locator("#rt-detail-title")).toHaveText("가상숲1단지");
  await expect(page.locator("[data-rt-detail-sub]")).toHaveText("천동 · 2020년 준공 · 2,135세대");
  const tabs = detail(page).locator("[data-rt-detail-area]");
  await expect(tabs).toHaveText(["59.92㎡41건", "84.97㎡128건"]);
  await expect(tabs.nth(1)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-rt-detail-price]")).toHaveText("4억 100만 원");
  await expect(page.locator("[data-rt-detail-high]")).toBeVisible();
  await expect(page.locator("[data-rt-detail-meta]")).toHaveText("10층 · 2026. 11. 27. · 중개거래");
  await expect(page.locator("[data-rt-detail-stats] dt")).toHaveText(["최고가 대비", "최근 3개월 거래", "이 면적 최고", "84㎡대 최고", "최고 거래일"]);
  await expect(detail(page).locator(".rt-detail__spark path.rt-spark__line")).toHaveCount(1);
  await expect(detail(page).locator("[data-rt-detail-recent] > li")).toHaveCount(9);
  await expect(detail(page).locator("[data-rt-detail-recent] > li").first().locator(".rt-tag--current")).toHaveText("누른 거래");
  await expect(detail(page).locator("[data-rt-detail-recent] > li").nth(1).locator(".rt-tag--cancel")).toHaveText("해제");
  await expect(detail(page).locator("[data-rt-detail-recent] > li").nth(2).locator(".rt-tag--direct")).toHaveText("직거래");
  await expect(detail(page)).not.toContainText("평");
  expect(await detail(page).evaluate((element) => element.scrollWidth - element.clientWidth), "칸 안 가로 넘침 0").toBeLessThanOrEqual(0);

  // 면적 탭: 59.92㎡는 한 번 읽고, 다시 84.97㎡로 돌아오면 서버를 부르지 않음
  await tabs.nth(0).click();
  await expect(tabs.nth(0)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-rt-detail-price]")).toHaveText("2억 6,800만 원");
  await expect(page.locator("[data-rt-detail-stats] dt").nth(3)).toHaveText("59㎡대 최고");
  await tabs.nth(1).click();
  await expect(page.locator("[data-rt-detail-price]")).toHaveText("4억 100만 원");
  expect(calls.complex).toEqual(["apt=A1&area=84.97", "apt=A1&area=59.92"]);

  // 담기: 목록 체크칸과 같은 상태
  const pickButton = detail(page).locator("[data-rt-detail-pick]");
  await expect(pickButton).toHaveText("홍보물에 담기");
  await pickButton.click();
  await expect(pickButton).toHaveAttribute("aria-pressed", "true");
  await expect(pickButton).toHaveText("담음 · 빼기");
  await expect(rows(page).first().getByRole("checkbox")).toBeChecked();

  // Esc → 닫고 포커스는 그 줄의 단지 이름 단추, 미리보기는 담은 2건 그대로
  await page.keyboard.press("Escape");
  await expect(detail(page)).toBeHidden();
  await expect(rows(page).first().locator("button[data-rt-open]")).toBeFocused();
  expect(await preview.evaluate((element) => element.inert)).toBe(false);
  await expect(preview.locator("[data-rt-preview-count]")).toContainText("담은 거래 2건");
  // 같은 단지를 다시 열면 받은 자료를 다시 씀
  await page.keyboard.press("Enter");
  await expect(detail(page)).toBeVisible();
  expect(calls.complex.length).toBe(2);
  await detail(page).locator("[data-rt-detail-close]").first().click();
  await expect(detail(page)).toBeHidden();
  expect(await overflowOf(page)).toBeLessThanOrEqual(0);
  expect(violations).toEqual([]);
  assertNoErrors();
});

test("단지 상세 390px: 키보드로 열면 화면 전체 칸(아래 막대·아래 탭을 덮음), 누르는 곳 44px, 목록에 없는 면적의 최근 거래도 담기, '목록으로'로 닫으면 포커스가 돌아옴", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const calls = await setup(page, { width: 390, trades: listAndIds });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/work/realprice/");
  await expect(rows(page)).toHaveCount(30);
  await rows(page).nth(5).getByRole("checkbox").check();
  await expect(page.locator("[data-rt-pick-bar]")).toBeVisible();
  const opener = rows(page).nth(3).locator("button[data-rt-open]");
  await opener.focus();
  await page.keyboard.press("Enter");
  await expect(detail(page)).toBeVisible();
  expect(calls.complex).toEqual(["apt=A4&area=84.97"]);
  expect(await detail(page).evaluate((element) => element.matches(":modal")), "좁은 화면은 모달").toBe(true);
  const box = await detail(page).boundingBox();
  expect([box.x, box.y, box.width, box.height]).toEqual([0, 0, 390, 844]);
  expect(await page.evaluate(() => document.elementFromPoint(195, 830)?.closest("[data-rt-detail]") !== null), "맨 아래(막대·아래 탭 자리)도 칸").toBe(true);
  await expect(page.locator("[data-rt-detail-sub]"), "세대수가 없으면 뺌").toHaveText("천동 · 2020년 준공");
  const sizes = await page.evaluate(() => [...document.querySelectorAll("[data-rt-detail] .rt-detail__tab, [data-rt-detail] .rt-detail__x, [data-rt-detail] .rt-detail__act button")]
    .map((element) => { const rect = element.getBoundingClientRect(); return [element.textContent.trim(), rect.width, rect.height]; }));
  expect(sizes.filter(([, width, height]) => width < 44 || height < 44), "44px보다 작은 단추").toEqual([]);
  expect(await page.locator("[data-rt-detail-price]").evaluate((element) => parseFloat(getComputedStyle(element.closest(".rt-detail__body")).fontSize))).toBeGreaterThanOrEqual(16);
  expect(await detail(page).evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(0);

  await detail(page).locator("[data-rt-detail-area]").nth(0).click();
  await expect(page.locator("[data-rt-detail-price]")).toHaveText("2억 6,800만 원");
  await detail(page).locator("[data-rt-detail-pick]").click();
  await expect(detail(page).locator("[data-rt-detail-pick]")).toHaveAttribute("aria-pressed", "true");
  await detail(page).getByRole("button", { name: "목록으로" }).click();
  await expect(detail(page)).toBeHidden();
  await expect(opener).toBeFocused();
  await expect(page.locator("[data-rt-pick-text]")).toHaveText("담은 거래 2건");
  assertNoErrors();
});

test("단지 상세 360px: 열어도 가로 넘침 0, 탭이 많으면 탭 줄 안에서만 넘김", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  await setup(page, {
    width: 360,
    complex: (params) => {
      const areas = [39.5, 49.88, 59.92, 74.6, 84.97, 84.98, 101.2, 114.3].map((areaM2) => ({ areaM2, tradeCount: 12, lastDealDate: "2026-10-01" }));
      return envelope({
        available: true,
        complex: { aptSeq: params.get("apt"), aptName: "아주긴이름의가상숲리버뷰센트럴파크1단지", umdName: "천동", buildYear: 2020, households: 1234 },
        areas,
        area: { areaM2: 84.97, tradeCount: 12, latest: { tradeKey: firstPage[0].tradeKey, dealDate: "2026-11-27", floor: 10, priceWon: 1_234_560_000, dealingGbn: "broker", recordHigh: false },
          prev: null, prevMaxWon: null, ratioPct: null, ratioSkip: null, recent3m: 0, typeMaxWon: 1_234_560_000, typeMaxDate: "2026-11-27", bandM2: 84, bandMaxWon: 1_300_000_000, bandTypes: 2,
          series: [{ ym: "2026-11", medianWon: 1_234_560_000, count: 1 }], recent: [] },
        basis: { months: 36, recentMonths: 3, recentMax: 20 }, recordHighReady: true, warnings: [],
      });
    },
  });
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto("/admin/work/realprice/");
  await expect(rows(page)).toHaveCount(30);
  await rows(page).first().locator("button[data-rt-open]").click();
  await expect(detail(page)).toBeVisible();
  await expect(detail(page).locator("[data-rt-detail-area]")).toHaveCount(8);
  await expect(page.locator("[data-rt-detail-chart]"), "거래 있는 달이 하나면 그림 없음").toBeHidden();
  await expect(page.locator("[data-rt-detail-flow-note]")).toHaveText("흐름은 거래가 있는 달이 두 달 이상일 때 그립니다");
  await expect(page.locator("[data-rt-detail-prev]")).toHaveText("직전 거래 없음(2006년 1월 이후)");
  expect(await detail(page).evaluate((element) => element.scrollWidth - element.clientWidth), "칸 가로 넘침 0").toBeLessThanOrEqual(0);
  expect(await page.locator("[data-rt-detail-tabs]").evaluate((element) => element.scrollWidth > element.clientWidth), "탭 줄 안에서만 넘김").toBe(true);
  expect(await overflowOf(page)).toBeLessThanOrEqual(0);
  assertNoErrors();
});

test("단지 상세: 조회 한도·채우는 중은 까닭 글, 오류는 다시 누르라는 글, 단지 번호가 없는 거래는 이름 단추가 없고 눌러도 열지 않음", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const answers = [
    envelope({ available: false, reason: "budget", basis: {}, recordHighReady: true, warnings: [{ code: "RT_READ_BUDGET", level: "soft" }] }),
    envelope({ available: false, reason: "pending", basis: {}, recordHighReady: false, warnings: [] }),
    failure(500, "INTERNAL_ERROR"),
  ];
  const noComplex = trade(1, { aptSeq: null });
  await setup(page, {
    width: 1280,
    complex: (_, count) => answers[count - 1],
    trades: () => envelope({ items: [noComplex, ...firstPage.slice(1)], nextCursor: null, recordHighReady: true, coverage: {}, warnings: [] }),
  });
  await page.goto("/admin/work/realprice/");
  await expect(rows(page)).toHaveCount(30);
  await expect(rows(page).first().locator("button[data-rt-open]")).toHaveCount(0);
  await rows(page).first().locator("td.rt-date").click();
  await expect(detail(page)).toBeHidden();
  const message = page.locator("[data-rt-detail-msg]");
  for (const [index, text] of [[1, "오늘 조회가 많아"], [2, "과거 자료를 채우는 중"], [4, "불러오지 못했습니다"]]) {
    await rows(page).nth(index).locator("button[data-rt-open]").click();
    await expect(message).toContainText(text);
    await expect(detail(page).locator("[data-rt-detail-pick]")).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(detail(page)).toBeHidden();
  }
  assertNoErrors();
});
