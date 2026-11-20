// 실거래가 거래 흐름(보드 63번) 화면 순수 함수 시험: 서버 상수 대조, 흐름선 좌표, 직전·최고가 대비 글자, 읽을 ID 묶음, 홍보물 칸·기준 줄.
// 단지 이름·숫자는 모두 가상이다.
import test from "node:test";
import assert from "node:assert/strict";
import {
  INSIGHT_IDS_MAX,
  INSIGHT_MONTHS,
  INSIGHT_REASON_TEXT,
  insightBatches,
  insightView,
  isInsightCandidate,
  promoBasisLine,
  promoFlow,
  sparkGeometry,
} from "../src/lib/work/realprice-insight-view.mjs";
import { promoCards } from "../src/lib/work/realprice-promo.mjs";
import { REALPRICE_INSIGHT_IDS_MAX, REALPRICE_INSIGHT_MONTHS } from "../worker/realprice-insights.mjs";
import { REALPRICE_START_MONTHS } from "../worker/realprice-store.mjs";

const series = (values) => values.map((won, index) => ({ ym: `2026-${String(index + 1).padStart(2, "0")}`, medianWon: won, count: won === null ? 0 : 1 }));
const SAMPLE = {
  tradeKey: "sale:202611:00000000000000000001:1",
  available: true,
  series: series([null, 400_000_000, null, 410_000_000, 405_000_000, null, null, null, null, null, 412_000_000, 420_000_000]),
  prev: { dealDate: "2026-11-05", floor: 10, priceWon: 412_000_000 },
  prevMaxWon: 413_000_000,
  ratioPct: 101.7,
  recent3m: 4,
  households: 2135,
};

test("63 화면 상수는 서버 값과 같다(ID 30개·12개월·비교 시작 2006년 1월)", () => {
  assert.equal(INSIGHT_IDS_MAX, REALPRICE_INSIGHT_IDS_MAX);
  assert.equal(INSIGHT_MONTHS, REALPRICE_INSIGHT_MONTHS);
  assert.equal(REALPRICE_START_MONTHS.sale, "200601");
  assert.match(insightView({ ...SAMPLE, prev: null }).prevLine, /2006년 1월 이후/u);
});

test("63 흐름선: 거래 있는 달만 잇고 x는 12칸 자리, 두 달 미만이면 null, 점선은 실제 최고 금액 높이", () => {
  const geo = sparkGeometry(SAMPLE.series, { width: 115, height: 40, padX: 5, padTop: 5, padBottom: 5, maxWon: 430_000_000, prevYm: "2026-11" });
  assert.ok(geo);
  assert.equal(geo.months, 5);
  assert.equal(geo.line.split(/[ML]/u).filter(Boolean).length, 5, "빈 달은 건너뜀");
  assert.equal(geo.line.split(" ")[0], "M14.5,35", "첫 점은 2월 자리(x = 5 + 1 × 105 / 11), 가장 낮은 값은 바닥");
  assert.deepEqual(geo.end, { ym: "2026-12", x: 110, y: 15 });
  assert.equal(geo.maxY, 5, "점선(앞선 최고 4억 3천)이 가장 위");
  assert.deepEqual(geo.prev, { ym: "2026-11", x: 100.5, y: 23 });
  assert.equal(sparkGeometry(series([null, 1, null, null, null, null, null, null, null, null, null, null]), { width: 100, height: 30 }), null);
  const flat = sparkGeometry(series([5, 5, null, null, null, null, null, null, null, null, null, null]), { width: 100, height: 30, padTop: 4, padBottom: 4 });
  assert.equal(flat?.end.y, 15, "값이 모두 같으면 가운데 높이");
});

test("63 글자: 신고가 비율은 ▲와 함께, 첫 거래·직전 없음은 빈 칸이 아니라 뜻을 쓰고, 계산하지 않은 까닭은 한국어 글자", () => {
  const view = insightView(SAMPLE, { high: true });
  assert.deepEqual([view.ratioText, view.maxText, view.prevPrice, view.prevSub, view.recentText, view.households], ["▲ 101.7%", "4억 1,300만 원", "4억 1,200만 원", "11. 5. · 10층", "4건", 2135]);
  assert.equal(view.prevLine, "직전 거래 2026. 11. 5. · 10층 · 4억 1,200만 원");
  assert.equal(view.summary, "흐름·직전 거래 · 대비 ▲ 101.7%");
  assert.equal(insightView({ ...SAMPLE, ratioPct: 89 }).ratioText, "89.0%");
  const first = insightView({ ...SAMPLE, prev: null, prevMaxWon: null, ratioPct: null, series: series([null, null, null, null, null, null, null, null, null, null, null, 300_000_000]), households: null });
  assert.deepEqual([first.ratioText, first.maxText, first.prevPrice, first.chartNote, first.summary, first.households], ["첫 거래", null, null, "흐름선은 거래가 있는 달이 두 달 이상일 때 그립니다", "흐름·직전 거래", null]);
  for (const reason of Object.keys(INSIGHT_REASON_TEXT)) {
    assert.deepEqual(insightView({ tradeKey: "x", available: false, reason }), { available: false, reason, reasonText: INSIGHT_REASON_TEXT[reason] });
  }
  assert.equal(insightView(undefined).reasonText, "불러오지 못함");
  assert.equal(insightView({ available: false, reason: "budget" }).reasonText, "오늘 조회 한도");
});

test("63 읽을 ID: 매매·해제 아님·직거래 아님만, 이미 받은 ID는 빼고, 같은 ID는 한 번, 30개씩", () => {
  const items = Array.from({ length: 65 }, (_, index) => ({ tradeKey: `sale:202611:${String(index).padStart(20, "0")}:1`, kind: "sale", cancelled: false, dealingGbn: "broker" }));
  items.push({ tradeKey: "rent:x", kind: "rent", cancelled: false }, { tradeKey: "c", kind: "sale", cancelled: true }, { tradeKey: "d", kind: "sale", cancelled: false, dealingGbn: "direct" }, items[0]);
  assert.equal(isInsightCandidate({ kind: "sale", cancelled: false, dealingGbn: null }), true, "중개 구분 없는 옛 자료도 물음");
  const batches = insightBatches(items, new Map([[items[1].tradeKey, {}]]));
  assert.deepEqual(batches.map((batch) => batch.length), [30, 30, 4]);
  assert.equal(batches.flat().includes(items[1].tradeKey), false);
  assert.equal(batches.flat().some((key) => ["rent:x", "c", "d"].includes(key)), false);
});

test("63 홍보물: 칸은 값이 있는 것만(앞선 최고 없으면 최고가 대비도 뺌), 기준 줄은 실제로 그린 항목만", () => {
  const flow = promoFlow(SAMPLE, { high: true, buildYear: 2020 });
  assert.deepEqual(flow?.stats, [{ label: "앞선 최고", value: "4억 1,300만" }, { label: "최고가 대비", value: "▲ 101.7%" }, { label: "최근 3개월", value: "4건" }]);
  assert.deepEqual(flow?.sub, ["2020년 준공", "2,135세대"]);
  assert.equal(flow?.strip, "직전 4억 1,200만 · 최고가 대비 ▲ 101.7% · 3개월 4건");
  assert.equal(promoBasisLine([flow]), "같은 단지·같은 전용면적 · 흐름선: 12개월 월별 가운데 값 · 최고·직전: 실제 거래");
  const first = promoFlow({ ...SAMPLE, prev: null, prevMaxWon: null, ratioPct: null, households: null, series: series([null, null, null, null, null, null, null, null, null, null, null, 300_000_000]) }, { buildYear: null });
  assert.deepEqual([first?.stats, first?.sub, first?.prevLine, first?.chart, first?.strip], [[{ label: "최근 3개월", value: "4건" }], [], "", false, "3개월 4건"]);
  assert.equal(promoBasisLine([first]), "같은 단지·같은 전용면적 · 최근 3개월: 계약일 기준 거래 수");
  assert.equal(promoFlow({ available: false, reason: "budget" }), null);
  assert.equal(promoBasisLine([null, null]), "");
});

test("63 홍보물 카드 자료: 흐름을 받은 매매만 flow, 못 받은 거래는 지금 모양(flow null)이고 기준 줄은 빈 글자", () => {
  const office = { legalName: "가상공인중개사사무소", representative: "가상", address: "대전광역시 동구 가상로 1", mobile: "010-0000-0000", registrationNumber: "00000-0000-00000" };
  const sale = { tradeKey: SAMPLE.tradeKey, kind: "sale", dealDate: "2026-11-18", umdName: "가상동", aptName: "가상숲1단지", areaM2: 84.97, floor: 14, buildYear: 2020, priceWon: 420_000_000, depositWon: null, monthlyRentWon: null, cancelled: false, recordHigh: true, prevMaxWon: 413_000_000 };
  const rent = { ...sale, tradeKey: "rent:202611:00000000000000000002:1", kind: "rent", priceWon: null, depositWon: 200_000_000, recordHigh: null, prevMaxWon: null };
  const input = { items: [sale, rent], receivedAt: "2026-11-20T03:10:00.000Z", office };
  const plain = promoCards(input)[0];
  assert.deepEqual([plain.items.map((item) => item.flow), plain.basis], [[null, null], ""]);
  const withFlow = promoCards({ ...input, insights: { [SAMPLE.tradeKey]: SAMPLE, [rent.tradeKey]: { tradeKey: rent.tradeKey, available: false, reason: "not_sale" } } })[0];
  assert.equal(withFlow.items[0].flow?.strip, "직전 4억 1,200만 · 최고가 대비 ▲ 101.7% · 3개월 4건");
  assert.equal(withFlow.items[1].flow, null);
  assert.match(withFlow.basis, /^같은 단지·같은 전용면적 · 흐름선/u);
});
