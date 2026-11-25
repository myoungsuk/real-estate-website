// 단계 P 실거래가: 거래 완료 소식에 단지 이름을 쓸 수 있는지 볼 건수(2026-11-25, 사용자 결정 15:20:21 "최근 6개월 3건 이상").
// GET /work/realprice/deal-count?apt=<단지 고유번호>&band=<전용면적 ㎡ 정수>&deal=<sale|jeonse|monthly-rent> — 읽기만 한다(마이그레이션·저장·감사 없음).
// - 세는 것: 같은 단지·같은 전용면적대(㎡ 정수 내림이 같은 면적들)·같은 거래 종류, 계약일이 '오늘에서 6개월 전 ~ 오늘'(양 끝 포함), 해제 뺌.
//   직거래·갱신 계약도 센다(해제만 뺌). 전세는 월 임대료가 0인 전월세, 월세는 0보다 큰 전월세.
// - '오늘'은 서버 시계의 한국 날짜로만 정한다. 기준 날짜를 받는 입력은 없다(화면이 구간을 바꿀 수 없게).
// - 대전 동구 단지만 받는다(소식 범위가 동구). 고유번호 앞 5자리가 동구가 아니면 400 RT_REGION_NOT_ALLOWED이고, SQL에도 구 조건을 건다.
// - 입력은 모두 bind로만 넣는다. 금액·동·층·거래 ID는 읽지도 돌려주지도 않고 건수 하나만 돌려준다.
// - 읽은 행 수는 rt_daily_usage에 더하고, 끝 상한이면 429, 첫 상한이면 200 + available:false(reason "budget", 더 읽지 않음).
// - 매매는 색인 idx_rt_trades_sale_group(cmp_seq, area_x100, deal_date)을 탄다. 전월세는 단지 색인이 없어 기본 키 범위(구간의 달)를 읽는다
//   (구간 7개 달의 대전 5개 구 전월세 행을 훑음. 색인을 더하려면 D1 구조 변경이 필요해 두지 않았다).
// - 단지 찾기(searchDealNewsComplexes, GET /work/realprice/deal-complexes?q=)도 이 파일에 있다. 매매·전세·월세 자료를 함께 찾고, 찾는 범위는 dealNewsSearchRanges() 한 곳에서 정한다.
// - coverage: 세는 구간의 달을 모두 받았는지(빠진 달이 있으면 건수가 실제보다 적을 수 있음)와, 동구 자료가 끊김 없이 덮는 시작 달(매매·전월세 따로).
import { WorkApiError } from "./work-security.mjs";
import { invalid } from "./work-input.mjs";
import { APT_SEQ_PATTERN, addReadUsage, parseComplexQuery, readTradesContext } from "./realprice-query.mjs";
import { REALPRICE_START_MONTHS, expectedMonths, monthId, rowsReadOf } from "./realprice-store.mjs";
import { REALPRICE_BASE_LAWD, lawdOfAptSeq } from "../src/lib/work/realprice-regions.mjs";
import { DEAL_NEWS_AREA_BAND, DEAL_NEWS_DEAL_TYPES } from "../src/lib/deal-news.mjs";
import { DEAL_NEWS_COUNT_MONTHS, DEAL_NEWS_MIN_COUNT, dealNewsCountWindow, dealNewsToday } from "../src/lib/admin-deal-news.mjs";

const DEAL_COUNT_PARAMS = Object.freeze(["apt", "band", "deal"]);
const BAND_PATTERN = /^[1-9]\d{1,2}$/u;
const DEAL_VALUES = DEAL_NEWS_DEAL_TYPES.map((entry) => entry.value);

// 매매: ?1 단지, ?2·?3 면적 범위(×100, 아래 포함·위 뺌), ?4·?5 계약일(양 끝 포함), ?6 구.
export const REALPRICE_DEAL_COUNT_SALE_SQL = `SELECT COUNT(*) AS n FROM rt_trades p
WHERE p.kind = 'sale' AND p.cmp_seq = ?1 AND p.area_x100 >= ?2 AND p.area_x100 < ?3
  AND p.deal_date >= ?4 AND p.deal_date <= ?5 AND p.cancelled = 0 AND p.lawd_cd = ?6`;

// 전월세: ?1·?2 기본 키 범위(구간의 달), ?3 단지, ?4·?5 면적, ?6·?7 계약일, ?8 구, ?9 = 1이면 월세·0이면 전세.
export const REALPRICE_DEAL_COUNT_RENT_SQL = `SELECT COUNT(*) AS n FROM rt_trades p
WHERE p.trade_key >= ?1 AND p.trade_key < ?2 AND p.kind = 'rent' AND p.apt_seq = ?3 AND p.area_x100 >= ?4 AND p.area_x100 < ?5
  AND p.deal_date >= ?6 AND p.deal_date <= ?7 AND p.cancelled = 0 AND p.lawd_cd = ?8
  AND (CASE WHEN COALESCE(p.monthly_rent_won, 0) > 0 THEN 1 ELSE 0 END) = ?9`;

export function regionNotAllowedError() {
  return new WorkApiError("RT_REGION_NOT_ALLOWED", "거래 완료 소식의 건수는 대전 동구 단지만 셀 수 있습니다.", 400, false, ["apt"]);
}

// apt·band·deal 모두 필수. 다른 매개변수(날짜 포함)·두 번 온 값·형식 틀림은 400(칸 이름만). 동구 밖 단지는 따로 거절한다.
export function parseDealCountQuery(params) {
  const extra = [...new Set([...params.keys()].filter((name) => !DEAL_COUNT_PARAMS.includes(name)))];
  if (extra.length > 0) throw invalid(extra);
  for (const name of DEAL_COUNT_PARAMS) if (params.getAll(name).length !== 1) throw invalid([name]);
  const apt = params.get("apt");
  const bandText = params.get("band");
  const deal = params.get("deal");
  const bad = [];
  if (!APT_SEQ_PATTERN.test(apt)) bad.push("apt");
  const band = BAND_PATTERN.test(bandText) ? Number(bandText) : NaN;
  if (!(band >= DEAL_NEWS_AREA_BAND.min && band <= DEAL_NEWS_AREA_BAND.max)) bad.push("band");
  if (!DEAL_VALUES.includes(deal)) bad.push("deal");
  if (bad.length > 0) throw invalid(bad);
  if (lawdOfAptSeq(apt) !== REALPRICE_BASE_LAWD) throw regionNotAllowedError();
  return { apt, band, deal, kind: deal === "sale" ? "sale" : "rent" };
}

const ymdOf = (date) => `${date.slice(0, 4)}${date.slice(5, 7)}`;
const dashed = (ymd) => `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}`;

// 동구 자료가 이번 달까지 끊김 없이 덮는 시작 달('YYYY-MM'). 이번 달을 아직 못 받았으면 null. 매매는 saleCoveredThrough와 같은 값이다.
export function dealCountCoveredFrom(monthRows, kind, currentYmd) {
  const done = new Set(monthRows.filter((row) => row.last_success_at).map(monthId));
  let covered = null;
  for (const dealYmd of expectedMonths(kind, currentYmd).reverse()) {
    if (!done.has(`${REALPRICE_BASE_LAWD}:${kind}:${dealYmd}`)) break;
    covered = dealYmd;
  }
  return covered ? dashed(covered) : null;
}

// 세는 구간의 달(시작 달보다 앞선 달은 뺌)과 그 가운데 아직 못 받은 달.
export function dealCountWindowMonths(monthRows, kind, window) {
  const done = new Set(monthRows.filter((row) => row.last_success_at).map(monthId));
  const months = expectedMonths(kind, ymdOf(window.to)).filter((ymd) => ymd >= ymdOf(window.from) && ymd >= REALPRICE_START_MONTHS[kind]);
  return { months, missing: months.filter((ymd) => !done.has(`${REALPRICE_BASE_LAWD}:${kind}:${ymd}`)) };
}

// GET /work/realprice/deal-count. 돌려주는 값: { available, reason?, count, today, basis, coverage, warnings }
export async function readDealCount(db, params, { nowMs }) {
  const query = parseDealCountQuery(params);
  const context = await readTradesContext(db, nowMs);
  const today = dealNewsToday(nowMs);
  const window = dealNewsCountWindow(today);
  const basis = { months: DEAL_NEWS_COUNT_MONTHS, minCount: DEAL_NEWS_MIN_COUNT, from: window.from, to: window.to };
  const { months, missing } = dealCountWindowMonths(context.monthRows, query.kind, window);
  const coverage = {
    kind: query.kind,
    complete: missing.length === 0,
    missingMonths: missing.map(dashed),
    sale: { coveredFrom: dealCountCoveredFrom(context.monthRows, "sale", context.currentYmd) },
    rent: { coveredFrom: dealCountCoveredFrom(context.monthRows, "rent", context.currentYmd) },
  };
  const warnings = [];
  if (context.readSoftExceeded) {
    warnings.push({ code: "RT_READ_BUDGET", level: "soft" });
    await addReadUsage(db, nowMs, 1 + rowsReadOf(context.monthsResult));
    return { available: false, reason: "budget", count: null, today, basis, coverage, warnings };
  }
  const areaFrom = query.band * 100;
  const areaTo = (query.band + 1) * 100;
  const statement = query.kind === "sale"
    ? db.prepare(REALPRICE_DEAL_COUNT_SALE_SQL).bind(query.apt, areaFrom, areaTo, window.from, window.to, REALPRICE_BASE_LAWD)
    : db.prepare(REALPRICE_DEAL_COUNT_RENT_SQL).bind(
      `rent:${months[0]}:`, `rent:${months.at(-1)};`, query.apt, areaFrom, areaTo, window.from, window.to, REALPRICE_BASE_LAWD,
      query.deal === "monthly-rent" ? 1 : 0,
    );
  const result = await statement.all();
  await addReadUsage(db, nowMs, 1 + rowsReadOf(context.monthsResult) + rowsReadOf(result));
  return { available: true, count: Number((result.results ?? [])[0]?.n ?? 0), today, basis, coverage, warnings };
}

// ── 거래 완료 소식의 단지 찾기(2026-11-25, 사용자 결정 17:34 "전세·월세도 찾기") ──
// GET /work/realprice/deal-complexes?q=<단지 이름 일부> — 읽기만 한다(마이그레이션·저장·감사 없음).
// - 찾는 곳: 대전 동구, 해제 아닌 매매·전월세(분양권 뺌), 계약일이 건수 구간(오늘에서 6개월 전 ~ 오늘) 안. 단지 이름은 그 구간의 건수로만 쓸 수 있으므로
//   구간 밖 거래만 있는 단지는 찾아도 쓸 데가 없다. 범위를 바꾸려면 dealNewsSearchRanges()만 고친다.
// - 돌려주는 것: 단지 고유번호·이름·법정동과, 거래 종류마다 그 구간에 거래가 있었던 전용면적대(㎡ 정수 내림) 목록. 건수·금액·동·층·거래 ID는 돌려주지 않는다.
// - 전월세는 단지 색인이 없어 기본 키 범위(구간의 달)를 읽는다(건수 API의 전월세와 같은 읽기. 색인을 더하려면 D1 구조 변경이 필요해 두지 않음).
export const DEAL_COMPLEX_GROUP_MAX = 400; // 한 번에 읽어 오는 (단지 · 거래 종류 · 면적대) 묶음 수의 상한
export const DEAL_COMPLEX_RESULT_MAX = 30; // 화면에 돌려주는 단지 수의 상한

// 찾는 범위(한 곳). 돌려주는 값: { from, to(계약일 양 끝 포함), ranges: [[아래 키, 위 키] 매매, [..] 전월세] }
export function dealNewsSearchRanges(window) {
  const fromYmd = ymdOf(window.from);
  const toYmd = ymdOf(window.to);
  return {
    from: window.from,
    to: window.to,
    ranges: [[`sale:${fromYmd}:`, `sale:${toYmd};`], [`rent:${fromYmd}:`, `rent:${toYmd};`]],
  };
}

// ?1·?2 매매 키 범위, ?3·?4 전월세 키 범위, ?5 구, ?6·?7 계약일(양 끝 포함), ?8 찾는 말(띄어쓰기 뺀 소문자), ?9 묶음 상한.
// 이름·법정동은 묶음에서 가장 최근 계약의 값(SQLite는 MAX() 하나와 함께 고른 칸을 그 행에서 가져온다).
export const REALPRICE_DEAL_COMPLEXES_SQL = `SELECT apt_seq, apt_nm, umd_nm, deal, band, MAX(deal_date) AS last_deal_date FROM (
  SELECT apt_seq, apt_nm, umd_nm, deal_date, area_x100 / 100 AS band,
    CASE WHEN kind = 'sale' THEN 'sale' WHEN COALESCE(monthly_rent_won, 0) > 0 THEN 'monthly-rent' ELSE 'jeonse' END AS deal
  FROM rt_trades
  WHERE ((trade_key >= ?1 AND trade_key < ?2) OR (trade_key >= ?3 AND trade_key < ?4))
    AND kind IN ('sale', 'rent') AND apt_seq IS NOT NULL AND lawd_cd = ?5 AND cancelled = 0
    AND deal_date >= ?6 AND deal_date <= ?7 AND instr(replace(lower(apt_nm), ' ', ''), ?8) > 0
)
GROUP BY apt_seq, deal, band
ORDER BY apt_seq, deal, band
LIMIT ?9`;

const DEAL_COMPLEX_PARAMS = Object.freeze(["q"]);

// q만 받는다(1 ~ 30자, 단지 찾기와 같은 규칙). 다른 매개변수·두 번 온 값은 400(칸 이름만).
export function parseDealComplexesQuery(params) {
  const extra = [...new Set([...params.keys()].filter((name) => !DEAL_COMPLEX_PARAMS.includes(name)))];
  if (extra.length > 0) throw invalid(extra);
  if (params.getAll("q").length !== 1) throw invalid(["q"]);
  return parseComplexQuery(params.get("q"));
}

// 읽은 묶음 행 → 단지 목록(가장 최근 계약이 늦은 단지부터, 같으면 고유번호 순). 면적대는 10 ~ 400만 남기고, 남는 면적대가 없는 단지는 넣지 않는다.
export function groupDealComplexRows(rows) {
  const byApt = new Map();
  for (const row of rows) {
    const band = Number(row.band);
    if (!DEAL_VALUES.includes(row.deal) || !Number.isInteger(band) || band < DEAL_NEWS_AREA_BAND.min || band > DEAL_NEWS_AREA_BAND.max) continue;
    let entry = byApt.get(row.apt_seq);
    if (!entry) {
      entry = { aptSeq: row.apt_seq, aptName: row.apt_nm, umdName: row.umd_nm, lastDealDate: row.last_deal_date, bands: Object.fromEntries(DEAL_VALUES.map((value) => [value, []])) };
      byApt.set(row.apt_seq, entry);
    }
    if (row.last_deal_date > entry.lastDealDate) Object.assign(entry, { aptName: row.apt_nm, umdName: row.umd_nm, lastDealDate: row.last_deal_date });
    entry.bands[row.deal].push(band);
  }
  return [...byApt.values()]
    .map((entry) => ({ ...entry, bands: Object.fromEntries(Object.entries(entry.bands).map(([deal, list]) => [deal, [...new Set(list)].sort((a, b) => a - b)])) }))
    .sort((a, b) => (a.lastDealDate === b.lastDealDate ? (a.aptSeq < b.aptSeq ? -1 : 1) : a.lastDealDate < b.lastDealDate ? 1 : -1));
}

// GET /work/realprice/deal-complexes. 돌려주는 값: { available, reason?, items: [{ aptSeq, aptName, umdName, bands: { sale, jeonse, monthly-rent } }], basis: { from, to }, warnings }
// 첫 상한이면 200 + available:false(reason "budget", 더 읽지 않음), 끝 상한이면 429(readTradesContext).
// 묶음 상한에 닿았거나 단지가 30곳을 넘으면 warnings RT_DEAL_COMPLEXES_PARTIAL(찾는 말을 더 길게 넣으라는 뜻).
export async function searchDealNewsComplexes(db, params, { nowMs }) {
  const needle = parseDealComplexesQuery(params);
  const context = await readTradesContext(db, nowMs);
  const search = dealNewsSearchRanges(dealNewsCountWindow(dealNewsToday(nowMs)));
  const basis = { from: search.from, to: search.to };
  if (context.readSoftExceeded) {
    await addReadUsage(db, nowMs, 1 + rowsReadOf(context.monthsResult));
    return { available: false, reason: "budget", items: [], basis, warnings: [{ code: "RT_READ_BUDGET", level: "soft" }] };
  }
  const [[saleFrom, saleTo], [rentFrom, rentTo]] = search.ranges;
  const result = await db.prepare(REALPRICE_DEAL_COMPLEXES_SQL)
    .bind(saleFrom, saleTo, rentFrom, rentTo, REALPRICE_BASE_LAWD, search.from, search.to, needle, DEAL_COMPLEX_GROUP_MAX)
    .all();
  await addReadUsage(db, nowMs, 1 + rowsReadOf(context.monthsResult) + rowsReadOf(result));
  const rows = result.results ?? [];
  const grouped = groupDealComplexRows(rows);
  const warnings = rows.length >= DEAL_COMPLEX_GROUP_MAX || grouped.length > DEAL_COMPLEX_RESULT_MAX ? [{ code: "RT_DEAL_COMPLEXES_PARTIAL" }] : [];
  return {
    available: true,
    items: grouped.slice(0, DEAL_COMPLEX_RESULT_MAX).map(({ aptSeq, aptName, umdName, bands }) => ({ aptSeq, aptName, umdName, bands })),
    basis,
    warnings,
  };
}
