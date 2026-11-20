// 실거래가·실거래가 설정 화면(P1-d)의 순수 함수(src/lib/work/realprice-view.mjs). 서버 상수와 같은 값인지도 확인한다.
import assert from "node:assert/strict";
import test from "node:test";
import {
  REALPRICE_COMPLEX_QUERY_MAX,
  REALPRICE_MAJOR_DAYS,
  REALPRICE_MAJOR_TOP,
  REALPRICE_RANGE_DEFAULT_MONTHS,
  REALPRICE_TRADES_LIMIT_MAX,
  REALPRICE_RANGE_MAX_MONTHS,
  REALPRICE_TRADES_LIMIT_DEFAULT,
  REALPRICE_WATCH_MAX,
  REALPRICE_WATCH_NAME_MAX,
} from "../worker/realprice-query.mjs";
import { REALPRICE_DAILY_READ_HARD } from "../worker/realprice-store.mjs";
import {
  DEFAULT_REALPRICE_FILTERS,
  DONG_GU_UMD_NAMES,
  REALPRICE_PERIODS,
  REALPRICE_VIEW_HIGH_PAGE_SIZE,
  REALPRICE_VIEW_MAJOR_DAYS,
  REALPRICE_VIEW_MAJOR_TOP,
  REALPRICE_VIEW_NAME_MAX,
  REALPRICE_VIEW_PAGE_SIZE,
  REALPRICE_VIEW_QUERY_MAX,
  REALPRICE_VIEW_WATCH_MAX,
  activeFilterLine,
  apiErrorText,
  backfillBars,
  chipText,
  backfillLine,
  cleanComplexQuery,
  dateText,
  emptyView,
  filterSummary,
  isDefaultFilters,
  kindLabel,
  kstLong,
  kstShort,
  priceParts,
  refreshDoneView,
  rowsText,
  runOutcome,
  seedWords,
  sizeText,
  statusProblem,
  statusView,
  tradesQuery,
  usageView,
  watchPutItems,
} from "../src/lib/work/realprice-view.mjs";

const NOW = Date.parse("2026-11-19T05:00:00Z"); // 한국 14:00
const TODAY = "2026-11-19";
const full = (total) => ({ done: total, total });
const readyStatus = {
  lastSuccessAt: "2026-11-19T03:10:00Z",
  coveredThrough: "2026-11",
  backfill: { sale: full(251), presale: full(234), rent: full(191) },
  recordHighReady: true,
  lastError: null,
  warnings: [],
};

test("화면 상수는 서버 상수와 같다(한 번에 30건, 관심 단지 20곳·이름 40자, 검색어 30자, 기간 3 ~ 36개월)", () => {
  assert.equal(REALPRICE_VIEW_PAGE_SIZE, REALPRICE_TRADES_LIMIT_DEFAULT);
  assert.equal(REALPRICE_VIEW_WATCH_MAX, REALPRICE_WATCH_MAX);
  assert.equal(REALPRICE_VIEW_NAME_MAX, REALPRICE_WATCH_NAME_MAX);
  assert.equal(REALPRICE_VIEW_QUERY_MAX, REALPRICE_COMPLEX_QUERY_MAX);
  assert.equal(DEFAULT_REALPRICE_FILTERS.period, String(REALPRICE_RANGE_DEFAULT_MONTHS), "기본 기간 = 서버 기본(시작 달을 보내지 않음)");
  assert.equal(Math.max(...REALPRICE_PERIODS.map((period) => period.months)), REALPRICE_RANGE_MAX_MONTHS, "가장 긴 기간 = 서버 상한");
  assert.equal(DONG_GU_UMD_NAMES.length, 45, "대전 동구 법정동 45개");
  assert.equal(new Set(DONG_GU_UMD_NAMES).size, 45);
});

test("거르기 → 목록 요청 매개변수: 기본값은 아무것도 보내지 않고, 끝 달(to)은 보내지 않는다", () => {
  assert.equal(tradesQuery({ ...DEFAULT_REALPRICE_FILTERS }, { todayKst: TODAY }), "");
  assert.equal(
    tradesQuery(
      { ...DEFAULT_REALPRICE_FILTERS, period: "12", kind: "rent", area: "middle", price: "to5", umd: "천동", excludeCancelled: false, excludeDirect: true },
      { watch: true, cursor: "abc", todayKst: TODAY },
    ),
    `from=2025-12&kind=rent&watch=1&areaMin=60.01&areaMax=85&priceMin=300000001&priceMax=500000000&umd=${encodeURIComponent("천동")}&cancelled=include&direct=exclude&cursor=abc`,
  );
  assert.equal(tradesQuery({ ...DEFAULT_REALPRICE_FILTERS, period: "1" }, { todayKst: "2026-01-05" }), "from=2026-01", "최근 1개월 = 이번 달");
  assert.equal(tradesQuery({ ...DEFAULT_REALPRICE_FILTERS, period: "36" }, { todayKst: TODAY }), "from=2023-12", "최근 3년 = 36개월");
  assert.equal(tradesQuery({ ...DEFAULT_REALPRICE_FILTERS, umd: "없는동" }, { todayKst: TODAY }), "", "목록에 없는 법정동은 보내지 않음");
  assert.ok(!tradesQuery({ ...DEFAULT_REALPRICE_FILTERS, period: "6" }, { todayKst: TODAY }).includes("to="));
});

test("접힌 거르기 줄은 기간·해제 빼기와 바꾼 조건을 글자로 보인다", () => {
  assert.equal(filterSummary(DEFAULT_REALPRICE_FILTERS), "최근 3개월 · 해제 빼기");
  assert.equal(
    filterSummary({ ...DEFAULT_REALPRICE_FILTERS, kind: "presale", umd: "대동", price: "over7", excludeCancelled: false, excludeDirect: true }),
    "최근 3개월 · 분양권 · 7억 초과 · 대동 · 직거래 빼기",
  );
  assert.equal(isDefaultFilters({ ...DEFAULT_REALPRICE_FILTERS }), true);
  assert.equal(isDefaultFilters({ ...DEFAULT_REALPRICE_FILTERS, excludeCancelled: false }), false);
});

test("거래 한 줄: 한글 금액 단위, 월세는 두 값, 지하층·동 번호", () => {
  assert.deepEqual(priceParts({ kind: "sale", priceWon: 520_000_000 }), { main: "5억 2,000만 원", monthly: null });
  assert.deepEqual(priceParts({ kind: "presale", priceWon: 643_000_000 }), { main: "6억 4,300만 원", monthly: null });
  assert.deepEqual(priceParts({ kind: "rent", depositWon: 310_000_000, monthlyRentWon: 0 }), { main: "보증금 3억 1,000만 원", monthly: null });
  assert.deepEqual(priceParts({ kind: "rent", depositWon: 20_000_000, monthlyRentWon: 850_000 }), { main: "보증금 2,000만", monthly: "/ 월 85만 원" });
  assert.equal(kindLabel({ kind: "sale" }), "매매");
  assert.equal(kindLabel({ kind: "presale" }), "분양권");
  assert.equal(kindLabel({ kind: "rent", monthlyRentWon: 0 }), "전세");
  assert.equal(kindLabel({ kind: "rent", monthlyRentWon: 850_000 }), "월세");
  assert.equal(sizeText({ areaM2: 84.97, floor: 15, aptDong: "103" }), "84.97㎡ · 15층 · 103동");
  assert.equal(sizeText({ areaM2: 59.9, floor: 3, aptDong: "103동" }), "59.90㎡ · 3층 · 103동", "동이 두 번 붙지 않음");
  assert.equal(sizeText({ areaM2: 59.9, floor: -1, aptDong: null }), "59.90㎡ · 지하 1층");
  assert.equal(dateText("2026-11-05"), "2026. 11. 5.");
  assert.equal(kstShort("2026-11-19T03:10:00Z"), "11. 19. 12:10", "한국 시각");
  assert.equal(kstLong("2026-11-19T15:05:00Z"), "11월 20일 00:05", "한국 날짜가 넘어감");
});

test("자료 받기 상태: 정상·받기 전·처음 채우는 중·받기 멈춤·확인 필요", () => {
  const ready = statusView(readyStatus, { nowMs: NOW, todayKst: TODAY });
  assert.deepEqual(ready.badge, { tone: "ready", text: "정상" });
  assert.equal(ready.line, "11. 19. 12:10 받음 · 11월분까지");
  assert.equal(ready.range, "2026년 11월분까지(과거는 2006년 1월부터)");
  assert.equal(ready.problem, null);

  const empty = statusView({ ...readyStatus, lastSuccessAt: null, coveredThrough: null, recordHighReady: false, backfill: { sale: { done: 0, total: 251 }, presale: { done: 0, total: 234 }, rent: { done: 0, total: 191 } } }, { nowMs: NOW, todayKst: TODAY });
  assert.equal(empty.empty, true);
  assert.deepEqual(empty.badge, { tone: "checking", text: "처음 채우기 대기 0%" });
  assert.equal(empty.line, "아직 받은 자료 없음");

  const filling = { ...readyStatus, coveredThrough: "2010-04", recordHighReady: false, backfill: { sale: { done: 200, total: 251 }, presale: { done: 0, total: 234 }, rent: { done: 0, total: 191 } } };
  assert.deepEqual(statusView(filling, { nowMs: NOW, todayKst: TODAY }).badge, { tone: "checking", text: "처음 채우는 중 29%" });
  assert.deepEqual(backfillBars(filling).map((bar) => [bar.label, bar.percent, bar.note]), [
    ["매매", 79, "지금 2010년 4월까지"],
    ["분양권", 0, "매매를 다 채운 뒤 시작"],
    ["전월세", 0, "분양권 다음"],
  ], "채우는 순서: 매매 → 분양권 → 전월세");
  const fillingView = statusView(filling, { nowMs: NOW, todayKst: TODAY });
  assert.equal(fillingView.fill, "과거 자료 채우는 중 · 매매 79% · 신고가는 채운 뒤", "휴대폰 한 줄: 지금 채우는 종류만, 매매를 채우는 동안은 신고가 준비 중도 함께(TR-11 52.4-1)");
  assert.equal(fillingView.fillHigh, true, "목록 위 신고가 준비 안내는 979px 이하에서 이 줄로 옮김");
  // 매매를 다 채웠으면 서버가 recordHighReady: true를 준다(worker/realprice-store.mjs).
  const saleDone = { ...filling, recordHighReady: true };
  assert.equal(backfillLine({ ...saleDone, backfill: { sale: full(251), presale: full(234), rent: { done: 150, total: 191 } } }), "과거 자료 채우는 중 · 전월세 78%", "다 채운 종류는 뺌");
  assert.equal(backfillLine({ ...saleDone, backfill: { sale: full(251), presale: { done: 0, total: 234 }, rent: { done: 0, total: 191 } } }), "과거 자료 채우는 중 · 분양권 0%", "다음 차례가 아직 0이면 그 종류");
  assert.equal(backfillLine({ ...saleDone, backfill: { sale: full(251), presale: { done: 10, total: 234 }, rent: { done: 40, total: 191 } } }), "과거 자료 채우는 중 · 분양권 4% · 전월세 20%", "둘이 함께 채워지면 둘 다");
  assert.equal(statusView({ ...saleDone, backfill: { sale: full(251), presale: full(234), rent: { done: 150, total: 191 } } }, { nowMs: NOW, todayKst: TODAY }).fillHigh, false, "매매를 다 채웠으면 목록 위 안내도 없음");
  assert.equal(empty.fill, "과거 자료 채우기 대기 · 매매 0%", "받은 자료가 없으면 목록이 없으므로 신고가 글자를 붙이지 않음");
  assert.equal(empty.fillHigh, false);
  assert.equal(ready.fill, "", "다 채우면 한 줄 없음");
  assert.equal(ready.fillHigh, false);
  assert.equal(backfillLine({ backfill: { sale: { done: 0, total: 0 }, presale: { done: 0, total: 0 }, rent: { done: 0, total: 0 } } }), "", "받을 달 수를 모르면 없음");

  const stopped = { ...readyStatus, lastSuccessAt: "2026-11-17T00:40:00Z", lastError: { code: "RT_KEY_EXPIRED", at: "2026-11-17T01:00:00Z" } };
  const stopView = statusView(stopped, { nowMs: NOW, todayKst: TODAY });
  assert.deepEqual(stopView.badge, { tone: "warning", text: "멈춤" });
  assert.equal(stopView.line, "11. 17. 09:40까지 받은 자료(2일 전)");
  assert.equal(stopView.problem.label, "인증키 연장 필요");
  assert.equal(statusProblem({ ...stopped, lastSuccessAt: "2026-11-17T02:00:00Z" }), null, "멈춘 뒤 다시 받았으면 알리지 않음");
  assert.equal(statusProblem({ ...readyStatus, lastError: { code: "RT_UPSTREAM_FAILED", at: "2026-11-19T04:00:00Z" } }), null, "일시 오류는 다음 차례에 저절로 다시 받음");

  assert.equal(statusProblem({ ...readyStatus, warnings: [{ code: "RT_READ_BUDGET", level: "soft" }, { code: "RT_READ_BUDGET_NEAR" }] }), null, "읽기 첫 상한·가까움은 목록 알림으로만");
  const counted = statusView({ ...readyStatus, warnings: [{ code: "RT_COUNT_DIFF", count: 1 }] }, { nowMs: NOW, todayKst: TODAY });
  assert.deepEqual(counted.badge, { tone: "warning", text: "확인 필요" });
  assert.equal(counted.problem.stop, false);
});

test("관심 단지 저장 본문: 받은 complexSlug를 그대로 돌려보내고 공개 목록에 없는 것만 비운다(①안)", () => {
  const current = [
    { aptSeq: "A1", displayName: "가상숲1단지", complexSlug: "leaders-city-4" },
    { aptSeq: "A2", displayName: "가상숲2단지", complexSlug: "retired-slug" },
    { aptSeq: "A3", displayName: "가상강변마을", complexSlug: null },
  ];
  const published = ["leaders-city-4", "sinheung-sk-view"];
  const added = watchPutItems(current, { add: { aptSeq: "B1", aptName: "  가상언덕마을  ", suggestedSlug: "sinheung-sk-view" } }, published);
  assert.deepEqual(added.items, [
    { aptSeq: "A1", displayName: "가상숲1단지", complexSlug: "leaders-city-4" },
    { aptSeq: "A2", displayName: "가상숲2단지", complexSlug: null },
    { aptSeq: "A3", displayName: "가상강변마을", complexSlug: null },
    { aptSeq: "B1", displayName: "가상언덕마을", complexSlug: "sinheung-sk-view" },
  ]);
  assert.equal(added.droppedSlugs, 1);
  assert.deepEqual(watchPutItems(current, { removeAptSeq: "A1" }, published).items.map((item) => item.aptSeq), ["A2", "A3"]);
  assert.equal(watchPutItems(current, { add: { aptSeq: "A1", aptName: "겹침" } }, published).items.length, 3, "이미 있는 단지는 두 번 넣지 않음");
  const long = watchPutItems([], { add: { aptSeq: "C1", aptName: "가".repeat(60), suggestedSlug: "not-published" } }, published).items[0];
  assert.equal(long.displayName.length, REALPRICE_VIEW_NAME_MAX, "서버 이름 한도로 자름");
  assert.equal(long.complexSlug, null, "공개 단지가 아닌 추천은 넣지 않음");
});

test("검색어 단추는 공개 단지 이름의 첫 낱말이고, 단지 찾기 검색어는 1 ~ 30자", () => {
  assert.deepEqual(seedWords([{ name: "리더스시티 4블록" }, { name: "리더스시티 5블록" }, { name: "신흥 SK뷰" }]), ["리더스시티", "신흥"]);
  assert.equal(cleanComplexQuery("  리더스 "), "리더스");
  assert.equal(cleanComplexQuery("   "), null);
  assert.equal(cleanComplexQuery("가".repeat(31)), null);
});

test("오류 문장과 설정 화면 숫자", () => {
  assert.equal(apiErrorText("RT_READ_BUDGET", { retryAt: "2026-11-20T00:00:00.000Z" }), "오늘 실거래가 조회 한도를 넘었습니다. 11월 20일 09:00 이후 다시 보세요. 받아 둔 자료는 그대로 있습니다.");
  assert.match(apiErrorText("VERSION_CONFLICT"), /이번 변경은 저장하지 않았습니다/u);
  assert.equal(apiErrorText("UNKNOWN_CODE"), "요청을 처리하지 못했습니다. 잠시 뒤 다시 해 주세요.");
  for (const code of ["REALPRICE_DISABLED", "REALPRICE_CONFIG_MISSING", "AUTH_REQUIRED", "CSRF_INVALID", "STORAGE_UNAVAILABLE"]) {
    assert.notEqual(apiErrorText(code), apiErrorText("UNKNOWN_CODE"), code);
  }
  assert.deepEqual([rowsText(1284), rowsText(15_400), rowsText(380_000), rowsText(1_500_000)], ["1,284행", "1.5만 행", "38만 행", "150만 행"]);
  assert.deepEqual(usageView({ today: { apiCalls: 142, rowsWritten: 1284, writeBudget: 40_000, rowsRead: 380_000, readSoftLimit: 1_500_000 }, unmatchedSaleRows: 12 }), {
    calls: "142회",
    writes: "1,284행 / 예산 4만 행",
    reads: "38만 행 / 첫 상한 150만 행",
    unmatched: "12건",
  });
  assert.deepEqual(runOutcome({ outcome: "ok" }), { tone: "ready", text: "정상" });
  assert.deepEqual(runOutcome({ outcome: "partial", errorCode: "RT_WRITE_BUDGET" }), { tone: "warning", text: "일부만 · 오늘 쓰기 예산 다 씀" });
  assert.deepEqual(runOutcome({ outcome: "failed", errorCode: "RT_KEY_EXPIRED" }), { tone: "warning", text: "실패 · 인증키 연장 필요" });
  assert.deepEqual(runOutcome({ outcome: "failed", errorCode: "RT_UPSTREAM_FAILED" }), { tone: "warning", text: "실패" });
});

test("지금 다시 받기 알림(TK-29): 끝 상한을 넘은 날은 Cron이 한국 09시(UTC 0시)까지 받지 않으므로 '약 2시간 안에'라고 쓰지 않는다", () => {
  const queued = { queuedMonths: 12, estimatedMinutes: 120 };
  const usageOf = (rowsRead) => ({ today: { rowsRead, readSoftLimit: 1_500_000, readHardLimit: REALPRICE_DAILY_READ_HARD } });
  assert.deepEqual(refreshDoneView(queued, usageOf(REALPRICE_DAILY_READ_HARD - 1), { nowMs: NOW, statusAtMs: NOW }), {
    notice: "다시 받기를 차례에 넣었습니다. 최근 자료 12건(4개월 × 3종류)을 약 2시간 안에 모두 다시 받습니다. 그동안 목록은 지금 자료로 볼 수 있습니다.",
    button: "다시 받는 중(약 2시간)",
  }, "평소 날");
  assert.deepEqual(refreshDoneView(queued, usageOf(REALPRICE_DAILY_READ_HARD), { nowMs: NOW, statusAtMs: NOW }), {
    notice: "다시 받기를 차례에 넣었습니다. 하루 조회 한도를 넘어 한국 시각 내일 오전 9시부터 다시 받습니다. 최근 자료 12건(4개월 × 3종류)은 그 뒤 약 2시간 안에 모두 받습니다. 목록과 단지 찾기도 오전 9시부터 다시 볼 수 있습니다.",
    button: "오전 9시부터 다시 받음",
  }, "끝 상한 날 한국 14시 → 내일 09시");
  const kst0800 = Date.parse("2026-11-18T23:00:00Z");
  assert.match(refreshDoneView(queued, usageOf(REALPRICE_DAILY_READ_HARD + 5), { nowMs: kst0800, statusAtMs: kst0800 }).notice, /한국 시각 오늘 오전 9시부터/u, "한국 08시 → 오늘 09시");
  assert.equal(refreshDoneView(queued, usageOf(REALPRICE_DAILY_READ_HARD), { nowMs: Date.parse("2026-11-19T00:10:00Z"), statusAtMs: Date.parse("2026-11-18T23:50:00Z") }).button, "다시 받는 중(약 2시간)", "화면을 연 뒤 UTC 날이 바뀌었으면 한도가 풀려 평소 문장");
  assert.equal(refreshDoneView(queued, null, { nowMs: NOW, statusAtMs: NOW }).button, "다시 받는 중(약 2시간)", "상태를 모르면 평소 문장");
});

test("P1-f 화면 상수는 서버와 같다(주요 거래 30일·상위 10건, 신고가만은 한 번에 100건 = 서버 상한)", () => {
  assert.equal(REALPRICE_VIEW_MAJOR_DAYS, REALPRICE_MAJOR_DAYS);
  assert.equal(REALPRICE_VIEW_MAJOR_TOP, REALPRICE_MAJOR_TOP);
  assert.equal(REALPRICE_VIEW_HIGH_PAGE_SIZE, REALPRICE_TRADES_LIMIT_MAX);
});

test("P1-f 목록 요청: 찾는 말 q, 신고가만은 limit=100, 주요 거래는 view=major와 찾기·관심·평형·금액·법정동만", () => {
  assert.equal(tradesQuery({ ...DEFAULT_REALPRICE_FILTERS, q: "  가상 숲 " }, { todayKst: TODAY }), "q=%EA%B0%80%EC%83%81+%EC%88%B2", "앞뒤 띄어쓰기만 지움(가운데는 서버가 뺌)");
  assert.equal(tradesQuery({ ...DEFAULT_REALPRICE_FILTERS, highOnly: true }, { todayKst: TODAY }), "limit=100", "신고가만은 화면에서 거르므로 한 번에 100건");
  assert.equal(tradesQuery({ ...DEFAULT_REALPRICE_FILTERS }, { todayKst: TODAY, major: true }), "view=major");
  const major = new URLSearchParams(tradesQuery(
    { ...DEFAULT_REALPRICE_FILTERS, q: "가상숲", period: "36", kind: "presale", excludeCancelled: false, excludeDirect: true, area: "middle", price: "over7", umd: "천동", highOnly: true },
    { todayKst: TODAY, major: true, watch: true, cursor: "c1" },
  ));
  assert.deepEqual([...major.keys()], ["view", "q", "watch", "areaMin", "areaMax", "priceMin", "umd"], "기간·종류·해제·직거래·cursor·limit은 보내지 않음(서버가 400으로 막는 매개변수)");
  assert.equal(major.get("q"), "가상숲");
});

test("P1-f 거르기 단추 글자와 '켜짐' 줄", () => {
  assert.deepEqual(chipText("period", "3"), { text: "최근 3개월", set: false }, "기간 단추는 늘 기간 이름, 기본값이면 켜짐 아님");
  assert.deepEqual(chipText("period", "36"), { text: "최근 3년", set: true });
  assert.deepEqual(chipText("area", ""), { text: "평형", set: false });
  assert.deepEqual(chipText("area", "middle"), { text: "60 ~ 85㎡", set: true });
  assert.deepEqual(chipText("price", ""), { text: "금액", set: false });
  assert.equal(activeFilterLine(DEFAULT_REALPRICE_FILTERS), "거르기 없음 · 해제 거래 뺌");
  assert.equal(activeFilterLine({ ...DEFAULT_REALPRICE_FILTERS, q: "가상숲", area: "middle", highOnly: true, excludeCancelled: false }), "켜짐: '가상숲' · 60 ~ 85㎡ · 신고가만 · 해제 포함");
  assert.equal(activeFilterLine(DEFAULT_REALPRICE_FILTERS, { major: true }), "최근 30일 매매 신고가 + 금액 상위 10건");
  assert.equal(
    activeFilterLine({ ...DEFAULT_REALPRICE_FILTERS, period: "36", kind: "presale", price: "over7" }, { major: true }),
    "최근 30일 매매 신고가 + 금액 상위 10건 · 켜짐: 7억 초과",
    "주요 거래는 서버가 정한 기간·종류를 켜짐 줄에 쓰지 않음",
  );
});

test("P1-f 0건 안내: 까닭에 맞는 첫 단추(신고가만 끄기·기간 늘려 다시 찾기·찾는 말 지우기·거르기 초기화)", () => {
  const actions = (view) => view.actions.map((action) => action.action);
  assert.deepEqual(actions(emptyView({ ...DEFAULT_REALPRICE_FILTERS, highOnly: true }, { highUnavailable: true })), ["high-off"]);
  const high = emptyView({ ...DEFAULT_REALPRICE_FILTERS, highOnly: true }, { loaded: 30 });
  assert.equal(high.title, "불러온 30건 가운데 신고가가 없습니다");
  assert.deepEqual(actions(high), ["high-off"]);
  const q = emptyView({ ...DEFAULT_REALPRICE_FILTERS, q: "가상숲" });
  assert.equal(q.title, "'가상숲' 거래가 최근 3개월에는 없습니다");
  assert.deepEqual(q.actions, [{ action: "period-max", label: "최근 3년에서 다시 찾기" }, { action: "q-clear", label: "찾는 말 지우기" }]);
  assert.deepEqual(actions(emptyView({ ...DEFAULT_REALPRICE_FILTERS, q: "가상숲", period: "36" })), ["q-clear"], "이미 가장 긴 기간이면 기간 단추 없음");
  assert.deepEqual(actions(emptyView({ ...DEFAULT_REALPRICE_FILTERS, q: "가상숲" }, { major: true })), ["q-clear"], "주요 거래는 기간을 바꾸지 않음");
  assert.deepEqual(actions(emptyView({ ...DEFAULT_REALPRICE_FILTERS, umd: "천동" })), ["reset"]);
});
