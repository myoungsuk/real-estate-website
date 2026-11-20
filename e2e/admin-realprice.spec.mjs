// 실거래가·실거래가 설정 화면(P1-d, TK-36·TK-37)과 홍보물 화면(P1-e, TK-38 ~ TK-40)을 가짜 업무 API로 본다. 단지명·금액·시각은 모두 지어낸 값이다.
// P1-f D안(운영자 결정 2026-11-20 13:36:35): 휴대폰·PC 같은 순서(상태 한 줄 → 보기 3칸 → 찾기칸 → 거르기 단추 6개 → 'n건 보는 중' 줄 → 목록), 1220px 이하 카드·1221px 이상 표.
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const NOW = new Date("2026-11-19T05:00:00Z"); // 한국 14:00
const WORK = "**/api/admin/v1/work";
const okStatus = {
  lastSuccessAt: "2026-11-19T03:10:00Z",
  coveredThrough: "2026-11",
  backfill: { sale: { done: 251, total: 251 }, presale: { done: 234, total: 234 }, rent: { done: 191, total: 191 } },
  recordHighReady: true,
  lastError: null,
  warnings: [],
  today: { apiCalls: 142, rowsWritten: 1284, writeBudget: 40000, rowsRead: 380000, readSoftLimit: 1500000, readHardLimit: 2500000 },
  unmatchedSaleRows: 12,
  runs: [
    { seq: 2, startedAt: "2026-11-19T03:10:00Z", finishedAt: "2026-11-19T03:10:02Z", monthsDone: 1, apiCalls: 2, inserted: 184, updated: 0, deleted: 0, rowsWritten: 552, outcome: "ok", errorCode: null },
    { seq: 1, startedAt: "2026-11-19T03:00:00Z", finishedAt: "2026-11-19T03:00:01Z", monthsDone: 0, apiCalls: 1, inserted: 0, updated: 0, deleted: 0, rowsWritten: 0, outcome: "failed", errorCode: "RT_UPSTREAM_FAILED" },
  ],
};

function trade(index, extra = {}) {
  return {
    tradeKey: `sale:202611:${String(index).padStart(20, "0")}:1`,
    kind: "sale",
    dealDate: `2026-11-${String(28 - (index % 27)).padStart(2, "0")}`,
    umdName: "천동",
    jibun: "1",
    aptSeq: `A${index}`,
    aptName: `가상숲${index}단지`,
    areaM2: 84.97,
    floor: 10,
    buildYear: 2020,
    priceWon: 400_000_000 + index * 1_000_000,
    depositWon: null,
    monthlyRentWon: null,
    dealingGbn: "broker",
    cancelled: false,
    cancelledOn: null,
    registeredOn: null,
    aptDong: null,
    extra: {},
    recordHigh: false,
    prevMaxWon: null,
    isNew: false,
    ...extra,
  };
}
const firstPage = [
  trade(1, { recordHigh: true, prevMaxWon: 395_000_000, isNew: true, aptDong: "103" }),
  trade(2, { kind: "rent", priceWon: null, depositWon: 20_000_000, monthlyRentWon: 850_000, umdName: "신흥동" }),
  trade(3, { dealingGbn: "direct", floor: -1 }),
  ...Array.from({ length: 27 }, (_, index) => trade(index + 4)),
];
const secondPage = Array.from({ length: 5 }, (_, index) => trade(index + 31));
const cancelledTrade = trade(99, { cancelled: true, cancelledOn: "2026-11-15" });

const envelope = (data) => ({ json: { ok: true, data, requestId: "test" } });
// 거래 흐름(보드 63번) 가짜 응답: 첫 거래는 앞선 최고 3억 9,500만(신고가 101.5%), 넷째 거래(가상숲4단지)는 첫 거래·한 달만, 나머지는 평범한 흐름.
function insightOf(id) {
  const item = [...firstPage, ...secondPage].find((trade) => trade.tradeKey === id);
  if (!item || item.kind !== "sale" || item.dealingGbn === "direct") return { tradeKey: id, available: false, reason: item ? "not_sale" : "error" };
  const months = ["2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"];
  if (item === firstPage[3]) {
    return { tradeKey: id, available: true, series: months.map((ym, index) => ({ ym, medianWon: index === 11 ? item.priceWon : null, count: index === 11 ? 1 : 0 })), prev: null, prevMaxWon: null, ratioPct: null, recent3m: 1, households: null };
  }
  const series = months.map((ym, index) => ({ ym, medianWon: index % 3 === 1 ? null : 380_000_000 + index * 1_000_000, count: index % 3 === 1 ? 0 : 1 }));
  const prevMaxWon = item === firstPage[0] ? 395_000_000 : item.priceWon + 5_000_000;
  return { tradeKey: id, available: true, series, prev: { dealDate: "2026-10-02", floor: 9, priceWon: 390_000_000 }, prevMaxWon, ratioPct: Math.round((item.priceWon * 1000) / prevMaxWon) / 10, recent3m: 3, households: null };
}
const defaultInsights = (ids) => envelope({ items: ids.map(insightOf), missing: [], basis: { months: 12, recentMonths: 3 }, recordHighReady: true, warnings: [] });
const failure = (status, code, extra = {}) => ({ status, json: { ok: false, error: { code, message: "시험 오류", retryable: false, ...extra }, requestId: "test" } });

// 늘 같은 시각에서 보이게 시계를 고정하고, 실제 서버는 부르지 않는다(맞지 않는 관리 API는 503).
async function setup(page, { width = 390, session = { realpriceEnabled: true }, status = okStatus, trades, watch, complexes, put, refresh, insights } = {}) {
  await page.clock.setFixedTime(NOW);
  await page.setViewportSize({ width, height: 900 });
  const calls = { trades: [], complexes: [], puts: [], refresh: [], session: 0, watchGets: 0, insights: [] };
  await page.route("**/api/admin/**", (route) => route.fulfill(failure(503, "TEST_OFFLINE")));
  await page.route(`${WORK}/public-tools/session`, (route) => {
    calls.session += 1;
    if (typeof session === "function") return route.fulfill(session(calls.session));
    return route.fulfill(envelope({ blogEnabled: false, administrator: "시험 관리자", csrfToken: session.realpriceEnabled ? `test-csrf-${calls.session}` : null, schemaVersion: 3, ...session }));
  });
  await page.route(`${WORK}/realprice/status`, (route) => route.fulfill(typeof status === "function" ? status() : envelope(status)));
  await page.route(`${WORK}/realprice/trades**`, (route) => {
    const params = new URL(route.request().url()).searchParams;
    calls.trades.push(params.toString());
    if (trades) return route.fulfill(trades(params, calls.trades.length));
    const items = params.get("cursor") === "c2" ? secondPage : params.get("cancelled") === "include" ? [cancelledTrade, ...firstPage] : firstPage;
    return route.fulfill(envelope({ items, nextCursor: params.get("cursor") ? null : "c2", recordHighReady: true, coverage: {}, warnings: [] }));
  });
  await page.route(`${WORK}/realprice/insights**`, (route) => {
    const value = new URL(route.request().url()).searchParams.get("ids") ?? "";
    calls.insights.push(value);
    return route.fulfill((insights ?? defaultInsights)(value.split(",")));
  });
  let watchState = watch ?? { version: 3, items: [{ aptSeq: "A1", displayName: "가상숲1단지", complexSlug: "leaders-city-4" }, { aptSeq: "A2", displayName: "가상숲2단지", complexSlug: "retired-slug" }] };
  await page.route(`${WORK}/realprice/watch`, (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      calls.watchGets += 1;
      return route.fulfill(envelope(typeof watchState === "function" ? watchState(calls.watchGets) : watchState));
    }
    const body = request.postDataJSON();
    calls.puts.push({ body, headers: request.headers() });
    const answer = put ? put(body, calls.puts.length) : null;
    if (answer) return route.fulfill(answer);
    watchState = { version: body.version + 1, items: body.items };
    return route.fulfill(envelope(watchState));
  });
  await page.route(`${WORK}/realprice/complexes**`, (route) => {
    const q = new URL(route.request().url()).searchParams.get("q");
    calls.complexes.push(q);
    return route.fulfill(envelope({ items: complexes ? complexes(q) : [] }));
  });
  await page.route(`${WORK}/realprice/refresh`, (route) => {
    calls.refresh.push({ body: route.request().postDataJSON(), headers: route.request().headers() });
    return route.fulfill(refresh ?? envelope({ queuedMonths: 12, estimatedMinutes: 120 }));
  });
  return calls;
}

// 콘솔 오류 0건. 가짜 API가 일부러 돌려준 오류 응답(429·503)의 "Failed to load resource" 한 줄은 화면 오류가 아니므로 뺀다.
function collectErrors(page) {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !/Failed to load resource/u.test(message.text())) errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return () => expect(errors, "브라우저 콘솔 오류가 없어야 합니다").toEqual([]);
}
const overflowOf = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const rows = (page) => page.locator("[data-rt-rows] > tr");

// 누르는 곳 44px: 거르기 단추 6개·찾기·다 담기·첫 줄 담기(찾기칸은 48px).
const tapSizes = (page) => page.evaluate(() => [...document.querySelectorAll(".rt-chip, .rt-find__go, .rt-take, [data-rt-rows] > tr:first-child .rt-pick-button")]
  .filter((element) => element.getClientRects().length > 0)
  .map((element) => { const box = element.getBoundingClientRect(); return { name: (element.querySelector("[data-rt-chip-text]") ?? element).textContent.trim(), width: box.width, height: box.height }; }));

test("실거래가 D안 390px: 상태 한 줄은 접힘, 찾기칸·거르기 단추 6개(44px)·'n건 보는 중' 줄, 첫 거래는 시안 위치 안, 세 줄 카드, 30건 더 보기, 키보드로 거르기·보기 바꾸기", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const calls = await setup(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/work/realprice/");
  await expect(rows(page)).toHaveCount(30);
  expect(calls.trades, "기본 거르기는 매개변수 없이(서버 기본 3개월·해제 빼기)").toEqual([""]);

  const sum = page.locator("[data-rt-sum]");
  await expect(sum).not.toHaveAttribute("open", /.*/u);
  await expect(page.locator(".rt-sum__line")).toHaveText("11. 19. 12:10 받음 · 11월분까지");
  await expect(page.locator(".rt-sum__basis")).toBeVisible();
  await expect(page.locator("[data-rt-more-filters]"), "거래 종류·법정동은 '더 보기' 안").toBeHidden();
  await expect(page.locator("#rt-list-title")).toHaveText("새 거래 30건 보는 중", { useInnerText: true });
  await expect(page.locator("[data-rt-on-text]")).toHaveText("거르기 없음 · 해제 거래 뺌");
  await expect(page.locator("[data-rt-clear-all]")).toBeHidden();
  await expect(page.locator("[data-rt-take]")).toHaveText("위에서 6건 담기");
  const sizes = await tapSizes(page);
  expect(sizes.map((size) => size.name), "단추 9개").toEqual(["찾기", "최근 3개월", "평형", "금액", "신고가만", "분양권만", "더 보기", "위에서 6건 담기", "담기"]);
  expect(sizes.filter((size) => size.width < 44 || size.height < 44), "44px보다 작은 단추").toEqual([]);
  const firstBox = await rows(page).first().boundingBox();
  expect(firstBox.y, "첫 거래는 시안 D-390 위치(631px)보다 내려가지 않음").toBeLessThanOrEqual(631);

  const first = rows(page).first();
  expect(await first.evaluate((row) => getComputedStyle(row).display), "1220px 이하는 카드").toBe("block");
  await expect(first.locator(".rt-tag--high")).toHaveText("신고가");
  await expect(first.locator(".rt-new .rt-tag")).toBeVisible();
  await expect(first.locator(".rt-flags .rt-only-table")).toBeHidden();
  await expect(first.locator(".rt-size")).toHaveText("84.97㎡ · 10층 · 103동");
  await expect(first.locator(".rt-price")).toContainText("4억 100만 원");
  await expect(first.locator(".rt-prev"), "앞선 최고는 카드에서 숨김").toBeHidden();
  await expect(rows(page).nth(1).locator(".rt-price")).toHaveText("보증금 2,000만 / 월 85만 원", { useInnerText: true });
  await expect(rows(page).nth(1).locator(".rt-kind")).toHaveText("월세");
  await expect(rows(page).nth(2).locator(".rt-kind")).toHaveText("매매직거래");
  await expect(rows(page).nth(2).locator(".rt-size")).toContainText("지하 1층");
  await expect(page.locator("[data-rt-criterion]")).toBeVisible();

  await page.getByRole("button", { name: "30건 더 보기" }).click();
  await expect(rows(page)).toHaveCount(35);
  expect(calls.trades.at(-1)).toBe("cursor=c2");
  await expect(page.locator("[data-rt-more]")).toBeHidden();
  await expect(page.locator("#rt-list-title")).toHaveText("새 거래 35건 보는 중", { useInnerText: true });

  // 키보드: '더 보기' 펼치기(Enter) → 해제 빼기 끄기(Space) → 해제 거래가 '해제' 글자와 함께 보이고 켜짐 줄에 나옴
  const moreToggle = page.locator("[data-rt-more-toggle]");
  await moreToggle.focus();
  await page.keyboard.press("Enter");
  await expect(moreToggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("[data-rt-more-filters]")).toBeVisible();
  await page.locator('[data-rt-filter="excludeCancelled"]').focus();
  await page.keyboard.press("Space");
  await expect(rows(page)).toHaveCount(31);
  expect(calls.trades.at(-1)).toBe("cancelled=include");
  await expect(rows(page).first().locator(".rt-tag--cancel")).toHaveText("해제");
  await expect(rows(page).first()).toHaveClass(/is-cancelled/u);
  await expect(page.locator("[data-rt-on-text]")).toHaveText("켜짐: 해제 포함");
  await expect(moreToggle, "'더 보기' 안 칸이 켜지면 단추도 켜짐").toHaveClass(/is-set/u);
  await page.locator("#rt-kind").selectOption("sale");
  await expect.poll(() => calls.trades.at(-1)).toBe("kind=sale&cancelled=include");
  await page.getByRole("button", { name: "모두 끄기" }).click();
  await expect.poll(() => calls.trades.at(-1)).toBe("");
  await expect(page.locator("[data-rt-reset]")).toBeDisabled();
  await expect(page.locator("[data-rt-clear-all]")).toBeHidden();

  // 거르기 단추: 평형(기본 고르기 목록) → 단추 글자·켜짐, 신고가만(눌러 켬) → 한 번에 100건 받아 화면에서 거름
  await page.locator("#rt-area").selectOption("middle");
  await expect.poll(() => calls.trades.at(-1)).toBe("areaMin=60.01&areaMax=85");
  await expect(page.locator('[data-rt-chip="area"]')).toHaveClass(/is-set/u);
  await expect(page.locator('[data-rt-chip-text="area"]')).toHaveText("60 ~ 85㎡");
  const highOnly = page.getByRole("button", { name: "신고가만" });
  await highOnly.click();
  await expect(highOnly).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => calls.trades.at(-1)).toBe("areaMin=60.01&areaMax=85&limit=100");
  await expect(rows(page)).toHaveCount(1);
  await expect(page.locator("#rt-list-title")).toHaveText("새 거래 1건 보는 중", { useInnerText: true });
  await expect(page.locator("[data-rt-on-text]")).toHaveText("켜짐: 60 ~ 85㎡ · 신고가만 · 불러온 30건 가운데");
  await expect(page.locator("[data-rt-take]")).toHaveText("보이는 1건 담기");
  await page.getByRole("button", { name: "모두 끄기" }).click();
  await expect.poll(() => calls.trades.at(-1)).toBe("");

  // 보기 바꾸기: 라디오 오른쪽 화살표 → 주요 거래(기간·분양권만 잠김) → 관심 단지
  await page.getByRole("radio", { name: "새 거래" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio", { name: "주요 거래" })).toBeChecked();
  await expect.poll(() => calls.trades.at(-1)).toBe("view=major");
  await expect(page.locator('[data-rt-chip-text="period"]')).toHaveText("최근 30일");
  await expect(page.locator("#rt-period")).toBeDisabled();
  await expect(page.getByRole("button", { name: "분양권만" })).toBeDisabled();
  await expect(page.locator("[data-rt-on-text]")).toHaveText("최근 30일 매매 신고가 + 금액 상위 10건");
  await expect(page.locator("#rt-list-title")).toHaveText("주요 거래 30건 보는 중", { useInnerText: true });
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio", { name: "관심 단지" })).toBeChecked();
  await expect(page.locator("[data-rt-watch-names]")).toHaveText("관심 단지 2곳: 가상숲1단지 · 가상숲2단지");
  await expect.poll(() => calls.trades.at(-1)).toBe("watch=1");
  await expect(page.locator("#rt-period")).toBeEnabled();
  await expect(page.locator("#rt-list-title")).toHaveText("관심 단지 거래 30건 보는 중", { useInnerText: true });

  // 작은 탭: 다섯째(마지막) '실거래가'가 지금 화면이고, 줄 안에서 잘리지 않고 오른쪽에 간격(의도 16px)을 두고 옮겨져 있음
  const tab = page.locator('.admin-subtabs a[href="/admin/work/realprice/"]');
  await expect(tab).toHaveAttribute("aria-current", "page");
  const fit = await tab.evaluate((link) => {
    const strip = link.closest(".admin-subtabs").getBoundingClientRect();
    const box = link.getBoundingClientRect();
    return { left: box.left >= strip.left, right: box.right <= strip.right, gap: strip.right - box.right };
  });
  expect({ left: fit.left, right: fit.right }).toEqual({ left: true, right: true });
  expect(fit.gap, "마지막 탭 오른쪽 간격(글꼴 소수점 폭 여유 4px)").toBeGreaterThanOrEqual(12);
  expect(await overflowOf(page)).toBeLessThanOrEqual(0);
  assertNoErrors();
});

test("실거래가 D안 찾기: '찾기'·Enter로만 부르고(한글 조합 중 Enter 빼고) 칸을 비우면 다시 전체, 0건이면 까닭과 바로 할 일 단추", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const calls = await setup(page, {
    width: 360,
    trades: (params) => envelope({ items: params.get("q") === "없는단지" ? [] : firstPage, nextCursor: null, recordHighReady: true, coverage: {}, warnings: [] }),
  });
  await page.goto("/admin/work/realprice/");
  await expect(rows(page)).toHaveCount(30);
  const q = page.locator("#rt-q");
  await expect(q).toHaveAttribute("maxlength", "30");
  await q.fill(" 가상 숲 ");
  expect(calls.trades, "입력만으로는 부르지 않음").toEqual([""]);
  await page.getByRole("button", { name: "찾기", exact: true }).click();
  await expect.poll(() => calls.trades.at(-1)).toBe(new URLSearchParams({ q: "가상 숲" }).toString());
  await expect(page.locator("[data-rt-on-text]")).toHaveText("켜짐: '가상 숲'");
  await page.getByRole("button", { name: "찾기", exact: true }).click();
  expect(calls.trades.length, "같은 말로 다시 찾으면 부르지 않음").toBe(2);

  await q.fill("없는단지");
  await q.dispatchEvent("keydown", { key: "Enter", isComposing: true });
  expect(calls.trades.length, "한글 조합 중 Enter는 무시").toBe(2);
  await q.press("Enter");
  await expect.poll(() => calls.trades.at(-1)).toBe(new URLSearchParams({ q: "없는단지" }).toString());
  await expect(page.locator("[data-rt-zero] h3")).toHaveText("'없는단지' 거래가 최근 3개월에는 없습니다");
  await expect(page.locator("[data-rt-zero-action]")).toHaveText(["최근 3년에서 다시 찾기", "찾는 말 지우기"]);
  await expect(page.locator("[data-rt-take]")).toBeHidden();
  await page.getByRole("button", { name: "최근 3년에서 다시 찾기" }).click();
  await expect.poll(() => calls.trades.at(-1)).toBe(new URLSearchParams({ from: "2023-12", q: "없는단지" }).toString());
  await expect(page.locator("[data-rt-zero-action]")).toHaveText(["찾는 말 지우기"]);
  await page.getByRole("button", { name: "찾는 말 지우기" }).click();
  await expect.poll(() => calls.trades.at(-1)).toBe("from=2023-12");
  await expect(q).toHaveValue("");
  await expect(q).toBeFocused();
  await q.fill("가상");
  await q.press("Enter");
  await expect.poll(() => calls.trades.at(-1)).toBe(new URLSearchParams({ from: "2023-12", q: "가상" }).toString());
  await q.fill("");
  await expect.poll(() => calls.trades.at(-1), "칸을 비우면 찾는 말 없이 다시 부름").toBe("from=2023-12");
  expect(await overflowOf(page), "360px 가로 넘침").toBeLessThanOrEqual(0);
  assertNoErrors();
});

test("실거래가 D안 PC: 1280px은 같은 순서에 찾기칸·단추가 한 줄, 상태는 접힘, 1221px 이상은 표·1220px은 카드", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  await setup(page, { width: 1280 });
  await page.goto("/admin/work/realprice/");
  await expect(rows(page)).toHaveCount(30);
  await expect(page.locator("[data-rt-sum]")).not.toHaveAttribute("open", /.*/u);
  await expect(page.locator("[data-rt-sum] > summary")).toBeVisible();
  await page.locator("[data-rt-sum] > summary").click();
  await expect(page.locator(".rt-status")).toBeVisible();
  await expect(page.locator("[data-rt-last]")).toHaveText("11월 19일 12:10");
  await expect(page.locator("[data-rt-badge]")).toHaveText("정상");
  await page.locator("[data-rt-sum] > summary").click();
  const line = await page.evaluate(() => {
    const find = document.querySelector(".rt-find").getBoundingClientRect();
    const chips = document.querySelector(".rt-chips").getBoundingClientRect();
    return { sameRow: Math.abs(find.top - chips.top) < 4, chipsOneLine: chips.height < 50 };
  });
  expect(line, "찾기칸 옆에 단추 6개가 한 줄").toEqual({ sameRow: true, chipsOneLine: true });
  expect((await tapSizes(page)).filter((size) => size.width < 44 || size.height < 44), "44px보다 작은 단추").toEqual([]);
  await expect(page.locator("#rt-mode-label")).toBeVisible();
  await expect(page.locator("[data-rt-criterion]")).toBeVisible();
  await expect(page.locator("#rt-list-title")).toHaveText("새 거래 30건 보는 중", { useInnerText: true });
  await expect(page.getByRole("columnheader", { name: "담기" })).toBeVisible();
  expect(await rows(page).first().evaluate((row) => getComputedStyle(row).display)).toBe("table-row");
  await expect(rows(page).first().locator(".rt-prev")).toHaveText("앞선 최고 3억 9,500만 원");
  await expect(rows(page).first().locator(".rt-price__meta .rt-mtag--new"), "표에서는 표시가 금액 아래 작은 줄(보드 63번)").toBeVisible();
  await expect(page.locator('.admin-menu__subitem[href="/admin/work/realprice/"]').first()).toHaveAttribute("aria-current", "page");
  for (const width of [1221, 1220]) {
    await page.setViewportSize({ width, height: 900 });
    const shape = await page.evaluate(() => {
      const wrap = document.querySelector(".rt-table-wrap");
      return { display: getComputedStyle(document.querySelector("[data-rt-rows] > tr")).display, inner: wrap.scrollWidth - wrap.clientWidth };
    });
    expect(shape, `${width}px`).toEqual({ display: width === 1221 ? "table-row" : "block", inner: 0 });
    expect(await overflowOf(page), `${width}px 가로 넘침`).toBeLessThanOrEqual(0);
  }
  assertNoErrors();
});

test("실거래가 D안 주요 거래·다 담기: view=major 한 번(30일 매매 신고가 + 상위 10건), 0건 안내, '위에서 6건 담기'는 해제를 건너뛰고 최대 6건", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  let majorItems = firstPage.slice(0, 11);
  const calls = await setup(page, {
    width: 390,
    trades: (params) => {
      if (params.get("view") === "major") return envelope({ items: majorItems, nextCursor: null, recordHighReady: true, coverage: {}, warnings: [], major: { since: "2026-10-21", days: 30, top: 10 } });
      return envelope({ items: params.get("cancelled") === "include" ? [cancelledTrade, ...firstPage] : firstPage, nextCursor: null, recordHighReady: true, coverage: {}, warnings: [] });
    },
  });
  await page.goto("/admin/work/realprice/");
  await expect(rows(page)).toHaveCount(30);

  // 다 담기: 해제 빼기를 끄면 맨 위가 해제 거래 → 건너뛰고 다음 6건
  await page.locator("[data-rt-more-toggle]").click();
  await page.locator('[data-rt-filter="excludeCancelled"]').uncheck();
  await expect(rows(page)).toHaveCount(31);
  const take = page.locator("[data-rt-take]");
  await expect(take).toHaveText("위에서 6건 담기");
  await take.click();
  await expect(page.locator("[data-rt-pick-text]")).toHaveText("담은 거래 6건(최대 6건)");
  await expect(page.locator("[data-rt-live]")).toHaveText("6건을 담았습니다. 해제 거래 1건은 건너뛰었습니다. 담은 거래 6건(최대 6건).");
  await expect(take).toHaveText("6건 담음");
  await expect(take).toBeDisabled();
  await expect(rows(page).first().locator(".rt-pick")).toContainText("담을 수 없음");
  await expect(rows(page).nth(1).locator(".rt-pick")).toContainText("✓ 담음");
  await expect(rows(page).nth(7).getByRole("checkbox"), "6건을 담으면 나머지는 잠김").toBeDisabled();
  await expect(page.locator("[data-rt-promo-link]")).toHaveAttribute("href", `/admin/work/realprice/promo/?ids=${firstPage.slice(0, 6).map((item) => item.tradeKey).join(",")}`);
  await page.getByRole("button", { name: "비우기" }).click();
  await expect(take).toHaveText("위에서 6건 담기");

  // 주요 거래: 서버 view=major 한 번, 더 보기 없음
  await page.getByRole("radio", { name: "주요 거래" }).check();
  await expect.poll(() => calls.trades.at(-1)).toBe("view=major");
  await expect(rows(page)).toHaveCount(11);
  await expect(page.locator("[data-rt-more]")).toBeHidden();
  await expect(page.locator('[data-rt-filter="excludeCancelled"]')).toBeDisabled();
  await expect(page.locator("[data-rt-major-note]")).toBeVisible();
  await expect(take).toHaveText("위에서 6건 담기");
  majorItems = [];
  await page.locator("#rt-q").fill("가상숲");
  await page.locator("#rt-q").press("Enter");
  await expect.poll(() => calls.trades.at(-1)).toBe(new URLSearchParams({ view: "major", q: "가상숲" }).toString());
  await expect(page.locator("[data-rt-zero] h3")).toHaveText("'가상숲' 거래가 최근 30일 주요 거래에는 없습니다");
  await expect(page.locator("[data-rt-zero-action]"), "주요 거래는 기간을 바꾸지 않음").toHaveText(["찾는 말 지우기"]);
  for (const width of [360, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await overflowOf(page), `${width}px 가로 넘침`).toBeLessThanOrEqual(0);
  }
  assertNoErrors();
});

// CI(Linux)는 글꼴이 Windows보다 넓어 1221px 표가 8px 넘친 적이 있다(PR #80). 글자 간격을 넓혀 넓은 글꼴을 흉내 내고, 긴 단지명에서도
// 표 감싸개 안 가로 스크롤 0, 문서 가로 넘침 0(고르기 칸의 화면 읽기용 글자가 감싸개를 벗어나지 않음), 짧은 단지명은 끊기지 않음을 본다.
test("실거래가 1221px 표: 넓은 글꼴·긴 단지명에서도 표와 문서가 가로로 넘치지 않음", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  let long = false;
  const named = (item) => (long ? { ...item, aptName: item.aptName.replace("가상숲", "가상숲센트럴파크리버뷰더퍼스트") } : item);
  await setup(page, { width: 1221, trades: () => envelope({ items: firstPage.map(named), nextCursor: null, recordHighReady: true, coverage: {}, warnings: [] }) });
  for (const name of ["짧은 단지명", "긴 단지명"]) {
    long = name === "긴 단지명";
    await page.goto("/admin/work/realprice/");
    await expect(rows(page)).toHaveCount(30);
    for (const width of [1221, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      for (const spacing of ["normal", "0.04em"]) {
        const shape = await page.evaluate((spacing) => {
          document.querySelector(".rt-table").style.letterSpacing = spacing;
          const wrap = document.querySelector(".rt-table-wrap");
          const broken = [...document.querySelectorAll("[data-rt-rows] td.rt-name strong")].filter((strong) => strong.getClientRects().length > 1).length;
          return { inner: wrap.scrollWidth - wrap.clientWidth, page: document.documentElement.scrollWidth - document.documentElement.clientWidth, broken };
        }, spacing);
        const label = `${name} ${width}px 글자 간격 ${spacing}`;
        expect(shape.inner, `${label}: 표 안 가로 스크롤`).toBe(0);
        expect(shape.page, `${label}: 문서 가로 넘침`).toBeLessThanOrEqual(0);
        if (!long) expect(shape.broken, `${label}: 짧은 단지명이 두 줄로 끊김`).toBe(0);
      }
    }
  }
  assertNoErrors();
});

const states = [
  {
    name: "꺼짐",
    options: { session: { realpriceEnabled: false } },
    check: async (page) => {
      await expect(page.locator("[data-rt-state-title]")).toHaveText("실거래가 탭이 아직 켜지지 않았습니다");
      await expect(page.locator("[data-rt-main]")).toBeHidden();
    },
  },
  {
    name: "설정 누락",
    options: { session: () => failure(503, "REALPRICE_CONFIG_MISSING") },
    check: async (page) => {
      await expect(page.locator("[data-rt-state-title]")).toHaveText("실거래가 설정이 빠져 있습니다");
      await expect(page.locator("[data-rt-state-retry]")).toBeHidden();
    },
  },
  {
    name: "받기 전",
    options: { status: { ...okStatus, lastSuccessAt: null, coveredThrough: null, recordHighReady: false, backfill: { sale: { done: 0, total: 251 }, presale: { done: 0, total: 234 }, rent: { done: 0, total: 191 } } } },
    check: async (page, calls) => {
      await expect(page.locator("[data-rt-nodata] h2")).toHaveText("아직 받은 거래가 없습니다");
      await expect(page.locator("[data-rt-backfill] [role=progressbar]")).toHaveCount(3);
      await expect(page.locator(".rt-sum__line")).toHaveText("아직 받은 자료 없음");
      await expect(page.locator("[data-rt-sum-fill]")).toHaveText("과거 자료 채우기 대기 · 매매 0%");
      expect(calls.trades, "받은 자료가 없으면 목록을 부르지 않음").toEqual([]);
    },
  },
  {
    name: "처음 채우는 중",
    options: {
      status: { ...okStatus, coveredThrough: "2010-04", recordHighReady: false, backfill: { sale: { done: 200, total: 251 }, presale: { done: 0, total: 234 }, rent: { done: 0, total: 191 } } },
      trades: () => envelope({ items: firstPage.map((item) => ({ ...item, recordHigh: null, prevMaxWon: null })), nextCursor: null, recordHighReady: false, coverage: {}, warnings: [] }),
    },
    check: async (page) => {
      await expect(page.locator("[data-rt-backfill] .rt-progress__head").first()).toHaveText("매매79%");
      await expect(page.locator("[data-rt-sum-fill]")).toHaveText("과거 자료 채우는 중 · 매매 79% · 신고가는 채운 뒤");
      await expect(page.locator("[data-rt-backfill]"), "360px은 막대를 '자세히' 안에").toBeHidden();
      await expect(page.locator("[data-rt-notice]"), "360px은 목록 위 신고가 준비 안내를 상태 줄로 옮김").toBeHidden();
      await expect(page.locator("[data-rt-sum-high]")).toContainText("신고가 판정 준비 중(매매 과거 자료 채우는 중, 지금 2010년 4월까지)");
      await expect(page.locator(".rt-tag--high")).toHaveCount(0);
      await expect(page.locator("[data-rt-criterion]:visible")).toHaveCount(0);
    },
  },
  {
    name: "받기 멈춤",
    options: { status: { ...okStatus, lastSuccessAt: "2026-11-17T00:40:00Z", lastError: { code: "RT_KEY_EXPIRED", at: "2026-11-17T01:00:00Z" } } },
    check: async (page) => {
      await expect(page.locator("[data-rt-sum]"), "문제가 있으면 휴대폰에서도 펼쳐 둠").toHaveAttribute("open", "");
      await expect(page.locator("[data-rt-sum-badge]")).toHaveText("받기 멈춤");
      await expect(page.locator("[data-rt-sum-warn-text]")).toHaveText("인증키 연장 필요");
      await expect(page.locator(".rt-sum__line")).toHaveText("11. 17. 09:40까지 받은 자료(2일 전)");
      await expect(page.locator("[data-rt-status-warn]")).toContainText("아래 목록은 11월 17일 09:40까지 받은 자료입니다.");
      await expect(rows(page)).toHaveCount(30);
    },
  },
  {
    name: "0건",
    options: { trades: () => envelope({ items: [], nextCursor: null, recordHighReady: true, coverage: {}, warnings: [] }) },
    check: async (page, calls) => {
      await expect(page.locator("[data-rt-zero] h3")).toHaveText("조건에 맞는 거래가 없습니다.");
      await expect(page.locator("#rt-list-title")).toHaveText("새 거래 0건 보는 중", { useInnerText: true });
      await expect(page.locator("[data-rt-take]"), "0건이면 다 담기 단추 숨김").toBeHidden();
      await page.locator("[data-rt-more-toggle]").click();
      await page.locator("#rt-umd").selectOption("대동");
      await expect.poll(() => calls.trades.at(-1)).toBe(`umd=${encodeURIComponent("대동")}`);
      await page.getByRole("button", { name: "거르기 초기화" }).last().click();
      await expect.poll(() => calls.trades.at(-1)).toBe("");
    },
  },
  {
    name: "불러오는 중·오류(하루 조회 끝 상한)",
    options: { trades: () => failure(429, "RT_READ_BUDGET", { retryable: true, retryAt: "2026-11-20T00:00:00.000Z" }) },
    check: async (page) => {
      await expect(page.locator("[data-rt-error-text]")).toHaveText("오늘 실거래가 조회 한도를 넘었습니다. 11월 20일 09:00 이후 다시 보세요. 받아 둔 자료는 그대로 있습니다.");
      await expect(page.locator("#rt-list-title")).toHaveText("새 거래", { useInnerText: true });
      await expect(page.getByRole("button", { name: "다시 불러오기" })).toBeVisible();
    },
  },
  {
    name: "조회 첫 상한(신고가 잠시 끔)",
    options: { trades: () => envelope({ items: firstPage.map((item) => ({ ...item, recordHigh: null })), nextCursor: null, recordHighReady: true, coverage: {}, warnings: [{ code: "RT_READ_BUDGET", level: "soft" }] }) },
    check: async (page) => {
      await expect(page.locator("[data-rt-notice-text]")).toHaveText("오늘 조회가 많아 신고가 표시를 잠시 껐습니다. 한국 시각 오전 9시 뒤에 다시 보입니다. 목록은 그대로 볼 수 있습니다.");
      await expect(page.locator("[data-rt-criterion]:visible")).toHaveCount(0);
      await expect(rows(page)).toHaveCount(30);
    },
  },
];
for (const state of states) {
  test(`실거래가 상태 화면 — ${state.name}: 360·768px 가로 넘침 없음`, async ({ page }) => {
    const assertNoErrors = collectErrors(page);
    const calls = await setup(page, { width: 360, ...state.options });
    await page.goto("/admin/work/realprice/");
    await expect(page.locator("[data-rt-boot]")).toBeHidden();
    await state.check(page, calls);
    expect(await overflowOf(page), "360px").toBeLessThanOrEqual(0);
    await page.setViewportSize({ width: 768, height: 900 });
    expect(await overflowOf(page), "768px").toBeLessThanOrEqual(0);
    assertNoErrors();
  });
}

test("실거래가 979px 이하: 과거 자료를 채우는 동안에도 막대는 '자세히' 안에 두어 390px 첫 화면에 첫 거래가 다 들어오고, 980px 이상은 막대를 늘 보인다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const filling = { ...okStatus, backfill: { sale: { done: 251, total: 251 }, presale: { done: 234, total: 234 }, rent: { done: 150, total: 191 } } };
  await setup(page, { status: filling });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/work/realprice/");
  await expect(rows(page)).toHaveCount(30);
  await expect(page.locator("[data-rt-sum]")).not.toHaveAttribute("open", "");
  await expect(page.locator("[data-rt-sum-fill]")).toHaveText("과거 자료 채우는 중 · 전월세 78%");
  await expect(page.locator("[data-rt-backfill]")).toBeHidden();
  const first = await rows(page).first().boundingBox();
  const tabbar = await page.locator(".admin-tabbar").boundingBox();
  expect(first.y + first.height, "첫 거래 카드가 아래 탭 위에 다 보임").toBeLessThanOrEqual(tabbar.y);
  await page.locator("[data-rt-sum] > summary").click();
  await expect(page.locator("[data-rt-backfill]")).toBeVisible();
  await expect(page.locator("[data-rt-backfill] [role=progressbar]")).toHaveCount(3);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.reload();
  await expect(rows(page)).toHaveCount(30);
  await expect(page.locator("[data-rt-backfill]")).toBeVisible();
  await expect(page.locator("[data-rt-sum-fill]")).toBeHidden();
  assertNoErrors();
});

test("실거래가 979px 이하: 매매를 채우는 동안 신고가 준비 안내는 상태 줄 끝과 '자세히' 안으로 옮겨 390×844 첫 화면에 첫 거래가 다 들어오고, 980px 이상은 목록 위 안내 그대로", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const saleFilling = { ...okStatus, coveredThrough: "2010-04", recordHighReady: false, backfill: { sale: { done: 200, total: 251 }, presale: { done: 0, total: 234 }, rent: { done: 0, total: 191 } } };
  const calls = await setup(page, {
    status: saleFilling,
    trades: () => envelope({ items: firstPage.map((item) => ({ ...item, recordHigh: null, prevMaxWon: null })), nextCursor: null, recordHighReady: false, coverage: {}, warnings: [] }),
    // 판정 준비 전에는 서버가 흐름도 pending으로 돌려준다(보드 63번). 카드의 '흐름·직전 거래' 줄은 숨기고 까닭은 위 안내가 맡는다.
    insights: (ids) => envelope({ items: ids.map((id) => ({ tradeKey: id, available: false, reason: "pending" })), missing: [], basis: { months: 12, recentMonths: 3 }, recordHighReady: false, warnings: [] }),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/work/realprice/");
  await expect(rows(page)).toHaveCount(30);
  await expect(page.locator("[data-rt-sum]")).not.toHaveAttribute("open", "");
  await expect(page.locator("[data-rt-sum-fill]")).toHaveText("과거 자료 채우는 중 · 매매 79% · 신고가는 채운 뒤");
  await expect(page.locator("[data-rt-notice]")).toBeHidden();
  await expect(page.locator(".rt-tag--high")).toHaveCount(0);
  await expect(page.locator("[data-rt-criterion]:visible")).toHaveCount(0);
  await expect.poll(() => calls.insights.length).toBe(1);
  await expect(rows(page).first().locator(".rt-flowcell"), "채우는 동안 카드에는 누를 것 없는 흐름 줄을 두지 않음").toBeHidden();
  const first = await rows(page).first().boundingBox();
  const tabbar = await page.locator(".admin-tabbar").boundingBox();
  expect(first.y + first.height, "매매를 채우는 동안에도 첫 거래 카드가 아래 탭 위에 다 보임").toBeLessThanOrEqual(tabbar.y);
  await page.locator("[data-rt-sum] > summary").click();
  await expect(page.locator("[data-rt-sum-high]")).toBeVisible();
  await expect(page.locator("[data-rt-sum-high]")).toHaveText("신고가 판정 준비 중(매매 과거 자료 채우는 중, 지금 2010년 4월까지). 과거 자료가 빠진 채 표시하면 신고가가 아닌 거래를 신고가로 보일 수 있어 다 채운 뒤 표시합니다. 흐름·직전 거래도 그때 함께 보입니다.");
  await expect(page.locator("[data-rt-backfill]")).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.reload();
  await expect(rows(page)).toHaveCount(30);
  await expect(page.locator("[data-rt-notice]")).toBeVisible();
  await expect(page.locator("[data-rt-notice-text]")).toContainText("신고가 판정 준비 중(매매 과거 자료 채우는 중, 지금 2010년 4월까지)");
  await expect(rows(page).first().locator(".rt-flow")).toHaveText("흐름: 과거 자료 채우는 중");
  await expect(page.locator("[data-rt-sum-high]")).toBeHidden();
  await expect(page.locator("[data-rt-sum-fill]")).toBeHidden();
  assertNoErrors();
});

test("관심 단지가 비면 빈 상태와 설정 고리를 보이고 목록을 부르지 않는다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const calls = await setup(page, { watch: { version: 0, items: [] } });
  await page.goto("/admin/work/realprice/");
  await expect(rows(page)).toHaveCount(30);
  await page.getByRole("radio", { name: "관심 단지" }).check();
  await expect(page.locator("[data-rt-watch-empty] h2")).toHaveText("관심 단지를 아직 고르지 않았습니다");
  await expect(page.getByRole("link", { name: "설정에서 고르기" })).toHaveAttribute("href", "/admin/work/realprice/settings/");
  await expect(page.locator("[data-rt-list]")).toBeHidden();
  expect(calls.trades).toEqual([""]);
  assertNoErrors();
});

test("실거래가 설정: 넣기·빼기는 바로 저장하고 받은 홈페이지 단지 연결을 지키며, 공개 목록에 없는 연결만 비운다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const calls = await setup(page, {
    complexes: () => [
      { aptSeq: "A1", aptName: "가상숲1단지", umdName: "천동", tradeCount: 412, lastDealDate: "2026-11-12", suggestedSlug: null },
      { aptSeq: "B7", aptName: "가상언덕마을", umdName: "가양동", tradeCount: 88, lastDealDate: "2026-09-21", suggestedSlug: null },
    ],
    // 첫 저장은 보안 확인 만료 → 세션을 새로 받아 한 번 더 보냄
    put: (_body, count) => (count === 1 ? failure(403, "CSRF_INVALID") : null),
  });
  await page.goto("/admin/work/realprice/settings/");
  const list = page.locator("[data-rt-watch-list] > li");
  await expect(list).toHaveCount(2);
  await expect(list.first()).toContainText("가상숲1단지");
  await expect(list.first()).toContainText("홈페이지 단지: 리더스시티 4블록");
  await expect(list.nth(1)).not.toContainText("홈페이지 단지");
  await expect(page.locator("[data-rt-watch-count]")).toHaveText("2곳 / 최대 20곳");
  await expect(page.locator('.admin-subtabs a[href="/admin/work/realprice/"]'), "설정 화면에서는 실거래가가 지금 구역").toHaveAttribute("aria-current", "true");

  await page.locator("#rt-complex-q").fill("가상");
  await page.locator("#rt-complex-q").press("Enter");
  await expect(page.locator("[data-rt-results] > li")).toHaveCount(2);
  expect(calls.complexes).toEqual(["가상"]);
  await expect(page.locator("[data-rt-result-title]")).toHaveText("“가상” 찾은 단지 2곳");
  await expect(page.locator("[data-rt-results] > li").first()).toContainText("관심 단지에 있음");
  await page.getByRole("button", { name: "가상언덕마을 관심 단지에 넣기" }).click();
  await expect(page.locator("[data-rt-watch-done-text]")).toHaveText("관심 단지에 넣었습니다: 가상언덕마을. 홈페이지에서 내린 단지 연결 1곳은 비웠습니다.");
  await expect(page.locator("[data-rt-watch-done]")).toBeFocused();
  expect(calls.puts).toHaveLength(2);
  expect(calls.puts[0].headers["x-admin-csrf"]).toBe("test-csrf-1");
  expect(calls.puts[1].headers["x-admin-csrf"], "만료 뒤 새 세션 토큰").toBe("test-csrf-2");
  expect(calls.puts[1].headers["content-type"]).toBe("application/json");
  expect(calls.puts[1].body).toEqual({
    version: 3,
    items: [
      { aptSeq: "A1", displayName: "가상숲1단지", complexSlug: "leaders-city-4" },
      { aptSeq: "A2", displayName: "가상숲2단지", complexSlug: null },
      { aptSeq: "B7", displayName: "가상언덕마을", complexSlug: null },
    ],
  });
  await expect(list).toHaveCount(3);
  await expect(page.locator("[data-rt-results] > li").nth(1)).toContainText("관심 단지에 있음");

  await page.getByRole("button", { name: "가상숲2단지 관심 단지에서 빼기" }).click();
  await expect(page.locator("[data-rt-watch-done-text]")).toHaveText("관심 단지에서 뺐습니다: 가상숲2단지.");
  expect(calls.puts.at(-1).body.items.map((item) => item.aptSeq)).toEqual(["A1", "B7"]);
  expect(calls.puts.at(-1).body.version).toBe(4);
  expect(await overflowOf(page)).toBeLessThanOrEqual(0);
  assertNoErrors();
});

test("실거래가 설정: 다른 창에서 먼저 바꿨으면(409) 저장하지 않고 새 목록과 알림을 보인다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const latest = { version: 9, items: [{ aptSeq: "C1", displayName: "가상들판아파트", complexSlug: null }] };
  const calls = await setup(page, {
    watch: (count) => (count === 1 ? { version: 3, items: [{ aptSeq: "A1", displayName: "가상숲1단지", complexSlug: null }] } : latest),
    put: () => failure(409, "VERSION_CONFLICT"),
  });
  await page.goto("/admin/work/realprice/settings/");
  await page.getByRole("button", { name: "가상숲1단지 관심 단지에서 빼기" }).click();
  await expect(page.locator("[data-rt-watch-alert-text]")).toHaveText("다른 창에서 관심 단지를 먼저 바꿔서 이번 변경은 저장하지 않았습니다. 아래는 새로 불러온 목록입니다. 확인한 뒤 다시 넣거나 빼 주세요.");
  await expect(page.locator("[data-rt-watch-alert]")).toBeFocused();
  await expect(page.locator("[data-rt-watch-list] > li")).toHaveCount(1);
  await expect(page.locator("[data-rt-watch-list]")).toContainText("가상들판아파트");
  expect(calls.watchGets).toBe(2);
  assertNoErrors();
});

test("실거래가 설정: 관심 단지가 비면 홈페이지 단지 이름 첫 낱말 단추로 찾고, 다시 받기는 빈 본문 POST 뒤 단추를 끈다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const calls = await setup(page, { watch: { version: 0, items: [] } });
  await page.goto("/admin/work/realprice/settings/");
  await expect(page.locator("[data-rt-watch-empty]")).toBeVisible();
  const seeds = page.locator("[data-rt-seed-buttons] > button");
  await expect(seeds).toHaveText(["리더스시티", "신흥"]);
  await seeds.first().click();
  await expect.poll(() => calls.complexes).toEqual(["리더스시티"]);
  await expect(page.locator("#rt-complex-q")).toHaveValue("리더스시티");
  await expect(page.locator("[data-rt-search-status]")).toContainText("“리더스시티”와(과) 이름이 맞는 단지가 없습니다.");

  await expect(page.locator("[data-rt-bars] [role=progressbar]")).toHaveCount(3);
  await expect(page.locator('[data-rt-usage="reads"]')).toHaveText("38만 행 / 첫 상한 150만 행");
  await expect(page.locator("[data-rt-runs] > tr")).toHaveCount(2);
  await expect(page.locator("[data-rt-runs] > tr").nth(1)).toContainText("실패");

  const refresh = page.getByRole("button", { name: "지금 다시 받기" });
  await refresh.click();
  await expect(page.locator("[data-rt-refresh-done-text]")).toHaveText("다시 받기를 차례에 넣었습니다. 최근 자료 12건(4개월 × 3종류)을 약 2시간 안에 모두 다시 받습니다. 그동안 목록은 지금 자료로 볼 수 있습니다.");
  await expect(page.locator("[data-rt-refresh]")).toBeDisabled();
  await expect(page.locator("[data-rt-refresh]")).toHaveText("다시 받는 중(약 2시간)");
  expect(calls.refresh).toHaveLength(1);
  expect(calls.refresh[0].body).toEqual({});
  expect(calls.refresh[0].headers["x-admin-csrf"]).toBe("test-csrf-1");
  for (const width of [360, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await overflowOf(page), `${width}px`).toBeLessThanOrEqual(0);
  }
  await expect(page.locator('.admin-menu__subitem[href="/admin/work/realprice/"]').first()).toHaveAttribute("aria-current", "true");
  assertNoErrors();
});

test("실거래가 설정: 찾는 중에는 Enter(키 반복 포함)·검색어 단추를 다시 눌러도 한 번만 부른다(한 번에 약 8,700행 읽음)", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const calls = await setup(page, { watch: { version: 0, items: [] } });
  // 나중에 건 길이 먼저 쓰인다: 응답을 0.4초 늦춘다.
  await page.route(`${WORK}/realprice/complexes**`, async (route) => {
    calls.complexes.push(new URL(route.request().url()).searchParams.get("q"));
    await new Promise((resolve) => setTimeout(resolve, 400));
    await route.fulfill(envelope({ items: [] }));
  });
  await page.goto("/admin/work/realprice/settings/");
  const query = page.locator("#rt-complex-q");
  await query.fill("가상숲");
  await query.focus();
  for (let index = 0; index < 5; index += 1) await page.keyboard.press("Enter");
  await expect(page.locator("[data-rt-search-status]")).toHaveText("찾는 중입니다…");
  await page.locator("[data-rt-seed-buttons] > button").first().click();
  await expect(query, "찾는 중에 누른 검색어 단추는 입력칸도 바꾸지 않음").toHaveValue("가상숲");
  await expect(page.locator("[data-rt-search-status]")).toContainText("“가상숲”와(과) 이름이 맞는 단지가 없습니다.");
  expect(calls.complexes, "Enter 5번 + 검색어 단추 1번 → 1번만 부름").toEqual(["가상숲"]);

  // Enter를 누르고 있으면(키 반복) 첫 keydown만 부른다.
  await query.focus();
  await page.keyboard.down("Enter");
  await expect.poll(() => calls.complexes.length).toBe(2);
  await expect(page.locator("[data-rt-search-status]")).toContainText("이름이 맞는 단지가 없습니다.");
  await page.keyboard.down("Enter");
  await page.keyboard.down("Enter");
  await page.keyboard.up("Enter");
  await page.waitForTimeout(600);
  expect(calls.complexes, "키 반복 keydown은 무시").toHaveLength(2);
  assertNoErrors();
});

test("실거래가 설정: 하루 조회 끝 상한을 넘은 날 다시 받기 알림은 '약 2시간 안에' 대신 한국 시각 오전 9시부터 받는다고 알린다(TK-29)", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const calls = await setup(page, { status: { ...okStatus, today: { ...okStatus.today, rowsRead: okStatus.today.readHardLimit } } });
  await page.goto("/admin/work/realprice/settings/");
  await page.getByRole("button", { name: "지금 다시 받기" }).click();
  await expect(page.locator("[data-rt-refresh-done-text]")).toHaveText("다시 받기를 차례에 넣었습니다. 하루 조회 한도를 넘어 한국 시각 내일 오전 9시부터 다시 받습니다. 최근 자료 12건(4개월 × 3종류)은 그 뒤 약 2시간 안에 모두 받습니다. 목록과 단지 찾기도 오전 9시부터 다시 볼 수 있습니다.");
  await expect(page.locator("[data-rt-refresh]")).toHaveText("오전 9시부터 다시 받음");
  await expect(page.locator("[data-rt-refresh]")).toBeDisabled();
  expect(calls.refresh).toHaveLength(1);
  assertNoErrors();
});

test("실거래가 설정: 꺼져 있거나 설정이 빠졌으면 상태 화면만 보인다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  await setup(page, { width: 360, session: { realpriceEnabled: false } });
  await page.goto("/admin/work/realprice/settings/");
  await expect(page.locator("[data-rt-state-title]")).toHaveText("실거래가 탭이 아직 켜지지 않았습니다");
  await expect(page.locator("[data-rt-main]")).toBeHidden();
  expect(await overflowOf(page)).toBeLessThanOrEqual(0);
  assertNoErrors();
});

// ── P1-e 홍보물(TK-38 ~ TK-40, P1-f에서 D안): 목록 담기·홍보물 화면·그림 저장·A4 인쇄 ──

// 운영과 같은 CSP를 홍보물 화면에 붙여(시험 서버는 헤더를 보내지 않음) data 주소 그림·내려받기가 막히지 않는지 본다.
const PRODUCTION_CSP = /^\s*Content-Security-Policy: (.+)$/mu.exec(readFileSync(new URL("../public/_headers", import.meta.url), "utf8"))[1];
const promoItems = [
  trade(1, { recordHigh: true, prevMaxWon: 395_000_000, aptDong: "103" }),
  trade(2, { kind: "rent", priceWon: null, depositWon: 20_000_000, monthlyRentWon: 850_000, umdName: "신흥동", tradeKey: "rent:202611:00000000000000000002:1" }),
  trade(3, { floor: -1 }),
];
const promoAnswer = (over = {}) => envelope({ items: promoItems, missing: [], receivedAt: "2026-11-19T03:10:00Z", recordHighReady: true, warnings: [], ...over });
const idsOf = (items) => items.map((item) => item.tradeKey).join(",");
async function withProductionCsp(page) {
  const violations = [];
  await page.route("**/admin/work/realprice/promo/**", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), "content-security-policy": PRODUCTION_CSP } });
  });
  await page.exposeFunction("__cspViolation", (text) => violations.push(text));
  await page.addInitScript(() => document.addEventListener("securitypolicyviolation", (event) => window.__cspViolation(`${event.violatedDirective} ${event.blockedURI}`)));
  return violations;
}
const pngSize = (bytes) => ({ width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), signature: bytes.subarray(1, 4).toString("ascii") });

test("P1-e 목록 담기: 해제는 못 담음, 최대 6건에서 나머지 잠금, 막대의 '홍보물 만들기' 주소는 담은 ID, 키보드 Space로 담기", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  await setup(page, { width: 390, trades: (params) => envelope({ items: params.get("cancelled") === "include" ? [cancelledTrade, ...firstPage] : firstPage, nextCursor: null, recordHighReady: true, coverage: {}, warnings: [] }) });
  await page.goto("/admin/work/realprice/");
  await expect(rows(page)).toHaveCount(30);
  const bar = page.locator("[data-rt-pick-bar]");
  await expect(bar).toBeHidden();
  const boxes = page.locator("[data-rt-rows] input[data-rt-pick]");
  await expect(boxes).toHaveCount(30);
  const firstBox = rows(page).first().getByRole("checkbox");
  await expect(firstBox).toHaveAccessibleName("가상숲1단지 2026. 11. 27. 매매 홍보물에 담기");
  const label = await rows(page).first().locator(".rt-pick label").boundingBox();
  const box = await firstBox.boundingBox();
  expect(label.height >= 44 && label.width >= 44, "담기 단추 44px").toBe(true);
  expect(label.width - box.width <= 4 && label.height - box.height <= 4, "체크 칸이 단추 테두리 안을 다 덮음(어디를 눌러도 담김)").toBe(true);
  await expect(rows(page).first().locator(".rt-pick")).toContainText("담기");

  await firstBox.focus();
  await page.keyboard.press("Space");
  await expect(firstBox).toBeChecked();
  await expect(rows(page).first().locator(".rt-pick")).toContainText("✓ 담음");
  await rows(page).nth(1).getByRole("checkbox").check();
  await expect(bar).toBeVisible();
  await expect(page.locator("[data-rt-pick-text]")).toHaveText("담은 거래 2건");
  await expect(page.locator("[data-rt-promo-link]")).toHaveAttribute("href", `/admin/work/realprice/promo/?ids=${firstPage[0].tradeKey},${firstPage[1].tradeKey}`);
  const barBox = await bar.boundingBox();
  expect(barBox.y + barBox.height, "휴대폰은 아래 탭(56px) 위에 붙음").toBeLessThanOrEqual(900 - 56 + 1);

  for (const index of [2, 3, 4, 5]) await rows(page).nth(index).getByRole("checkbox").check();
  await expect(page.locator("[data-rt-pick-text]")).toHaveText("담은 거래 6건(최대 6건)");
  await expect(rows(page).nth(6).getByRole("checkbox"), "6건을 담으면 나머지는 잠김").toBeDisabled();
  await rows(page).nth(5).getByRole("checkbox").uncheck();
  await expect(rows(page).nth(6).getByRole("checkbox")).toBeEnabled();

  // 해제 빼기를 끄면 해제 거래가 보이지만 담을 수 없고, 거르기를 바꿔도 담은 것은 남는다.
  await page.locator("[data-rt-more-toggle]").click();
  await page.locator('[data-rt-filter="excludeCancelled"]').uncheck();
  await expect(rows(page)).toHaveCount(31);
  const cancelledBox = rows(page).first().getByRole("checkbox");
  await expect(cancelledBox).toBeDisabled();
  await expect(cancelledBox).toHaveAccessibleName(/해제된 거래라 홍보물에 담을 수 없음$/u);
  await expect(rows(page).first().locator(".rt-pick")).toContainText("담을 수 없음");
  await expect(page.locator("[data-rt-pick-text]")).toHaveText("담은 거래 5건");
  await expect(rows(page).nth(1).getByRole("checkbox")).toBeChecked();

  await page.getByRole("button", { name: "비우기" }).click();
  await expect(bar).toBeHidden();
  await expect(boxes.filter({ has: page.locator(":checked") })).toHaveCount(0);
  expect(await page.locator("[data-rt-rows] input:checked").count()).toBe(0);
  for (const width of [360, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await overflowOf(page), `${width}px 가로 넘침`).toBeLessThanOrEqual(0);
  }
  await expect(page.getByRole("columnheader", { name: "담기" })).toBeVisible();
  assertNoErrors();
});

// TU-23(TR-11 결과 54절): 980px 이상에서도 Tab으로 옮긴 포커스가 아래 막대 뒤로 숨지 않는다(막대 높이는 화면이 재서 scroll-padding-bottom에 씀).
// 표의 '담기' 글자도 담기 칸 안에 머문다(감싸개를 벗어나 문서를 넓히지 않음, PR #80).
test("P1-e 목록 담기 980px 이상: Tab 포커스가 아래 막대에 가리지 않고, 담기 글자는 담기 칸 안", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  await setup(page, { width: 1280, trades: () => envelope({ items: firstPage, nextCursor: null, recordHighReady: true, coverage: {}, warnings: [] }) });
  // 문서는 부드러운 스크롤이라 Tab 직후에는 아직 움직이는 중이다. 움직임 줄이기 환경(바로 스크롤)에서 같은 scroll-padding 규칙을 본다.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/admin/work/realprice/");
  await expect(rows(page)).toHaveCount(30);
  // 위치 기준(offsetParent)이 칸 밖(BODY)이면 표가 감싸개 안에서 밀릴 때 글자가 감싸개에 잘리지 않고 문서를 넓힌다.
  const inside = await rows(page).first().locator("td.rt-pick").evaluate((td) => {
    const text = td.querySelector(".admin-review-select span");
    const cell = td.getBoundingClientRect();
    const box = text.getBoundingClientRect();
    return { base: td.contains(text.offsetParent), box: box.left >= cell.left && box.right <= cell.right && box.top >= cell.top && box.bottom <= cell.bottom };
  });
  expect(inside, "1280px 표: '담기' 글자의 위치 기준과 자리가 담기 칸 안").toEqual({ base: true, box: true });
  for (const width of [1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await rows(page).nth(0).getByRole("checkbox").check();
    await rows(page).nth(1).getByRole("checkbox").check();
    await expect(page.locator("[data-rt-pick-bar]")).toBeVisible();
    // 브라우저가 포커스를 옮기며 스크롤하는 위치는 행 위치에 따라 달라, 여백이 막대 높이 이상인지도 직접 본다.
    const room = await page.evaluate(() => ({ padding: parseFloat(getComputedStyle(document.documentElement).scrollPaddingBottom), bar: document.querySelector("[data-rt-pick-bar]").getBoundingClientRect().height }));
    expect(room.padding, `${width}px: 아래 여백이 막대 높이(${room.bar}px) 이상`).toBeGreaterThanOrEqual(room.bar);
    await rows(page).nth(1).getByRole("checkbox").focus();
    const hidden = [];
    for (let step = 0; step < 40; step += 1) {
      await page.keyboard.press("Tab");
      const where = await page.evaluate(() => {
        const active = document.activeElement;
        if (!active?.closest("[data-rt-rows]")) return null;
        const box = active.closest("label")?.getBoundingClientRect() ?? active.getBoundingClientRect();
        const bar = document.querySelector("[data-rt-pick-bar]").getBoundingClientRect();
        return { row: [...document.querySelectorAll("[data-rt-rows] > tr")].indexOf(active.closest("tr")), covered: box.bottom > bar.top && box.top < bar.bottom };
      });
      if (!where) break;
      if (where.covered) hidden.push(where.row);
    }
    expect(hidden, `${width}px: 막대에 가린 담기 칸(행 번호)`).toEqual([]);
    await page.getByRole("button", { name: "비우기" }).click();
  }
  assertNoErrors();
});

test("P1-e TK-39 홍보물 화면: ids로만 다시 읽고 카드 PNG 1080×1350·realprice-YYYYMMDD.png 내려받기, CSP 위반 0, 글 4가지 숫자 = 자료, 복사", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const violations = await withProductionCsp(page);
  const calls = await setup(page, { width: 390, trades: () => promoAnswer() });
  await page.goto(`/admin/work/realprice/promo/?ids=${idsOf(promoItems)}`);
  await expect(page.locator("[data-promo-main]")).toBeVisible();
  expect(calls.trades, "목록 거르기 없이 ids만").toEqual([new URLSearchParams({ ids: idsOf(promoItems) }).toString()]);
  await expect(page.locator("[data-promo-notice]")).toBeHidden();

  // D안 순서: 담은 거래 요약 → '어디에 올릴까요?'(인스타그램이 기본) → ① 그림 저장 ② 글 복사 ③ 붙여 넣기
  await expect(page.locator("[data-promo-picked] > li")).toHaveCount(3);
  await expect(page.getByRole("link", { name: "거래 다시 고르기" })).toHaveAttribute("href", "/admin/work/realprice/");
  await expect(page.getByRole("radio", { name: "인스타그램" })).toBeChecked();
  await expect(page.locator("[data-promo-step-image]")).toHaveText("카드 그림을 휴대폰에 저장합니다.");
  await expect(page.locator("[data-promo-step-text]")).toHaveText(/^글을 복사합니다\(해시태그 \d+개 포함, 2,200자 중 [\d,]+자\)\.$/u);
  await expect(page.locator("[data-promo-step-post]")).toHaveText(/^인스타그램 앱에서 새 게시물/u);
  await expect(page.locator("[data-promo-text-fold]"), "글 미리 보기는 접혀 있음").not.toHaveAttribute("open", /.*/u);
  const download = page.locator("[data-promo-download]");
  await expect(download).toHaveCount(1);
  await expect(download).toHaveText("그림 저장");
  await expect(download).toHaveAttribute("download", "realprice-20261119.png");
  await expect(page.locator(".rt-promo__card img")).toHaveAttribute("src", /^data:image\/png;base64,/u);
  const [file] = await Promise.all([page.waitForEvent("download"), download.click()]);
  expect(file.suggestedFilename()).toBe("realprice-20261119.png");
  const size = pngSize(readFileSync(await file.path()));
  expect(size).toEqual({ width: 1080, height: 1350, signature: "PNG" });
  await expect(download, "누른 단추에는 ✓ 표시").toHaveText("✓ 그림 저장함");

  await page.locator("[data-promo-text-fold] > summary").click();
  const preview = page.locator("[data-promo-preview]");
  const texts = {};
  for (const [value, name] of [["threads", "스레드"], ["instagram", "인스타그램"], ["blog", "블로그"], ["kakao", "카카오톡"]]) {
    await page.getByRole("radio", { name }).check();
    await expect(page.locator("[data-promo-preview-label]")).toHaveText(`${name} 글`);
    await expect(page.locator("[data-promo-copy]")).toHaveText(`${name} 글 복사`);
    texts[value] = await preview.inputValue();
    for (const money of ["4억 100만 원", "보증금 2,000만 / 월 85만 원", "4억 300만 원"]) expect(texts[value], `${name}: ${money}`).toContain(money);
    expect(texts[value], `${name}: 층 숫자 그대로`).toContain("지하 1층");
    expect(texts[value], `${name}: 동 번호 0`).not.toMatch(/103동/u);
    expect(texts[value], `${name}: 받은 시각(한국 12:10)`).toMatch(/11\. 19\. 12:10 받/u);
    expect(texts[value]).toContain("010-2790-8675");
  }
  await expect(page.locator("[data-promo-count]")).toHaveText(/자$/u);
  await page.getByRole("radio", { name: "인스타그램" }).check();
  await expect(page.locator("[data-promo-count]")).toHaveText(/자 \/ 2,200자 · 해시태그 \d+개$/u);
  const tags = texts.instagram.match(/#[^\s#]+/gu) ?? [];
  expect(tags.length, "해시태그 12개 안").toBeLessThanOrEqual(12);
  for (const tag of ["#대전동구", "#아파트실거래가", "#천동", "#가상숲1단지"]) expect(tags, `해시태그 ${tag}(고정·법정동·단지 이름)`).toContain(tag);
  await expect(page.locator("[data-promo-step-text]")).toContainText(`해시태그 ${tags.length}개 포함`);

  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(page.url()).origin });
  await page.getByRole("button", { name: "인스타그램 글 복사" }).click();
  await expect(page.locator("[data-promo-status]")).toHaveText("✓ 인스타그램 글을 복사했습니다.");
  await expect(page.locator("[data-promo-copy]")).toHaveText("✓ 인스타그램 글 복사함");
  // Windows 클립보드는 줄바꿈을 CRLF로 바꿔 돌려주므로 줄바꿈만 맞춰 비교한다.
  expect((await page.evaluate(() => navigator.clipboard.readText())).replaceAll("\r\n", "\n")).toBe(texts.instagram);

  for (const width of [360, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await overflowOf(page), `${width}px 가로 넘침`).toBeLessThanOrEqual(0);
  }
  expect(violations, "CSP 위반 0").toEqual([]);
  assertNoErrors();
});

test("P1-e 대장 조건 3·4: 해제로 바뀐 거래·찾지 못한 거래는 빼고 알리고, 신고가 판정을 못 하면 '신고가' 말 없이, 4건 이상은 두 장", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const many = [...promoItems, trade(4), trade(5, { cancelled: true, cancelledOn: "2026-11-18" }), trade(6)].map((item) => ({ ...item, recordHigh: item.kind === "sale" ? null : false, prevMaxWon: null }));
  await setup(page, { width: 1280, trades: () => promoAnswer({ items: many, missing: ["sale:202611:00000000000000000009:1"], recordHighReady: false }) });
  await page.goto(`/admin/work/realprice/promo/?ids=${idsOf(many.slice(0, 5))},sale:202611:00000000000000000009:1`);
  await expect(page.locator("[data-promo-main]")).toBeVisible();
  await expect(page.locator("[data-promo-notice-text]")).toHaveText(/^해제된 거래 1건을 뺐습니다\. 찾지 못한 거래 1건을 뺐습니다\..+신고가 표시 없이 만들었습니다\.$/u);
  await expect(page.locator("[data-promo-download]")).toHaveText(["1장 저장", "2장 저장"]);
  await expect(page.locator("[data-promo-step-image]")).toHaveText("카드 그림 2장을 휴대폰에 저장합니다.");
  await expect(page.locator("[data-promo-download]").nth(1)).toHaveAttribute("download", "realprice-20261119-2.png");
  await expect(page.locator(".rt-promo__card img").first()).toHaveAttribute("alt", "카드 그림 1/2장: 실거래 5건 · 1/2장");
  for (const name of ["스레드", "인스타그램", "블로그", "카카오톡"]) {
    await page.getByRole("radio", { name }).check();
    const text = await page.locator("[data-promo-preview]").inputValue();
    expect(text, `${name}: 신고가 말 없음`).not.toContain("신고가");
    expect(text, `${name}: 해제 거래 없음`).not.toContain("가상숲5단지");
  }
  assertNoErrors();
});

test("P1-e 상태: ids 없음·모두 해제·불러오기 실패는 만들지 않고 목록으로 가는 길을 보인다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  let answer = promoAnswer({ items: [{ ...promoItems[0], cancelled: true }], receivedAt: null });
  const calls = await setup(page, { width: 360, trades: () => answer });
  await page.goto("/admin/work/realprice/promo/");
  await expect(page.locator("[data-promo-state-title]")).toHaveText("담은 거래가 없습니다");
  expect(calls.trades, "ids가 없으면 서버를 부르지 않음").toEqual([]);
  await expect(page.getByRole("link", { name: "실거래가 목록으로" })).toHaveAttribute("href", "/admin/work/realprice/");

  await page.goto("/admin/work/realprice/promo/?ids=sale:1");
  await expect(page.locator("[data-promo-state-body]")).toHaveText("주소의 거래 목록이 올바르지 않습니다. 실거래가 목록에서 다시 담아 주세요.");

  await page.goto(`/admin/work/realprice/promo/?ids=${promoItems[0].tradeKey}`);
  await expect(page.locator("[data-promo-state-title]")).toHaveText("홍보물을 만들 수 없습니다");
  await expect(page.locator("[data-promo-notice-text]")).toHaveText("해제된 거래 1건을 뺐습니다.");
  await expect(page.locator("[data-promo-main]")).toBeHidden();

  answer = failure(429, "RT_READ_BUDGET", { retryAt: "2026-11-20T00:00:00.000Z" });
  await page.goto(`/admin/work/realprice/promo/?ids=${promoItems[0].tradeKey}`);
  await expect(page.locator("[data-promo-state-title]")).toHaveText("담은 거래를 불러오지 못했습니다");
  await expect(page.locator("[data-promo-retry]")).toBeVisible();
  answer = promoAnswer();
  await page.locator("[data-promo-retry]").click();
  await expect(page.locator("[data-promo-main]")).toBeVisible();
  expect(await overflowOf(page)).toBeLessThanOrEqual(0);
  assertNoErrors();
});

test("P1-e TK-40 인쇄: 메뉴·단추·설명은 숨기고 카드 그림만 A4 한 장(PDF 1쪽)", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  await setup(page, { width: 1280, trades: () => promoAnswer({ items: [...promoItems, trade(4), trade(5)] }) });
  await page.goto(`/admin/work/realprice/promo/?ids=${idsOf(promoItems)}`);
  await expect(page.locator("[data-promo-download]")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "종이로 뽑기(A4)" })).toBeEnabled();
  await page.emulateMedia({ media: "print" });
  for (const selector of [".admin-side", ".admin-top", ".admin-tabbar", "[data-promo-main]", ".work-doc__header", ".admin-page-help"]) await expect(page.locator(selector).first(), selector).toBeHidden();
  await expect(page.locator(".rt-print-sheet img")).toHaveCount(2);
  for (const image of await page.locator(".rt-print-sheet img").all()) await expect(image).toBeVisible();
  const pdf = (await page.pdf({ format: "A4", preferCSSPageSize: true })).toString("latin1");
  expect((pdf.match(/\/Type\s*\/Page(?!s)/gu) ?? []).length, "A4 한 장").toBe(1);
  await page.emulateMedia({ media: "screen" });
  await expect(page.locator(".rt-print-sheet")).toBeHidden();
  assertNoErrors();
});

// ── 거래 흐름(보드 63번) ──

test("거래 흐름 390px: 매매 카드마다 접힌 '흐름·직전 거래', 펼치면 흐름선·직전 거래·칸 3개, 전월세·직거래는 없음, 보이는 매매 ID만 한 번에 묻고 다시 묻지 않음", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const calls = await setup(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/work/realprice/");
  await expect(rows(page)).toHaveCount(30);
  const first = rows(page).first();
  const fold = first.locator(".rt-flowfold");
  await expect(fold.locator("summary")).toHaveText("흐름·직전 거래 · 대비 ▲ 101.5%");
  await expect(fold).not.toHaveAttribute("open", /.*/u);
  await expect(rows(page).nth(1).locator(".rt-flowcell"), "월세는 계산하지 않음").toBeHidden();
  await expect(rows(page).nth(2).locator(".rt-flowcell"), "직거래는 계산하지 않음").toBeHidden();
  expect(calls.insights.length, "쪽을 그린 뒤 한 번").toBe(1);
  const asked = calls.insights[0].split(",");
  expect(asked.length).toBe(28);
  expect(asked.includes(firstPage[1].tradeKey) || asked.includes(firstPage[2].tradeKey), "전월세·직거래 ID는 묻지 않음").toBe(false);
  await fold.locator("summary").click();
  await expect(fold.locator(".rt-spark")).toBeVisible();
  await expect(fold.locator(".rt-flowfold__prev")).toHaveText("○ 직전 거래 2026. 10. 2. · 9층 · 3억 9,000만 원");
  await expect(fold.locator(".rt-mini3 dd")).toHaveText(["3억 9,500만", "▲ 101.5%", "3건"]);
  const pickBox = await first.locator(".rt-pick-button").boundingBox();
  const miniBox = await fold.locator(".rt-mini3").boundingBox();
  expect(pickBox.y, "펼쳐도 '담기'가 칸 3개를 가리지 않음").toBeGreaterThan(miniBox.y + miniBox.height - 1);
  expect(await overflowOf(page), "390px 가로 넘침").toBeLessThanOrEqual(0);
  await page.locator("[data-rt-toggle='highOnly']").click();
  await expect(rows(page)).toHaveCount(1);
  await page.locator("[data-rt-toggle='highOnly']").click();
  await expect(rows(page)).toHaveCount(30);
  await expect(rows(page).first().locator(".rt-flowfold summary")).toBeVisible();
  expect(calls.insights.length, "같은 ID는 화면 메모리에서 다시 씀").toBe(1);
  await page.locator("[data-rt-more-button]").click();
  await expect(rows(page)).toHaveCount(35);
  await expect.poll(() => calls.insights.length).toBe(2);
  expect(calls.insights[1].split(",").length, "더 불러온 5건만").toBe(5);
  assertNoErrors();
});

test("거래 흐름 1280px 표: 칸 3개(흐름·직전 거래·최고가 대비), 거래 종류·표시는 금액 아래, 법정동·준공연도는 단지 아래, 첫 거래·한 달만", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  await setup(page, { width: 1280 });
  await page.goto("/admin/work/realprice/");
  await expect(rows(page)).toHaveCount(30);
  for (const name of ["흐름(12개월)", "직전 거래", "최고가 대비"]) await expect(page.getByRole("columnheader", { name })).toBeVisible();
  for (const name of ["거래", "표시", "법정동"]) await expect(page.getByRole("columnheader", { name, exact: true })).toBeHidden();
  const first = rows(page).first();
  await expect(first.locator(".rt-flow .rt-spark")).toBeVisible();
  await expect(first.locator(".rt-flow .rt-flow__count")).toHaveText("3개월 3건");
  await expect(first.locator(".rt-last")).toHaveText("3억 9,000만10. 2. · 9층", { useInnerText: false });
  await expect(first.locator(".rt-ratio strong")).toHaveText("▲ 101.5%");
  await expect(first.locator(".rt-ratio small")).toHaveText("앞선 최고 3억 9,500만");
  await expect(first.locator(".rt-price__meta")).toContainText("매매");
  await expect(first.locator(".rt-price__meta .rt-mtag--high")).toHaveText("신고가");
  await expect(first.locator(".rt-name__sub")).toHaveText("천동 · 2020년");
  await expect(rows(page).nth(2).locator(".rt-price__meta")).toContainText("매매 · 직거래");
  await expect(rows(page).nth(3).locator(".rt-ratio strong")).toHaveText("첫 거래");
  await expect(rows(page).nth(3).locator(".rt-last")).toHaveText("직전 거래 없음");
  await expect(rows(page).nth(3).locator(".rt-flow")).toContainText("한 달만 거래");
  await expect(rows(page).nth(1).locator(".rt-flow"), "월세는 비우고 화면 읽기에만 까닭").toHaveText("흐름은 매매만 계산");
  assertNoErrors();
});

test("거래 흐름 한도·실패: 첫 상한은 '오늘 조회 한도'(빈 칸·0 아님)와 목록 위 안내, 끝 상한 429도 같은 글, 그 밖의 실패는 '불러오지 못함'", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  let mode = "soft";
  await setup(page, {
    width: 1280,
    insights: (ids) => {
      if (mode === "hard") return failure(429, "RT_READ_BUDGET", { retryAt: "2026-11-20T00:00:00.000Z" });
      if (mode === "down") return failure(503, "STORAGE_UNAVAILABLE");
      return envelope({ items: ids.map((id) => ({ tradeKey: id, available: false, reason: "budget" })), missing: [], basis: { months: 12, recentMonths: 3 }, recordHighReady: true, warnings: [{ code: "RT_READ_BUDGET", level: "soft" }] });
    },
  });
  for (const next of ["soft", "hard", "down"]) {
    mode = next;
    await page.goto("/admin/work/realprice/");
    await expect(rows(page)).toHaveCount(30);
    const flow = rows(page).first().locator(".rt-flow");
    if (next === "down") {
      await expect(flow).toHaveText("흐름: 불러오지 못함");
      await expect(page.locator("[data-rt-notice-text]")).toHaveText("흐름·직전 거래를 불러오지 못했습니다. 목록은 그대로 볼 수 있습니다. 잠시 뒤 화면을 새로 고치면 다시 불러옵니다.");
    } else {
      await expect(flow, next).toHaveText("흐름: 오늘 조회 한도");
      await expect(page.locator("[data-rt-notice-text]"), next).toHaveText("오늘 조회가 많아 흐름·직전 거래 표시를 잠시 껐습니다. 한국 시각 오전 9시 뒤에 다시 보입니다. 목록은 그대로 볼 수 있습니다.");
    }
    await expect(rows(page).first().locator(".rt-ratio")).toHaveText("");
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(rows(page).first().locator(".rt-flowcell"), "카드에는 누를 것 없는 흐름 줄을 두지 않고 까닭은 목록 위 안내로").toBeHidden();
  await expect(page.locator("[data-rt-notice-text]")).toBeVisible();
  assertNoErrors();
});

test("거래 흐름 홍보물: 담은 매매 ID만 한 번 묻고, 흐름을 못 받아도 카드는 그대로 만든다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  let down = false;
  const calls = await setup(page, {
    trades: (params) => {
      const ids = (params.get("ids") ?? "").split(",");
      const items = [...firstPage, cancelledTrade].filter((item) => ids.includes(item.tradeKey));
      return envelope({ items, missing: [], receivedAt: "2026-11-19T03:10:00.000Z", recordHighReady: true, warnings: [] });
    },
    insights: (ids) => (down ? failure(503, "STORAGE_UNAVAILABLE") : defaultInsights(ids)),
  });
  const ids = [firstPage[0].tradeKey, firstPage[1].tradeKey, firstPage[3].tradeKey].join(",");
  for (const state of ["ok", "down"]) {
    down = state === "down";
    await page.goto(`/admin/work/realprice/promo/?ids=${ids}`);
    await expect(page.locator(".rt-promo__card img").first()).toHaveAttribute("src", /^data:image\/png;base64,/u);
    expect(calls.insights.at(-1), state).toBe([firstPage[0].tradeKey, firstPage[3].tradeKey].join(","));
  }
  assertNoErrors();
});
