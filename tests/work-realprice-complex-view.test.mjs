// 실거래가 단지 상세 칸 화면 순수 함수 시험(src/lib/work/realprice-complex-view.mjs). 숫자는 모두 가상이다.
import test from "node:test";
import assert from "node:assert/strict";
import {
  COMPLEX_APT_PATTERN,
  COMPLEX_MONTHS,
  COMPLEX_RECENT_MAX,
  areaTab,
  canOpenComplex,
  complexCacheKey,
  complexHead,
  complexQuery,
  flowNote,
  flowTicks,
  latestView,
  pickButtonState,
  recentRow,
  statsView,
} from "../src/lib/work/realprice-complex-view.mjs";
import { REALPRICE_COMPLEX_MONTHS, REALPRICE_COMPLEX_RECENT_MAX } from "../worker/realprice-complex.mjs";
import { APT_SEQ_PATTERN } from "../worker/realprice-query.mjs";

const area = (extra = {}) => ({
  areaM2: 84.97,
  tradeCount: 6,
  latest: { tradeKey: "sale:202611:00000000000000000001:1", dealDate: "2026-11-01", floor: 15, priceWon: 528_840_000, dealingGbn: "broker", recordHigh: true },
  prev: { dealDate: "2026-10-01", floor: 12, priceWon: 500_000_000 },
  prevMaxWon: 520_000_000,
  ratioPct: 101.7,
  ratioSkip: null,
  recent3m: 2,
  typeMaxWon: 528_840_000,
  typeMaxDate: "2026-11-01",
  bandM2: 84,
  bandMaxWon: 610_000_000,
  bandTypes: 2,
  series: [],
  recent: [],
  ...extra,
});

test("단지 상세 화면 상수는 서버와 같다", () => {
  assert.equal(COMPLEX_MONTHS, REALPRICE_COMPLEX_MONTHS);
  assert.equal(COMPLEX_RECENT_MAX, REALPRICE_COMPLEX_RECENT_MAX);
  assert.equal(COMPLEX_APT_PATTERN.source, APT_SEQ_PATTERN.source);
});

test("열 수 있는 거래·요청 글·메모리 열쇠: 단지 번호가 없거나 '*'이면 열지 않음", () => {
  assert.equal(canOpenComplex({ aptSeq: "30110-123" }), true);
  for (const aptSeq of [null, "", "*", "가나", "a".repeat(21)]) assert.equal(canOpenComplex({ aptSeq }), false, String(aptSeq));
  assert.equal(complexQuery("A1", 84.97), "apt=A1&area=84.97");
  assert.equal(complexQuery("A1", null), "apt=A1");
  assert.equal(complexQuery("*", 84), null);
  assert.equal(complexCacheKey("A1", 84.9), "A1|84.90");
  assert.equal(complexCacheKey("A1", null), "A1|");
});

test("머리: 자료에 없는 준공 연도·세대수는 빼고, 이름이 없으면 누른 거래 이름", () => {
  assert.deepEqual(complexHead({ aptName: "가상숲", umdName: "가상동", buildYear: 2020, households: 2135 }), { name: "가상숲", sub: "가상동 · 2020년 준공 · 2,135세대" });
  assert.deepEqual(complexHead({ aptName: "가상숲", umdName: "가상동", buildYear: null, households: null }), { name: "가상숲", sub: "가상동" });
  assert.deepEqual(complexHead(null, { aptName: "누른 단지", umdName: "천동" }), { name: "누른 단지", sub: "천동" });
  assert.equal(complexHead(null).name, "단지명 없음");
  // TK-145 구 이름(0008): 응답 lawdCd → 누른 거래의 lawdCd → 단지 고유번호 앞 5자리 차례로 찾는다.
  assert.equal(complexHead({ aptSeq: "30170-1", aptName: "가상", umdName: "갈마동", lawdCd: "30170", buildYear: 2020, households: null }).sub, "서구 · 갈마동 · 2020년 준공");
  assert.equal(complexHead({ aptSeq: "30200-9", aptName: "가상", umdName: "봉명동", buildYear: null, households: null }).sub, "유성구 · 봉명동");
  assert.equal(complexHead(null, { aptName: "누른 단지", umdName: "천동", lawdCd: "30110" }).sub, "동구 · 천동");
  assert.equal(complexHead(null, { aptName: "누른 단지", umdName: "중촌동", aptSeq: "30140-3" }).sub, "중구 · 중촌동");
});

test("면적 탭·최근 거래 머리: '평'을 쓰지 않고 전용면적 소수 둘째 자리, 직전보다 오른 폭", () => {
  assert.deepEqual(areaTab({ areaM2: 84.9, tradeCount: 1234 }), { label: "84.90㎡", count: "1,234건", areaM2: 84.9 });
  const view = latestView(area());
  assert.equal(view.price, "5억 2,884만 원");
  assert.equal(view.meta, "15층 · 2026. 11. 1. · 중개거래");
  assert.equal(view.high, true);
  assert.equal(view.prevLine, "직전 거래 2026. 10. 1. · 12층 · 5억 원");
  assert.equal(view.change, "직전보다 ▲ 2,884만");
  assert.doesNotMatch(JSON.stringify(view), /평/u);
  assert.equal(latestView(area({ prev: null })).prevLine, "직전 거래 없음(2006년 1월 이후)");
  assert.equal(latestView(area({ latest: null })), null);
});

test("숫자 칸: 최고가 대비(▲)·3개월·이 면적 최고·㎡대 최고(면적이 하나면 뺌)·최고 거래일, 직거래·첫 거래는 까닭", () => {
  const stats = statsView(area());
  assert.deepEqual(stats.map((stat) => [stat.label, stat.value]), [
    ["최고가 대비", "▲ 101.7%"],
    ["최근 3개월 거래", "2건"],
    ["이 면적 최고", "5억 2,884만 원"],
    ["84㎡대 최고", "6억 1,000만 원"],
    ["최고 거래일", "2026. 11. 1."],
  ]);
  assert.equal(stats[0].note, "앞선 최고 5억 2,000만 원");
  assert.equal(statsView(area({ bandTypes: 1 })).some((stat) => stat.key === "band"), false);
  assert.equal(statsView(area({ ratioPct: null, prevMaxWon: null, ratioSkip: "direct" }))[0].value, "직거래는 계산 안 함");
  assert.equal(statsView(area({ ratioPct: null, prevMaxWon: null }))[0].value, "첫 거래");
  assert.deepEqual(statsView(null), []);
});

test("최근 거래 줄: 해제·직거래·신고가·누른 거래 표시는 글자로", () => {
  const row = recentRow({ tradeKey: "k1", dealDate: "2026-11-01", floor: -1, priceWon: 400_000_000, dealingGbn: "direct", cancelled: true, recordHigh: false }, { picked: "k1" });
  assert.deepEqual([row.date, row.floor, row.price, row.tags.map((tag) => tag.text), row.current, row.cancelled], ["2026. 11. 1.", "지하 1층", "4억 원", ["해제", "직거래"], true, true]);
  assert.deepEqual(recentRow({ tradeKey: "k2", dealDate: "2026-11-01", floor: 3, priceWon: null, dealingGbn: "broker", cancelled: false, recordHigh: true }).tags.map((tag) => tag.text), ["신고가"]);
});

test("흐름 글·눈금·담기 단추 상태", () => {
  const series = Array.from({ length: 36 }, (_, index) => ({ ym: `20${24 + Math.floor((index + 11) / 12)}-${String(((index + 11) % 12) + 1).padStart(2, "0")}`, medianWon: index % 2 ? 100 : null, count: 0 }));
  assert.equal(flowNote(series), "최근 36개월 가운데 거래 있는 달 18개");
  assert.equal(flowNote([]), "흐름은 거래가 있는 달이 두 달 이상일 때 그립니다");
  assert.deepEqual(flowTicks(series).map((tick) => tick.text), ["24.12", "26.05", "27.11"]);
  assert.deepEqual(flowTicks([]), []);
  const latest = area().latest;
  assert.deepEqual(pickButtonState(latest, { has: false, count: 0, max: 6 }), { disabled: false, text: "홍보물에 담기", note: null });
  assert.deepEqual(pickButtonState(latest, { has: true, count: 6, max: 6 }), { disabled: false, text: "담음 · 빼기", note: null });
  assert.equal(pickButtonState(latest, { has: false, count: 6, max: 6 }).disabled, true);
  assert.equal(pickButtonState(null, { has: false, count: 0, max: 6 }).disabled, true);
});
