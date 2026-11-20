// 실거래가·실거래가 설정 화면(P1-d)이 쓰는 순수 함수. 서버 요청·브라우저 저장·주소 변경은 하지 않는다(src/lib/work 공통 규칙, T0-115).
// 서버 응답 모양은 설계서 22.9절(worker/realprice-query.mjs·realprice-store.mjs)을 따른다.
import { formatKoreanAmount, formatKoreanWon } from "./work-format.mjs";

// 서버 상수와 같은 값(tests/work-realprice-view.test.mjs가 worker 상수와 대조한다).
export const REALPRICE_VIEW_PAGE_SIZE = 30; // REALPRICE_TRADES_LIMIT_DEFAULT
export const REALPRICE_VIEW_WATCH_MAX = 20; // REALPRICE_WATCH_MAX
export const REALPRICE_VIEW_NAME_MAX = 40; // REALPRICE_WATCH_NAME_MAX
export const REALPRICE_VIEW_QUERY_MAX = 30; // REALPRICE_COMPLEX_QUERY_MAX

export const REALPRICE_PERIODS = Object.freeze([
  { value: "1", label: "최근 1개월", months: 1 },
  { value: "3", label: "최근 3개월", months: 3 },
  { value: "6", label: "최근 6개월", months: 6 },
  { value: "12", label: "최근 1년", months: 12 },
  { value: "36", label: "최근 3년", months: 36 },
]);
export const REALPRICE_KIND_OPTIONS = Object.freeze([
  { value: "all", label: "전체" },
  { value: "sale", label: "매매" },
  { value: "rent", label: "전월세" },
  { value: "presale", label: "분양권" },
]);
// 면적·금액 칸은 경계를 겹치지 않게 '초과 ~ 이하'로 나눈다(서버는 아래·위 값을 모두 포함해 비교한다).
export const REALPRICE_AREA_OPTIONS = Object.freeze([
  { value: "", label: "전체" },
  { value: "small", label: "60㎡ 이하", max: "60" },
  { value: "middle", label: "60㎡ 초과 ~ 85㎡ 이하", min: "60.01", max: "85" },
  { value: "large", label: "85㎡ 초과", min: "85.01" },
]);
export const REALPRICE_PRICE_OPTIONS = Object.freeze([
  { value: "", label: "전체" },
  { value: "to3", label: "3억 이하", max: 300_000_000 },
  { value: "to5", label: "3억 초과 ~ 5억 이하", min: 300_000_001, max: 500_000_000 },
  { value: "to7", label: "5억 초과 ~ 7억 이하", min: 500_000_001, max: 700_000_000 },
  { value: "over7", label: "7억 초과", min: 700_000_001 },
]);
// 대전 동구 법정동 45개(가나다순). 국토교통부 자료의 법정동 이름과 정확히 같아야 거를 수 있다.
export const DONG_GU_UMD_NAMES = Object.freeze([
  "가양동", "가오동", "구도동", "낭월동", "내탑동", "대동", "대별동", "대성동", "마산동", "비룡동",
  "사성동", "삼괴동", "삼성동", "삼정동", "상소동", "성남동", "세천동", "소제동", "소호동", "신상동",
  "신안동", "신촌동", "신하동", "신흥동", "오동", "용계동", "용운동", "용전동", "원동", "이사동",
  "인동", "자양동", "장척동", "정동", "주산동", "주촌동", "중동", "직동", "천동", "추동",
  "판암동", "하소동", "홍도동", "효동", "효평동",
]);

export const DEFAULT_REALPRICE_FILTERS = Object.freeze({
  period: "3",
  kind: "all",
  area: "",
  price: "",
  umd: "",
  excludeCancelled: true,
  excludeDirect: false,
});

const optionOf = (options, value) => options.find((option) => option.value === value) ?? options[0];

export function isDefaultFilters(filters) {
  return Object.entries(DEFAULT_REALPRICE_FILTERS).every(([key, value]) => filters[key] === value);
}

// 휴대폰에서 접힌 거르기 줄에 보일 지금 조건(기본값과 다른 것 + 기간·해제 빼기는 늘).
export function filterSummary(filters) {
  const parts = [optionOf(REALPRICE_PERIODS, filters.period).label];
  if (filters.kind !== "all") parts.push(optionOf(REALPRICE_KIND_OPTIONS, filters.kind).label);
  if (filters.area) parts.push(optionOf(REALPRICE_AREA_OPTIONS, filters.area).label);
  if (filters.price) parts.push(optionOf(REALPRICE_PRICE_OPTIONS, filters.price).label);
  if (filters.umd) parts.push(filters.umd);
  if (filters.excludeCancelled) parts.push("해제 빼기");
  if (filters.excludeDirect) parts.push("직거래 빼기");
  return parts.join(" · ");
}

// "YYYY-MM-DD" 또는 "YYYY-MM"에서 달을 옮긴다 → "YYYY-MM".
export function shiftMonth(dateText, delta) {
  const [year, month] = dateText.split("-").map(Number);
  const index = year * 12 + (month - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

// 거르기 → GET /work/realprice/trades 매개변수. 끝 달(to)은 보내지 않아 서버의 이번 달(한국 시각)을 쓴다.
// 기본 기간(3개월)은 시작 달도 보내지 않는다(서버 기본값과 같음). todayKst: "YYYY-MM-DD"(legal-dates.mjs todayInKorea).
/** @param {Record<string, string | boolean>} filters @param {{ watch?: boolean, cursor?: string | null, todayKst: string }} options */
export function tradesQuery(filters, { watch = false, cursor = null, todayKst }) {
  const params = new URLSearchParams();
  const period = optionOf(REALPRICE_PERIODS, filters.period);
  if (period.value !== DEFAULT_REALPRICE_FILTERS.period) params.set("from", shiftMonth(todayKst, -(period.months - 1)));
  if (filters.kind !== "all") params.set("kind", optionOf(REALPRICE_KIND_OPTIONS, filters.kind).value);
  if (watch) params.set("watch", "1");
  const area = optionOf(REALPRICE_AREA_OPTIONS, filters.area);
  if (area.min) params.set("areaMin", area.min);
  if (area.max) params.set("areaMax", area.max);
  const price = optionOf(REALPRICE_PRICE_OPTIONS, filters.price);
  if (price.min) params.set("priceMin", String(price.min));
  if (price.max) params.set("priceMax", String(price.max));
  if (filters.umd && DONG_GU_UMD_NAMES.includes(filters.umd)) params.set("umd", filters.umd);
  if (!filters.excludeCancelled) params.set("cancelled", "include");
  if (filters.excludeDirect) params.set("direct", "exclude");
  if (cursor) params.set("cursor", cursor);
  return params.toString();
}

// ── 거래 한 줄 표시 ──

export function kindLabel(item) {
  if (item.kind === "sale") return "매매";
  if (item.kind === "presale") return "분양권";
  return item.monthlyRentWon ? "월세" : "전세";
}

// 금액: 매매·분양권은 거래 금액, 전세는 보증금, 월세는 보증금과 월세(두 번째 값은 따로 줄을 바꿀 수 있게 나눠 돌려준다).
export function priceParts(item) {
  if (item.kind !== "rent") return { main: Number.isSafeInteger(item.priceWon) ? formatKoreanWon(item.priceWon) : "금액 없음", monthly: null };
  const deposit = Number.isSafeInteger(item.depositWon) ? item.depositWon : 0;
  if (!item.monthlyRentWon) return { main: `보증금 ${deposit > 0 ? formatKoreanWon(deposit) : "0원"}`, monthly: null };
  return { main: `보증금 ${deposit > 0 ? formatKoreanAmount(deposit) : "0"}`, monthly: `/ 월 ${formatKoreanWon(item.monthlyRentWon)}` };
}

export const areaText = (areaM2) => `${Number(areaM2).toFixed(2)}㎡`;

export function floorText(floor) {
  if (!Number.isInteger(floor)) return "";
  return floor < 0 ? `지하 ${-floor}층` : `${floor}층`;
}

// 전용면적·층(등기를 마친 거래는 동 번호도 있다. 관리자 목록에는 그대로 보이고 홍보물에는 넣지 않는다, 설계서 22.4절).
export function sizeText(item) {
  return [areaText(item.areaM2), floorText(item.floor), item.aptDong ? `${item.aptDong}동`.replace(/동동$/u, "동") : ""].filter(Boolean).join(" · ");
}

export function dateText(isoDate) {
  const [year, month, day] = String(isoDate).split("-");
  return `${year}. ${Number(month)}. ${Number(day)}.`;
}

export function monthText(yearMonth) {
  const [year, month] = String(yearMonth).split("-");
  return `${year}년 ${Number(month)}월`;
}

const kstParts = (iso) => Object.fromEntries(new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Seoul", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
}).formatToParts(new Date(iso)).map(({ type, value }) => [type, value]));

// 한국 시각 "11. 19. 12:10"(짧게)·"11월 19일 12:10"(길게)
export function kstShort(iso) {
  const p = kstParts(iso);
  return `${p.month}. ${p.day}. ${p.hour}:${p.minute}`;
}
export function kstLong(iso) {
  const p = kstParts(iso);
  return `${p.month}월 ${p.day}일 ${p.hour}:${p.minute}`;
}

// 첫 화면에서 "며칠 전"(같은 날이면 빈 글자).
export function daysAgo(iso, nowMs) {
  const days = Math.floor((nowMs - Date.parse(iso)) / 86_400_000);
  return days >= 1 ? `${days}일 전` : "";
}

// ── 자료 받기 상태(GET /work/realprice/status) ──

// 받기를 멈추게 하는 마지막 오류(키·한도·권한). 일시 오류(RT_UPSTREAM_FAILED 등)는 다음 차례에 저절로 다시 받으므로 알리지 않는다.
const STOP_CODES = new Set(["RT_KEY_EXPIRED", "RT_KEY_INVALID", "RT_DAILY_LIMIT", "RT_ACCESS_DENIED", "RT_SERVICE_GONE", "RT_REQUEST_INVALID"]);

// 상태 코드 → 쉬운 말(짧은 이름, 할 일). 설계서 22.9절 끝.
export const REALPRICE_CODE_TEXT = Object.freeze({
  RT_KEY_EXPIRED: { label: "인증키 연장 필요", message: "인증키 활용 기간이 끝났습니다. 공공데이터포털에서 연장한 뒤 다시 받기를 누르세요." },
  RT_KEY_INVALID: { label: "인증키 확인 필요", message: "인증키를 쓸 수 없습니다(일시 중지·등록 안 됨 등). 공공데이터포털에서 인증키 상태를 확인해 주세요." },
  RT_DAILY_LIMIT: { label: "하루 호출 한도", message: "공공데이터포털 하루 호출 한도를 넘었습니다. 한국 시각 밤 0시 10분부터 다시 받습니다." },
  RT_ACCESS_DENIED: { label: "활용 신청 확인 필요", message: "이 자료의 활용 신청이 승인되지 않았습니다. 공공데이터포털에서 활용 신청 상태를 확인해 주세요." },
  RT_SERVICE_GONE: { label: "자료 서비스 바뀜", message: "국토교통부 자료 서비스가 바뀌었거나 없어졌습니다. 홈페이지 담당자에게 알려 주세요." },
  RT_REQUEST_INVALID: { label: "요청 형식 문제", message: "자료 요청 형식에 문제가 있습니다. 홈페이지 담당자에게 알려 주세요." },
  RT_ABORTED: { label: "받기가 자꾸 끊김", message: "같은 달 받기가 3번 연속 끝나지 못했습니다. 계속되면 홈페이지 담당자에게 알려 주세요." },
  RT_INTERNAL: { label: "처리 오류 반복", message: "같은 달을 처리하다 오류가 3번 연속 났습니다. 홈페이지 담당자에게 알려 주세요." },
  RT_HELD_DROP: { label: "건수 크게 줄어 보류", message: "새로 받은 건수가 크게 줄어든 달을 지우지 않고 한 번 보류했습니다. 다음 받기에서 다시 확인합니다." },
  RT_DROPPED_ROWS: { label: "버린 거래 많음", message: "형식이 맞지 않아 버린 거래가 5%를 넘은 달이 있습니다. 홈페이지 담당자에게 알려 주세요." },
  RT_WRITE_BUDGET: { label: "오늘 쓰기 예산 다 씀", message: "오늘 저장할 수 있는 양을 다 써서 내일 이어 받습니다." },
  RT_COUNT_DIFF: { label: "건수 차이", message: "국토교통부 두 자료의 건수가 다른 달이 있습니다. 다음 날 다시 확인합니다." },
  RT_READ_BUDGET: { label: "오늘 조회 한도", message: "오늘 실거래가 조회 한도를 넘었습니다. 한국 시각 오전 9시 이후 다시 보세요. 받아 둔 자료는 그대로 있습니다." },
});

// 알려야 할 문제(없으면 null). stop: 받기가 멈춘 것(키·한도·권한), 그 밖은 '확인 필요'.
export function statusProblem(status) {
  const last = status?.lastError;
  if (last && STOP_CODES.has(last.code) && (!status.lastSuccessAt || last.at >= status.lastSuccessAt)) {
    return { stop: true, code: last.code, ...REALPRICE_CODE_TEXT[last.code] };
  }
  for (const warning of status?.warnings ?? []) {
    if (warning.code === "RT_READ_BUDGET_NEAR" || (warning.code === "RT_READ_BUDGET" && warning.level !== "hard")) continue;
    const text = REALPRICE_CODE_TEXT[warning.code];
    if (text) return { stop: STOP_CODES.has(warning.code), code: warning.code, ...text };
  }
  return null;
}

export function backfillTotals(backfill) {
  const kinds = ["sale", "presale", "rent"].map((kind) => backfill?.[kind] ?? { done: 0, total: 0 });
  const done = kinds.reduce((sum, part) => sum + part.done, 0);
  const total = kinds.reduce((sum, part) => sum + part.total, 0);
  return { done, total, percent: total > 0 ? Math.floor((done / total) * 100) : 0, complete: total > 0 && done === total };
}

// 과거 채우기 막대 3개(채우는 순서: 매매 → 분양권 → 전월세).
export function backfillBars(status) {
  const sale = status?.backfill?.sale ?? { done: 0, total: 0 };
  const presale = status?.backfill?.presale ?? { done: 0, total: 0 };
  const rent = status?.backfill?.rent ?? { done: 0, total: 0 };
  const note = (part, waiting) => {
    if (part.total > 0 && part.done === part.total) return "다 채움";
    if (part.done === 0) return waiting;
    return "";
  };
  return [
    { kind: "sale", label: "매매", ...sale, note: sale.done === sale.total && sale.total > 0 ? "다 채움" : status?.coveredThrough ? `지금 ${monthText(status.coveredThrough)}까지` : "" },
    { kind: "presale", label: "분양권", ...presale, note: note(presale, "매매를 다 채운 뒤 시작") },
    { kind: "rent", label: "전월세", ...rent, note: note(rent, "분양권 다음") },
  ].map((bar) => ({ ...bar, percent: bar.total > 0 ? Math.floor((bar.done / bar.total) * 100) : 0 }));
}

// 979px 이하 상태 줄 아래 한 줄(막대 3개는 '자세히' 안, 날개대장 검토 2026-11-19). 다 채운 종류는 빼고, 지금 채우는 종류만 쓴다
// (차례대로 채우므로 보통 한 종류. 아직 시작 전인 종류는 '자세히'의 막대에서 본다). 다 채웠거나 자료가 없으면 빈 글자.
/** @param {any} status */
export function backfillLine(status) {
  if (backfillTotals(status?.backfill).total === 0) return "";
  const left = backfillBars(status).filter((bar) => !(bar.total > 0 && bar.done === bar.total));
  if (left.length === 0) return "";
  const running = left.filter((bar) => bar.done > 0);
  const shown = running.length > 0 ? running : left.slice(0, 1);
  return `${status?.lastSuccessAt ? "과거 자료 채우는 중" : "과거 자료 채우기 대기"} · ${shown.map((bar) => `${bar.label} ${bar.percent}%`).join(" · ")}`;
}

// 위쪽 상태 줄·칸에 쓸 글자. todayKst: "YYYY-MM-DD".
/** @param {any} status @param {{ nowMs: number, todayKst: string }} options */
export function statusView(status, { nowMs, todayKst }) {
  const totals = backfillTotals(status?.backfill);
  const problem = statusProblem(status);
  const empty = !status?.lastSuccessAt;
  const currentMonth = todayKst.slice(0, 7);
  const receivedCurrent = Boolean(status?.coveredThrough);
  const ago = status?.lastSuccessAt ? daysAgo(status.lastSuccessAt, nowMs) : "";
  const lastLong = status?.lastSuccessAt ? `${kstLong(status.lastSuccessAt)}${ago ? `(${ago})` : ""}` : "아직 없음";
  let range = "아직 없음";
  if (!empty) {
    const newest = receivedCurrent ? `${monthText(currentMonth)}분까지` : "이번 달은 아직";
    range = status.recordHighReady
      ? `${newest}(과거는 2006년 1월부터)`
      : status.coveredThrough ? `${newest}(매매는 ${monthText(status.coveredThrough)}까지 채움)` : newest;
  }
  let badge;
  if (problem?.stop) badge = { tone: "warning", text: "멈춤" };
  else if (problem) badge = { tone: "warning", text: "확인 필요" };
  else if (!totals.complete) badge = { tone: "checking", text: empty ? `처음 채우기 대기 ${totals.percent}%` : `처음 채우는 중 ${totals.percent}%` };
  else badge = { tone: "ready", text: "정상" };
  const line = empty
    ? "아직 받은 자료 없음"
    : problem?.stop
      ? `${kstShort(status.lastSuccessAt)}까지 받은 자료${ago ? `(${ago})` : ""}`
      : `${kstShort(status.lastSuccessAt)} 받음 · ${receivedCurrent ? `${Number(currentMonth.slice(5))}월분까지` : "이번 달은 아직"}`;
  return { empty, problem, badge, line, fill: backfillLine(status), lastLong, range, totals, recordHighReady: status?.recordHighReady === true };
}

// 설정 화면의 오늘 사용량 4칸(status.today, unmatchedSaleRows). 큰 행 수는 '만 행'으로 줄인다(소수 첫째 자리 아래는 버림).
export function rowsText(rows) {
  const value = Number.isSafeInteger(rows) && rows > 0 ? rows : 0;
  return value < 10_000 ? `${value.toLocaleString("ko-KR")}행` : `${(Math.floor(value / 1_000) / 10).toLocaleString("ko-KR")}만 행`;
}

export function usageView(status) {
  const today = status?.today ?? {};
  return {
    calls: `${Number(today.apiCalls ?? 0).toLocaleString("ko-KR")}회`,
    writes: `${rowsText(today.rowsWritten)} / 예산 ${rowsText(today.writeBudget)}`,
    reads: `${rowsText(today.rowsRead)} / 첫 상한 ${rowsText(today.readSoftLimit)}`,
    unmatched: `${Number(status?.unmatchedSaleRows ?? 0).toLocaleString("ko-KR")}건`,
  };
}

// 최근 실행 한 줄의 결과 표시(정상·일부만·실패 + 쉬운 이름).
export function runOutcome(run) {
  const label = run?.errorCode ? REALPRICE_CODE_TEXT[run.errorCode]?.label ?? "" : "";
  if (run?.outcome === "ok") return { tone: "ready", text: "정상" };
  if (run?.outcome === "partial") return { tone: "warning", text: label ? `일부만 · ${label}` : "일부만" };
  return { tone: "warning", text: label ? `실패 · ${label}` : "실패" };
}

// ── 관심 단지 ──

// 홈페이지 공개 단지 이름의 첫 낱말(공백 앞, 겹치지 않게) → 관심 단지가 비었을 때 보일 검색어 단추(2026-11-19 대장 결정).
export function seedWords(publishedComplexes) {
  const words = [];
  for (const complex of publishedComplexes) {
    const word = String(complex.name ?? "").trim().split(/\s+/u)[0];
    if (word && word.length <= REALPRICE_VIEW_QUERY_MAX && !words.includes(word)) words.push(word);
  }
  return words;
}

// 관심 단지 PUT 본문 items. 통째로 바꾸므로 GET으로 받은 각 항목의 complexSlug를 그대로 돌려보낸다(2026-11-19 대장 결정).
// 서버는 공개 단지 slug만 받으므로, 지금 빌드의 공개 단지에 없는 slug만 null로 바꾸고 그 수를 알린다(①안). 새로 넣는 항목은 찾기 결과의 suggestedSlug.
/**
 * @param {{ aptSeq: string, displayName: string, complexSlug?: string | null }[]} currentItems
 * @param {{ add?: { aptSeq: string, aptName?: string | null, suggestedSlug?: string | null } | null, removeAptSeq?: string | null }} [change]
 * @param {string[]} [publishedSlugs]
 */
export function watchPutItems(currentItems, { add = null, removeAptSeq = null } = {}, publishedSlugs = []) {
  const published = new Set(publishedSlugs);
  let dropped = 0;
  const keep = (slug) => {
    if (slug === null || slug === undefined) return null;
    if (published.has(slug)) return slug;
    dropped += 1;
    return null;
  };
  const items = currentItems
    .filter((item) => item.aptSeq !== removeAptSeq)
    .map((item) => ({ aptSeq: item.aptSeq, displayName: item.displayName, complexSlug: keep(item.complexSlug) }));
  if (add && !items.some((item) => item.aptSeq === add.aptSeq)) {
    const displayName = String(add.aptName ?? "").normalize("NFC").trim().slice(0, REALPRICE_VIEW_NAME_MAX) || add.aptSeq;
    items.push({ aptSeq: add.aptSeq, displayName, complexSlug: add.suggestedSlug && published.has(add.suggestedSlug) ? add.suggestedSlug : null });
  }
  return { items, droppedSlugs: dropped };
}

// 단지 찾기 검색어 정리(서버와 같은 1 ~ 30자, 앞뒤 공백 뺌). 맞지 않으면 null.
export function cleanComplexQuery(value) {
  const text = String(value ?? "").normalize("NFC").trim();
  return text.length >= 1 && text.length <= REALPRICE_VIEW_QUERY_MAX ? text : null;
}

// ── 오류 문장 ──

// 업무 API 오류 코드 → 화면 문장. retryAt(ISO)은 하루 읽기 끝 상한 때.
/** @param {string | null} code @param {{ retryAt?: string | null }} [options] */
export function apiErrorText(code, { retryAt = null } = {}) {
  if (code === "RT_READ_BUDGET") {
    return retryAt
      ? `오늘 실거래가 조회 한도를 넘었습니다. ${kstLong(retryAt)} 이후 다시 보세요. 받아 둔 자료는 그대로 있습니다.`
      : REALPRICE_CODE_TEXT.RT_READ_BUDGET.message;
  }
  const texts = {
    REALPRICE_DISABLED: "실거래가 탭이 아직 켜지지 않았습니다.",
    REALPRICE_CONFIG_MISSING: "실거래가 설정이 빠져 있습니다. 개발 담당에게 '실거래가 설정 누락'이라고 알려 주세요.",
    WORK_SCHEMA_OUTDATED: "업무 자료 구조가 아직 준비되지 않았습니다. 개발 담당에게 알려 주세요.",
    WORK_SCHEMA_AHEAD: "업무 자료 구조가 프로그램보다 새것입니다. 잠시 뒤 새로고침해 주세요.",
    STORAGE_UNAVAILABLE: "업무 자료 저장소에 연결하지 못했습니다. 잠시 뒤 다시 불러와 주세요.",
    VALIDATION_FAILED: "조건이 올바르지 않습니다. 거르기를 다시 골라 주세요.",
    VERSION_CONFLICT: "다른 창에서 관심 단지를 먼저 바꿔서 이번 변경은 저장하지 않았습니다. 아래는 새로 불러온 목록입니다. 확인한 뒤 다시 넣거나 빼 주세요.",
    CSRF_INVALID: "보안 확인이 만료되었습니다. 화면을 새로고침한 뒤 다시 해 주세요.",
    ORIGIN_DENIED: "허용되지 않은 주소에서 저장하려고 했습니다. 운영 주소에서 다시 해 주세요.",
    AUTH_REQUIRED: "관리자 로그인이 만료되었습니다. 화면을 새로고침해 다시 로그인해 주세요.",
  };
  return texts[code] ?? "요청을 처리하지 못했습니다. 잠시 뒤 다시 해 주세요.";
}
