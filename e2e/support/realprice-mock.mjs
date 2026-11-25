// 실거래가·홍보물 시험(e2e/admin-realprice.spec.mjs)과 사용 안내 그림 찍기(e2e/help-shots/)가 함께 쓰는 가짜 업무 API와 칸 찾기.
// 2026-11-24 시험 파일에서 그대로 옮김. 단지명·금액·시각은 모두 지어낸 값이다.
import { readFileSync } from "node:fs";
import { expect } from "@playwright/test";

export const NOW = new Date("2026-11-19T05:00:00Z"); // 한국 14:00
export const WORK = "**/api/admin/v1/work";
export const okStatus = {
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

export function trade(index, extra = {}) {
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
export const firstPage = [
  trade(1, { recordHigh: true, prevMaxWon: 395_000_000, isNew: true, aptDong: "103" }),
  trade(2, { kind: "rent", priceWon: null, depositWon: 20_000_000, monthlyRentWon: 850_000, umdName: "신흥동" }),
  trade(3, { dealingGbn: "direct", floor: -1 }),
  ...Array.from({ length: 27 }, (_, index) => trade(index + 4)),
];
export const secondPage = Array.from({ length: 5 }, (_, index) => trade(index + 31));
export const cancelledTrade = trade(99, { cancelled: true, cancelledOn: "2026-11-15" });

export const envelope = (data) => ({ json: { ok: true, data, requestId: "test" } });
// 거래 흐름(보드 63번) 가짜 응답: 첫 거래는 앞선 최고 3억 9,500만(신고가 101.5%), 넷째 거래(가상숲4단지)는 첫 거래·한 달만, 나머지는 평범한 흐름.
export function insightOf(id) {
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
export const defaultInsights = (ids) => envelope({ items: ids.map(insightOf), missing: [], basis: { months: 12, recentMonths: 3 }, recordHighReady: true, warnings: [] });
// 단지 상세 칸(2026-11-25) 가짜 응답: 단지마다 면적 두 가지(59.92㎡·84.97㎡). 84.97㎡의 최근 거래는 목록의 그 단지 거래이고, 59.92㎡의 최근 거래는 목록에 없는 거래다.
export function complexOf(params) {
  const aptSeq = params.get("apt");
  const item = [...firstPage, ...secondPage].find((trade) => trade.aptSeq === aptSeq);
  const areaM2 = params.get("area") === "59.92" ? 59.92 : 84.97;
  const months = Array.from({ length: 36 }, (_, index) => {
    const at = 2023 * 12 + 11 + index;
    return `${Math.floor(at / 12)}-${String((at % 12) + 1).padStart(2, "0")}`;
  });
  const base = areaM2 === 84.97 ? 360_000_000 : 250_000_000;
  const series = months.map((ym, index) => ({ ym, medianWon: index % 4 === 2 ? null : base + Math.round(Math.sin(index / 4) * 12 + index) * 1_000_000, count: index % 4 === 2 ? 0 : 2 }));
  const latestKey = areaM2 === 84.97 && item ? item.tradeKey : `sale:202610:${String(800 + Number(aptSeq.slice(1))).padStart(20, "0")}:1`;
  const latestPrice = areaM2 === 84.97 && item?.priceWon ? item.priceWon : 268_000_000;
  const recent = [
    { tradeKey: latestKey, dealDate: areaM2 === 84.97 && item ? item.dealDate : "2026-10-21", floor: 10, priceWon: latestPrice, dealingGbn: "broker", cancelled: false, recordHigh: areaM2 === 84.97 && item?.recordHigh === true },
    { tradeKey: "sale:202610:00000000000000000901:1", dealDate: "2026-10-12", floor: 7, priceWon: latestPrice + 30_000_000, dealingGbn: "broker", cancelled: true, recordHigh: false },
    { tradeKey: "sale:202609:00000000000000000902:1", dealDate: "2026-09-03", floor: 3, priceWon: latestPrice - 20_000_000, dealingGbn: "direct", cancelled: false, recordHigh: false },
    ...Array.from({ length: 6 }, (_, index) => ({ tradeKey: `sale:202608:${String(910 + index).padStart(20, "0")}:1`, dealDate: `2026-0${8 - Math.floor(index / 2)}-${20 - index}`, floor: 4 + index, priceWon: latestPrice - (index + 1) * 4_000_000, dealingGbn: "broker", cancelled: false, recordHigh: false })),
  ];
  return {
    available: true,
    complex: { aptSeq, aptName: item?.aptName ?? "가상 단지", umdName: item?.umdName ?? "천동", buildYear: 2020, households: aptSeq === "A1" ? 2135 : null },
    areas: [{ areaM2: 59.92, tradeCount: 41, lastDealDate: "2026-10-21" }, { areaM2: 84.97, tradeCount: 128, lastDealDate: "2026-11-27" }],
    area: {
      areaM2,
      tradeCount: areaM2 === 84.97 ? 128 : 41,
      latest: { tradeKey: latestKey, dealDate: recent[0].dealDate, floor: 10, priceWon: latestPrice, dealingGbn: "broker", recordHigh: recent[0].recordHigh },
      prev: { dealDate: "2026-09-03", floor: 9, priceWon: latestPrice - 15_000_000 },
      prevMaxWon: latestPrice - 5_000_000,
      ratioPct: Math.round((latestPrice * 1000) / (latestPrice - 5_000_000)) / 10,
      ratioSkip: null,
      recent3m: 7,
      typeMaxWon: latestPrice,
      typeMaxDate: recent[0].dealDate,
      bandM2: Math.floor(areaM2),
      bandMaxWon: latestPrice + 12_000_000,
      bandTypes: 2,
      series,
      recent,
    },
    basis: { months: 36, recentMonths: 3, recentMax: 20 },
    recordHighReady: true,
    warnings: [],
  };
}
export const failure = (status, code, extra = {}) => ({ status, json: { ok: false, error: { code, message: "시험 오류", retryable: false, ...extra }, requestId: "test" } });

// 늘 같은 시각에서 보이게 시계를 고정하고, 실제 서버는 부르지 않는다(맞지 않는 관리 API는 503).
export async function setup(page, { width = 390, session = { realpriceEnabled: true }, status = okStatus, trades, watch, complexes, put, refresh, insights, complex } = {}) {
  await page.clock.setFixedTime(NOW);
  await page.setViewportSize({ width, height: 900 });
  const calls = { trades: [], complexes: [], puts: [], refresh: [], session: 0, watchGets: 0, insights: [], complex: [] };
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
  // 단지 상세(complex)는 complexes 찾기와 이름이 겹치므로 주소 끝으로 가른다.
  await page.route((url) => url.pathname.endsWith("/api/admin/v1/work/realprice/complex"), (route) => {
    const params = new URL(route.request().url()).searchParams;
    calls.complex.push(params.toString());
    return route.fulfill(complex ? complex(params, calls.complex.length) : envelope(complexOf(params)));
  });
  await page.route(`${WORK}/realprice/refresh`, (route) => {
    calls.refresh.push({ body: route.request().postDataJSON(), headers: route.request().headers() });
    return route.fulfill(refresh ?? envelope({ queuedMonths: 12, estimatedMinutes: 120 }));
  });
  return calls;
}

// 콘솔 오류 0건. 가짜 API가 일부러 돌려준 오류 응답(429·503)의 "Failed to load resource" 한 줄은 화면 오류가 아니므로 뺀다.
export function collectErrors(page) {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !/Failed to load resource/u.test(message.text())) errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return () => expect(errors, "브라우저 콘솔 오류가 없어야 합니다").toEqual([]);
}
export const overflowOf = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
export const rows = (page) => page.locator("[data-rt-rows] > tr");

// 누르는 곳 44px: 거르기 단추 6개·찾기·다 담기·첫 줄 담기 칸(찾기칸은 48px). 담기 칸은 글자 없는 체크칸이라 '담기 칸'으로 부른다.
export const tapSizes = (page) => page.evaluate(() => [...document.querySelectorAll(".rt-chip, .rt-find__go, .rt-take, [data-rt-rows] > tr:first-child .rt-pick-button")]
  .filter((element) => element.getClientRects().length > 0)
  .map((element) => { const box = element.getBoundingClientRect(); return { name: (element.querySelector("[data-rt-chip-text]") ?? element).textContent.trim() || "담기 칸", width: box.width, height: box.height }; }));
// 담기 체크칸이 보이는 모양: 담음 "✓"(남색 네모 안 흰 ✓), 빈칸, 잠김(해제·다 참). 진짜 체크 칸 상태와 보이는 네모가 같아야 한다.
export const pickState = (row) => row.locator(".rt-pick-button").evaluate((label) => {
  const input = label.querySelector("input");
  const tick = getComputedStyle(label.querySelector(".rt-pick-mark"), "::before").content.includes("✓");
  if (input.checked) return tick ? "✓" : "어긋남";
  if (tick) return "어긋남";
  return input.disabled ? "잠김" : "빈칸";
});
// 운영과 같은 CSP를 홍보물 화면에 붙여(시험 서버는 헤더를 보내지 않음) data 주소 그림·내려받기가 막히지 않는지 본다.
export const PRODUCTION_CSP = /^\s*Content-Security-Policy: (.+)$/mu.exec(readFileSync(new URL("../../public/_headers", import.meta.url), "utf8"))[1];
export const promoItems = [
  trade(1, { recordHigh: true, prevMaxWon: 395_000_000, aptDong: "103" }),
  trade(2, { kind: "rent", priceWon: null, depositWon: 20_000_000, monthlyRentWon: 850_000, umdName: "신흥동", tradeKey: "rent:202611:00000000000000000002:1" }),
  trade(3, { floor: -1 }),
];
export const promoAnswer = (over = {}) => envelope({ items: promoItems, missing: [], receivedAt: "2026-11-19T03:10:00Z", recordHighReady: true, warnings: [], ...over });
export const idsOf = (items) => items.map((item) => item.tradeKey).join(",");
export async function withProductionCsp(page) {
  const violations = [];
  await page.route("**/admin/work/realprice/promo/**", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), "content-security-policy": PRODUCTION_CSP } });
  });
  await page.exposeFunction("__cspViolation", (text) => violations.push(text));
  await page.addInitScript(() => document.addEventListener("securitypolicyviolation", (event) => window.__cspViolation(`${event.violatedDirective} ${event.blockedURI}`)));
  return violations;
}
export const pngSize = (bytes) => ({ width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), signature: bytes.subarray(1, 4).toString("ascii") });
