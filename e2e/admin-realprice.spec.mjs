// 실거래가·실거래가 설정 화면(P1-d, TK-36·TK-37)을 가짜 업무 API로 본다. 단지명·금액·시각은 모두 지어낸 값이다.
// 979px 이하 B안·980px 이상 0안(사용자 시안 결정 2026-11-19 12:58:48), 1220px 이하 카드·1221px 이상 표.
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
const failure = (status, code, extra = {}) => ({ status, json: { ok: false, error: { code, message: "시험 오류", retryable: false, ...extra }, requestId: "test" } });

// 늘 같은 시각에서 보이게 시계를 고정하고, 실제 서버는 부르지 않는다(맞지 않는 관리 API는 503).
async function setup(page, { width = 390, session = { realpriceEnabled: true }, status = okStatus, trades, watch, complexes, put, refresh } = {}) {
  await page.clock.setFixedTime(NOW);
  await page.setViewportSize({ width, height: 900 });
  const calls = { trades: [], complexes: [], puts: [], refresh: [], session: 0, watchGets: 0 };
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

test("실거래가 979px 이하(B안): 상태 한 줄·거르기 접힘·세 줄 카드, 30건 더 보기, 키보드로 거르기·보기 바꾸기", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const calls = await setup(page);
  await page.goto("/admin/work/realprice/");
  await expect(rows(page)).toHaveCount(30);
  expect(calls.trades, "기본 거르기는 매개변수 없이(서버 기본 3개월·해제 빼기)").toEqual([""]);

  const sum = page.locator("[data-rt-sum]");
  await expect(sum).not.toHaveAttribute("open", /.*/u);
  await expect(page.locator(".rt-sum__line")).toHaveText("11. 19. 12:10 받음 · 11월분까지");
  await expect(page.locator(".rt-lead--short")).toBeVisible();
  await expect(page.locator(".rt-lead--full")).toBeHidden();
  const fold = page.locator("[data-rt-fold]");
  await expect(fold).not.toHaveAttribute("open", /.*/u);
  await expect(page.locator("[data-rt-fold-summary]")).toHaveText("최근 3개월 · 해제 빼기");
  await expect(page.locator("#rt-list-title")).toHaveText("새 거래 30건 · 계약일 최근순", { useInnerText: true });

  const first = rows(page).first();
  expect(await first.evaluate((row) => getComputedStyle(row).display), "1220px 이하는 카드").toBe("block");
  await expect(first.locator(".rt-tag--high")).toHaveText("신고가");
  await expect(first.locator(".rt-new .rt-tag")).toBeVisible();
  await expect(first.locator(".rt-flags .rt-only-table")).toBeHidden();
  await expect(first.locator(".rt-size")).toHaveText("84.97㎡ · 10층 · 103동");
  await expect(first.locator(".rt-price")).toContainText("4억 100만 원");
  await expect(first.locator(".rt-prev"), "앞선 최고는 카드에서 숨김").toBeHidden();
  await expect(rows(page).nth(1).locator(".rt-price")).toHaveText("보증금 2,000만 / 월 85만 원");
  await expect(rows(page).nth(1).locator(".rt-kind")).toHaveText("월세");
  await expect(rows(page).nth(2).locator(".rt-kind")).toHaveText("매매직거래");
  await expect(rows(page).nth(2).locator(".rt-size")).toContainText("지하 1층");
  await expect(page.locator(".rt-criterion--below")).toBeVisible();
  await expect(page.locator(".rt-criterion--above")).toBeHidden();

  await page.getByRole("button", { name: "30건 더 보기" }).click();
  await expect(rows(page)).toHaveCount(35);
  expect(calls.trades.at(-1)).toBe("cursor=c2");
  await expect(page.locator("[data-rt-more]")).toBeHidden();
  await expect(page.locator("#rt-list-title")).toHaveText("새 거래 35건 · 계약일 최근순", { useInnerText: true });

  // 키보드: 거르기 펼치기(Enter) → 해제 빼기 끄기(Space) → 해제 거래가 '해제' 글자와 함께 보임
  await fold.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(fold).toHaveAttribute("open", "");
  await expect(page.locator("[data-rt-fold-action]")).toHaveText("접기");
  await page.locator('[data-rt-filter="excludeCancelled"]').focus();
  await page.keyboard.press("Space");
  await expect(rows(page)).toHaveCount(31);
  expect(calls.trades.at(-1)).toBe("cancelled=include");
  await expect(rows(page).first().locator(".rt-tag--cancel")).toHaveText("해제");
  await expect(rows(page).first()).toHaveClass(/is-cancelled/u);
  await expect(page.locator("[data-rt-fold-summary]")).toHaveText("최근 3개월");
  await page.locator("#rt-kind").selectOption("sale");
  await expect.poll(() => calls.trades.at(-1)).toBe("kind=sale&cancelled=include");
  await page.getByRole("button", { name: "거르기 초기화" }).first().click();
  await expect.poll(() => calls.trades.at(-1)).toBe("");
  await expect(page.locator("[data-rt-reset]")).toBeDisabled();

  // 보기 바꾸기: 라디오에서 오른쪽 화살표 → 관심 단지
  await page.getByRole("radio", { name: "새 거래" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio", { name: "관심 단지" })).toBeChecked();
  await expect(page.locator("[data-rt-watch-names]")).toHaveText("관심 단지 2곳: 가상숲1단지 · 가상숲2단지");
  await expect.poll(() => calls.trades.at(-1)).toBe("watch=1");
  await expect(page.locator("#rt-list-title")).toHaveText("관심 단지 거래 30건 · 계약일 최근순", { useInnerText: true });

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

test("실거래가 980px 이상(0안): 상태 칸·거르기를 늘 펼치고 1221px 이상은 표, 1220px은 카드", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  await setup(page, { width: 1280 });
  await page.goto("/admin/work/realprice/");
  await expect(rows(page)).toHaveCount(30);
  await expect(page.locator("[data-rt-sum]")).toHaveAttribute("open", "");
  await expect(page.locator("[data-rt-sum] > summary")).toBeHidden();
  await expect(page.locator(".rt-status")).toBeVisible();
  await expect(page.locator("[data-rt-last]")).toHaveText("11월 19일 12:10");
  await expect(page.locator("[data-rt-badge]")).toHaveText("정상");
  await expect(page.locator("[data-rt-fold]")).toHaveAttribute("open", "");
  await expect(page.locator("[data-rt-fold] > summary")).toBeHidden();
  await expect(page.locator("#rt-kind")).toBeVisible();
  await expect(page.locator(".rt-lead--full")).toBeVisible();
  await expect(page.locator("#rt-mode-label")).toBeVisible();
  await expect(page.locator(".rt-criterion--above")).toBeVisible();
  await expect(page.locator(".rt-criterion--below")).toBeHidden();
  await expect(page.locator("#rt-list-title")).toHaveText("새 거래 30건 보는 중", { useInnerText: true });
  expect(await rows(page).first().evaluate((row) => getComputedStyle(row).display)).toBe("table-row");
  await expect(rows(page).first().locator(".rt-prev")).toHaveText("앞선 최고 3억 9,500만 원");
  await expect(rows(page).first().locator(".rt-flags .rt-tag--new")).toBeVisible();
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
  await page.setViewportSize({ width: 979, height: 900 });
  await expect(page.locator("[data-rt-fold]"), "979px로 줄이면 다시 접힘").not.toHaveAttribute("open", /.*/u);
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
      await expect(page.locator("#rt-list-title")).toHaveText("새 거래 0건 · 계약일 최근순", { useInnerText: true });
      await page.locator("[data-rt-fold] > summary").click();
      await page.locator("#rt-umd").selectOption("대동");
      await expect.poll(() => calls.trades.at(-1)).toBe(`umd=${encodeURIComponent("대동")}`);
      await page.locator("[data-rt-zero-reset]").click();
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
  await setup(page, {
    status: saleFilling,
    trades: () => envelope({ items: firstPage.map((item) => ({ ...item, recordHigh: null, prevMaxWon: null })), nextCursor: null, recordHighReady: false, coverage: {}, warnings: [] }),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/work/realprice/");
  await expect(rows(page)).toHaveCount(30);
  await expect(page.locator("[data-rt-sum]")).not.toHaveAttribute("open", "");
  await expect(page.locator("[data-rt-sum-fill]")).toHaveText("과거 자료 채우는 중 · 매매 79% · 신고가는 채운 뒤");
  await expect(page.locator("[data-rt-notice]")).toBeHidden();
  await expect(page.locator(".rt-tag--high")).toHaveCount(0);
  await expect(page.locator("[data-rt-criterion]:visible")).toHaveCount(0);
  const first = await rows(page).first().boundingBox();
  const tabbar = await page.locator(".admin-tabbar").boundingBox();
  expect(first.y + first.height, "매매를 채우는 동안에도 첫 거래 카드가 아래 탭 위에 다 보임").toBeLessThanOrEqual(tabbar.y);
  await page.locator("[data-rt-sum] > summary").click();
  await expect(page.locator("[data-rt-sum-high]")).toBeVisible();
  await expect(page.locator("[data-rt-sum-high]")).toHaveText("신고가 판정 준비 중(매매 과거 자료 채우는 중, 지금 2010년 4월까지). 과거 자료가 빠진 채 표시하면 신고가가 아닌 거래를 신고가로 보일 수 있어 다 채운 뒤 표시합니다.");
  await expect(page.locator("[data-rt-backfill]")).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.reload();
  await expect(rows(page)).toHaveCount(30);
  await expect(page.locator("[data-rt-notice]")).toBeVisible();
  await expect(page.locator("[data-rt-notice-text]")).toContainText("신고가 판정 준비 중(매매 과거 자료 채우는 중, 지금 2010년 4월까지)");
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
