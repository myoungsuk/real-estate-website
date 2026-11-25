// 단계 P 실거래가 단지 상세 칸(2026-11-25, 중개날개 참고 화면의 '단지 상세'를 우리 자료로).
// GET /work/realprice/complex?apt=<단지 고유번호>[&area=<전용면적 ㎡>] — 읽기만 한다(마이그레이션·요약 표·저장·감사 없음).
// - 단지 하나의 매매 자료만 본다: 면적 목록, 고른 면적의 최근 거래·직전 거래·앞선 최고·최고가 대비·최근 3개월 거래 수·36개월 흐름(월별 가운데 값)·
//   이 면적 최고(최고 거래일)·같은 ㎡대(정수 ㎡가 같은 면적들) 최고·최근 거래 20건(해제·직거래 포함, 표시를 붙임).
// - 묶음 기준은 신고가(22.8절)·거래 흐름(insights)과 같다: 같은 cmp_seq·같은 area_x100, 비교 대상 조건 REALPRICE_COMPARABLE_WHERE,
//   앞선 최고는 previousMaxByRow(같은 날 거래는 서로 '앞선'으로 보지 않음), 흐름·직전·3개월은 insightFor. 그래서 같은 거래의 prevMaxWon은 trades·insights와 같다.
// - 84.97㎡와 84.98㎡는 합치지 않는다(2026-11-20 운영자 결정). '평'은 쓰지 않는다.
// - 읽은 행 수는 rt_daily_usage에 더하고, 끝 상한이면 429, 첫 상한이거나 판정 준비 전이면 200 + available:false(budget·pending, 더 읽지 않음).
// - 고른 면적 행은 REALPRICE_COMPLEX_ROWS_MAX까지만 읽고, 넘으면 경고 RT_COMPLEX_PARTIAL(최고·흐름이 읽은 범위 기준).
// - 세대수는 관심 단지 설정에서 운영자가 홈페이지 단지와 연결했을 때만(insights와 같은 표), 준공 연도는 거래 자료에 있을 때만. 없으면 null(지어내지 않음).
import { invalid } from "./work-input.mjs";
import { APT_SEQ_PATTERN, REALPRICE_COMPARABLE_WHERE, addReadUsage, isRecordHighTarget, parseArea, previousMaxByRow, readTradesContext } from "./realprice-query.mjs";
import { HOUSEHOLDS, REALPRICE_INSIGHT_WATCH_SQL, insightFor, ratioPct } from "./realprice-insights.mjs";
import { rowsReadOf } from "./realprice-store.mjs";

export const REALPRICE_COMPLEX_MONTHS = 36; // 흐름: 이번 달 포함 36개 달력월
export const REALPRICE_COMPLEX_RECENT_MONTHS = 3; // 최근 3개월 거래 수: 이번 달 포함 3개 달력월
export const REALPRICE_COMPLEX_RECENT_MAX = 20; // 최근 거래 목록
export const REALPRICE_COMPLEX_ROWS_MAX = 3000; // 고른 면적에서 읽는 행 상한
const COMPLEX_PARAMS = Object.freeze(["apt", "area"]);
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

// ① 면적 목록: 해제 아닌 매매를 면적마다 센 수·마지막 계약일·비교 대상(중개 또는 옛 자료) 최고가. 색인 idx_rt_trades_sale_group의 cmp_seq 앞부분을 탄다.
export const REALPRICE_COMPLEX_AREAS_SQL = `SELECT p.area_x100, COUNT(*) AS trade_count, MAX(p.deal_date) AS last_date,
  MAX(CASE WHEN ${REALPRICE_COMPARABLE_WHERE} THEN p.price_won END) AS max_won
FROM rt_trades p
WHERE p.kind = 'sale' AND p.cmp_seq = ?1 AND p.cancelled = 0
GROUP BY p.area_x100`;

// ② 고른 면적의 매매 전부(해제·직거래 포함, 최근 순, ?3 = 상한 + 1).
export const REALPRICE_COMPLEX_ROWS_SQL = `SELECT p.trade_key, p.kind, p.deal_date, p.umd_nm, p.apt_seq, p.cmp_seq, p.apt_nm, p.area_x100, p.floor, p.build_year,
  p.price_won, p.dealing_gbn, p.cancelled
FROM rt_trades p
WHERE p.kind = 'sale' AND p.cmp_seq = ?1 AND p.area_x100 = ?2
ORDER BY p.deal_date DESC, p.trade_key DESC
LIMIT ?3`;

const isComparable = (row) => Number(row.cancelled) === 0 && (row.dealing_gbn === null || row.dealing_gbn === undefined || row.dealing_gbn === "broker");
const toWon = (value) => (value === null || value === undefined ? null : Number(value));
const kstDate = (nowMs) => new Date(nowMs + KST_OFFSET_MS).toISOString().slice(0, 10);

// apt(필수, 단지 고유번호)·area(넣지 않아도 됨, ㎡ 소수 둘째 자리까지). 다른 매개변수·두 번 온 값·형식 틀림은 400(칸 이름만).
export function parseComplexDetailQuery(params) {
  const extra = [...new Set([...params.keys()].filter((name) => !COMPLEX_PARAMS.includes(name)))];
  if (extra.length > 0) throw invalid(extra);
  for (const name of COMPLEX_PARAMS) if (params.getAll(name).length > 1) throw invalid([name]);
  const apt = params.get("apt");
  if (apt === null || !APT_SEQ_PATTERN.test(apt) || apt === "*") throw invalid(["apt"]);
  const areaX100 = parseArea(params.get("area"), "area");
  return { apt, areaX100 };
}

// 고를 면적: 요청한 면적이 목록에 있으면 그것, 없으면 마지막 계약일이 가장 늦은 면적(같으면 거래가 많은 쪽, 그다음 넓은 쪽).
export function pickArea(areaRows, wanted) {
  if (areaRows.length === 0) return null;
  if (wanted !== null && areaRows.some((row) => Number(row.area_x100) === wanted)) return wanted;
  const best = [...areaRows].sort((a, b) => (a.last_date === b.last_date
    ? (Number(b.trade_count) - Number(a.trade_count)) || (Number(b.area_x100) - Number(a.area_x100))
    : (a.last_date < b.last_date ? 1 : -1)))[0];
  return Number(best.area_x100);
}

// 이 면적 최고(비교 대상 가운데 가장 높은 값, 같은 값이면 가장 늦은 날).
export function typeMaxOf(comparable) {
  let best = null;
  for (const row of comparable) {
    const won = toWon(row.price_won);
    if (won === null) continue;
    if (!best || won > best.priceWon || (won === best.priceWon && row.deal_date > best.dealDate)) best = { priceWon: won, dealDate: row.deal_date };
  }
  return best;
}

// 같은 ㎡대(정수 ㎡가 같은 면적들) 최고와 그 묶음의 면적 수.
export function bandMaxOf(areaRows, areaX100) {
  const band = Math.floor(areaX100 / 100);
  const members = areaRows.filter((row) => Math.floor(Number(row.area_x100) / 100) === band);
  const prices = members.map((row) => toWon(row.max_won)).filter((won) => won !== null);
  return { bandM2: band, bandMaxWon: prices.length > 0 ? Math.max(...prices) : null, bandTypes: members.length };
}

// 고른 면적 행(최근 순)으로 칸 하나를 만든다. 순수 함수(시험이 직접 부름).
export function complexAreaView(areaRows, areaX100, rows, { today, months = REALPRICE_COMPLEX_MONTHS, recentMonths = REALPRICE_COMPLEX_RECENT_MONTHS, recentMax = REALPRICE_COMPLEX_RECENT_MAX }) {
  const comparable = rows.filter(isComparable);
  const latestRow = rows.find((row) => Number(row.cancelled) === 0) ?? null;
  const recentRows = rows.slice(0, recentMax);
  const prevMax = previousMaxByRow([...(latestRow ? [latestRow] : []), ...recentRows], comparable);
  const latestPrevMax = latestRow ? prevMax[0] : null;
  const recentPrevMax = latestRow ? prevMax.slice(1) : prevMax;
  const entry = { max: null, last: null, win: comparable };
  const latestInsight = latestRow ? insightFor(latestRow, entry, latestPrevMax, { months: 1, recentMonths }) : null;
  const flow = insightFor({ deal_date: today, price_won: null }, entry, null, { months, recentMonths });
  const typeMax = typeMaxOf(comparable);
  const area = areaRows.find((row) => Number(row.area_x100) === areaX100);
  const latestTarget = latestRow ? isRecordHighTarget(latestRow) : false;
  return {
    areaM2: areaX100 / 100,
    tradeCount: Number(area?.trade_count ?? 0),
    latest: latestRow ? {
      tradeKey: latestRow.trade_key,
      dealDate: latestRow.deal_date,
      floor: latestRow.floor ?? null,
      priceWon: toWon(latestRow.price_won),
      dealingGbn: latestRow.dealing_gbn ?? null,
      recordHigh: latestTarget && latestPrevMax !== null && toWon(latestRow.price_won) > latestPrevMax,
    } : null,
    prev: latestInsight ? latestInsight.prev : null,
    prevMaxWon: latestTarget ? latestPrevMax : null,
    ratioPct: latestTarget ? ratioPct(toWon(latestRow.price_won), latestPrevMax) : null,
    ratioSkip: latestRow && !latestTarget ? (latestRow.dealing_gbn === "direct" ? "direct" : "no_complex") : null,
    recent3m: flow.recent3m,
    typeMaxWon: typeMax?.priceWon ?? null,
    typeMaxDate: typeMax?.dealDate ?? null,
    ...bandMaxOf(areaRows, areaX100),
    series: flow.series,
    recent: recentRows.map((row, index) => ({
      tradeKey: row.trade_key,
      dealDate: row.deal_date,
      floor: row.floor ?? null,
      priceWon: toWon(row.price_won),
      dealingGbn: row.dealing_gbn ?? null,
      cancelled: Number(row.cancelled) === 1,
      recordHigh: isRecordHighTarget(row) && recentPrevMax[index] !== null && toWon(row.price_won) > recentPrevMax[index],
    })),
  };
}

// GET /work/realprice/complex. 돌려주는 값: { available, reason?, complex, areas, area, basis, recordHighReady, warnings }
export async function readRealpriceComplex(db, params, { nowMs }) {
  const query = parseComplexDetailQuery(params);
  const context = await readTradesContext(db, nowMs);
  const warnings = [];
  if (context.readSoftExceeded) warnings.push({ code: "RT_READ_BUDGET", level: "soft" });
  const basis = { months: REALPRICE_COMPLEX_MONTHS, recentMonths: REALPRICE_COMPLEX_RECENT_MONTHS, recentMax: REALPRICE_COMPLEX_RECENT_MAX };
  if (!context.recordHighEnabled) {
    await addReadUsage(db, nowMs, 1 + rowsReadOf(context.monthsResult));
    return { available: false, reason: context.readSoftExceeded ? "budget" : "pending", basis, recordHighReady: context.recordHighReady, warnings };
  }
  const areasResult = await db.prepare(REALPRICE_COMPLEX_AREAS_SQL).bind(query.apt).all();
  let rowsRead = rowsReadOf(areasResult);
  const areaRows = (areasResult.results ?? []).sort((a, b) => Number(a.area_x100) - Number(b.area_x100));
  const areaX100 = pickArea(areaRows, query.areaX100);
  let complex = null;
  let area = null;
  if (areaX100 !== null) {
    const rowsResult = await db.prepare(REALPRICE_COMPLEX_ROWS_SQL).bind(query.apt, areaX100, REALPRICE_COMPLEX_ROWS_MAX + 1).all();
    rowsRead += rowsReadOf(rowsResult);
    const all = rowsResult.results ?? [];
    if (all.length > REALPRICE_COMPLEX_ROWS_MAX) warnings.push({ code: "RT_COMPLEX_PARTIAL", level: "soft" });
    const rows = all.slice(0, REALPRICE_COMPLEX_ROWS_MAX);
    const watch = await db.prepare(REALPRICE_INSIGHT_WATCH_SQL).bind(JSON.stringify([query.apt])).all();
    rowsRead += rowsReadOf(watch);
    const slug = (watch.results ?? [])[0]?.complex_slug;
    const head = rows[0] ?? {};
    const buildYear = Number.isInteger(head.build_year) && head.build_year > 0 ? head.build_year : null;
    complex = { aptSeq: query.apt, aptName: head.apt_nm ?? null, umdName: head.umd_nm ?? null, buildYear, households: HOUSEHOLDS.get(slug) ?? null };
    area = complexAreaView(areaRows, areaX100, rows, { today: kstDate(nowMs) });
  }
  await addReadUsage(db, nowMs, 1 + rowsReadOf(context.monthsResult) + rowsRead);
  return {
    available: true,
    complex,
    areas: areaRows.map((row) => ({ areaM2: Number(row.area_x100) / 100, tradeCount: Number(row.trade_count), lastDealDate: row.last_date })),
    area,
    basis,
    recordHighReady: context.recordHighReady,
    warnings,
  };
}
