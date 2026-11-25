// 단계 P 실거래가 거래 흐름·직전·앞선 최고·3개월 건수(보드 63번, 설계서 22.17안, 2026-11-20 운영자 결정 "권하는 조합"·"앞선 최고 기준"·"12개월").
// GET /work/realprice/insights?ids=k1,… (1 ~ 30개). trades 응답은 바꾸지 않는다.
// - 묶음 기준은 신고가(22.8절)와 완전히 같다: 같은 cmp_seq(빈 값·'*' 제외)·같은 area_x100·매매·해제 아님·직거래 아님(중개 구분 NULL 옛 자료는 넣음).
//   비교 대상 조건 문자열(REALPRICE_COMPARABLE_WHERE)과 앞선 최고 계산 함수(previousMaxByRow)를 신고가와 함께 써서, prevMaxWon은 trades의 prevMaxWon과 늘 같다(시험이 대조).
//   같은 날 거래는 서로 '앞선'으로 보지 않는다.
// - 보내 온 ID만 읽고, 판정 대상 행을 묶음으로 모아 묶음마다 한 번 읽는다(마이그레이션·요약 표·저장 없음).
// - 읽은 행 수는 rt_daily_usage에 더하고, 끝 상한이면 429, 첫 상한이거나 판정 준비 전이면 200 + available:false(budget·pending).
// - 세대수는 관심 단지 설정에서 운영자가 홈페이지 단지와 연결한 complex_slug가 있을 때만 그 단지 '규모'에서 읽는다(이름 짐작 안 씀).
import complexes from "../src/data/complexes.json" with { type: "json" };
import { invalid } from "./work-input.mjs";
import {
  REALPRICE_COMPARABLE_WHERE,
  REALPRICE_TRADES_BY_IDS_SQL,
  TRADE_KEY_PATTERN,
  addReadUsage,
  isRecordHighTarget,
  previousMaxByRow,
  readTradesContext,
} from "./realprice-query.mjs";
import { rowsReadOf } from "./realprice-store.mjs";

export const REALPRICE_INSIGHT_IDS_MAX = 30; // 목록 한 쪽(기본 30건)
export const REALPRICE_INSIGHT_MONTHS = 12; // 흐름선: 계약 달 포함 12개 달력월
export const REALPRICE_INSIGHT_RECENT_MONTHS = 3; // 최근 3개월 거래 수: 계약 달 포함 3개 달력월

// 묶음(?1 = JSON [[cmp_seq, area_x100, 창 시작일 YYYY-MM-01, 묶음 안 가장 늦은 계약일], …])마다
// ① 창 시작 앞 비교 대상 최고가 1행(part 'max') ② 창 시작 앞 가장 늦은 비교 대상 1행(part 'last', 없으면 행 없음)
// ③ 창 시작 ~ 가장 늦은 계약일(그날 포함) 비교 대상 거래 전부(part 'win'). 색인 idx_rt_trades_sale_group(cmp_seq, area_x100, deal_date)를 탄다.
export const REALPRICE_INSIGHTS_SQL = `WITH g AS MATERIALIZED (
  SELECT json_extract(value, '$[0]') AS cmp_seq, json_extract(value, '$[1]') AS area_x100,
    json_extract(value, '$[2]') AS window_start, json_extract(value, '$[3]') AS last_date
  FROM json_each(?1)
)
SELECT g.cmp_seq, g.area_x100, 'max' AS part, NULL AS trade_key, NULL AS deal_date, NULL AS floor, (
  SELECT MAX(p.price_won) FROM rt_trades p
  WHERE p.kind = 'sale' AND p.cmp_seq = g.cmp_seq AND p.area_x100 = g.area_x100 AND p.deal_date < g.window_start
    AND ${REALPRICE_COMPARABLE_WHERE}
) AS price_won
FROM g
UNION ALL
SELECT g.cmp_seq, g.area_x100, 'last' AS part, t.trade_key, t.deal_date, t.floor, t.price_won
FROM g JOIN rt_trades t ON t.trade_key = (
  SELECT p.trade_key FROM rt_trades p
  WHERE p.kind = 'sale' AND p.cmp_seq = g.cmp_seq AND p.area_x100 = g.area_x100 AND p.deal_date < g.window_start
    AND ${REALPRICE_COMPARABLE_WHERE}
  ORDER BY p.deal_date DESC, p.trade_key DESC LIMIT 1
)
UNION ALL
SELECT p.cmp_seq, p.area_x100, 'win' AS part, p.trade_key, p.deal_date, p.floor, p.price_won
FROM g JOIN rt_trades p ON p.kind = 'sale' AND p.cmp_seq = g.cmp_seq AND p.area_x100 = g.area_x100
  AND p.deal_date >= g.window_start AND p.deal_date <= g.last_date
WHERE ${REALPRICE_COMPARABLE_WHERE}`;

// 운영자가 연결한 홈페이지 단지(20행 이하).
export const REALPRICE_INSIGHT_WATCH_SQL = "SELECT apt_seq, complex_slug FROM rt_watch_complexes WHERE complex_slug IS NOT NULL AND apt_seq IN (SELECT value FROM json_each(?1))";

const MAN_WON = 10_000;
const groupKey = (cmpSeq, areaX100) => `${cmpSeq}\u0000${Number(areaX100)}`;
const monthIndex = (date) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
const ymOf = (index) => `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;

// 공개 단지 slug → 세대수(facts '규모'의 "n세대"). 읽지 못하면 넣지 않는다.
export const HOUSEHOLDS = new Map(complexes
  .filter((complex) => complex?.status === "published")
  .map((complex) => {
    const scale = (complex.facts ?? []).find((fact) => fact?.label === "규모")?.value ?? "";
    const match = String(scale).match(/([\d,]+)\s*세대/u);
    const count = match ? Number(match[1].replace(/,/gu, "")) : Number.NaN;
    return [complex.slug, Number.isSafeInteger(count) && count > 0 ? count : null];
  })
  .filter(([, count]) => count !== null));

// ids(쉼표로 이은 거래 ID 1 ~ 30개). 다른 매개변수가 오거나 형식이 틀리면 400(칸 이름만). 같은 ID는 하나로(보낸 순서 유지).
export function parseInsightIds(params) {
  const extra = [...new Set([...params.keys()].filter((name) => name !== "ids"))];
  if (extra.length > 0) throw invalid(extra);
  const values = params.getAll("ids");
  if (values.length !== 1) throw invalid(["ids"]);
  const parts = values[0].split(",");
  if (parts.length > REALPRICE_INSIGHT_IDS_MAX || parts.some((part) => !TRADE_KEY_PATTERN.test(part))) throw invalid(["ids"]);
  return [...new Set(parts)];
}

// 판정 대상이 아닌 까닭.
export function insightSkipReason(row) {
  if (row.kind !== "sale") return "not_sale";
  if (Number(row.cancelled) === 1) return "cancelled";
  if (row.dealing_gbn === "direct") return "direct";
  if (!isRecordHighTarget(row)) return "no_complex";
  return null;
}

// 대상 행을 묶음으로: [[cmp_seq, area_x100, 창 시작일, 가장 늦은 계약일], …]
export function insightGroups(targets, months = REALPRICE_INSIGHT_MONTHS) {
  const groups = new Map();
  for (const row of targets) {
    const key = groupKey(row.cmp_seq, row.area_x100);
    const start = `${ymOf(monthIndex(row.deal_date) - (months - 1))}-01`;
    const group = groups.get(key);
    if (!group) groups.set(key, [row.cmp_seq, Number(row.area_x100), start, row.deal_date]);
    else {
      if (start < group[2]) group[2] = start;
      if (row.deal_date > group[3]) group[3] = row.deal_date;
    }
  }
  return [...groups.values()];
}

// 가운데 값(원). 짝수 건이면 가운데 두 값의 평균을 만 원 단위로 내림.
export function medianWon(prices) {
  if (prices.length === 0) return null;
  const sorted = [...prices].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return Math.floor((sorted[middle - 1] + sorted[middle]) / 2 / MAN_WON) * MAN_WON;
}

// 가격 ÷ 앞선 최고 × 100, 소수 첫째 자리 반올림. 앞선 최고가 없으면 null.
export function ratioPct(priceWon, prevMaxWon) {
  if (!Number.isSafeInteger(priceWon) || !Number.isSafeInteger(prevMaxWon) || prevMaxWon <= 0) return null;
  return Math.round((priceWon * 1000) / prevMaxWon) / 10;
}

// 한 거래의 흐름·직전·앞선 최고·3개월 건수. entry: 묶음의 { max, last, win[] }(REALPRICE_INSIGHTS_SQL 결과).
// prevMaxWon: 신고가와 같은 previousMaxByRow 값(부르는 쪽이 넘김).
export function insightFor(row, entry, prevMaxWon, { months = REALPRICE_INSIGHT_MONTHS, recentMonths = REALPRICE_INSIGHT_RECENT_MONTHS } = {}) {
  const date = row.deal_date;
  const month = monthIndex(date);
  const upto = entry.win.filter((trade) => trade.deal_date <= date);
  const before = upto.filter((trade) => trade.deal_date < date);
  const prevMax = prevMaxWon === null || prevMaxWon === undefined ? null : Number(prevMaxWon);
  const latest = before.reduce((best, trade) => (!best || trade.deal_date > best.deal_date || (trade.deal_date === best.deal_date && trade.trade_key > best.trade_key) ? trade : best), null) ?? entry.last ?? null;
  const series = [];
  for (let index = month - (months - 1); index <= month; index += 1) {
    const ym = ymOf(index);
    const inMonth = upto.filter((trade) => trade.deal_date.slice(0, 7) === ym);
    const prices = inMonth.map((trade) => trade.price_won).filter((won) => won !== null && won !== undefined).map(Number);
    series.push({ ym, medianWon: medianWon(prices), count: inMonth.length });
  }
  const recent3m = upto.filter((trade) => monthIndex(trade.deal_date) > month - recentMonths).length;
  return {
    series,
    prev: latest ? { dealDate: latest.deal_date, floor: latest.floor ?? null, priceWon: latest.price_won === null || latest.price_won === undefined ? null : Number(latest.price_won) } : null,
    prevMaxWon: prevMax,
    ratioPct: ratioPct(row.price_won === null ? null : Number(row.price_won), prevMax),
    recent3m,
  };
}

function entriesOf(insightRows) {
  const byGroup = new Map();
  for (const item of insightRows) {
    const key = groupKey(item.cmp_seq, item.area_x100);
    if (!byGroup.has(key)) byGroup.set(key, { max: null, last: null, win: [] });
    const entry = byGroup.get(key);
    if (item.part === "max") entry.max = item.price_won ?? null;
    else if (item.part === "last") entry.last = item;
    else entry.win.push(item);
  }
  return byGroup;
}

// GET /work/realprice/insights. 돌려주는 값: { items(보낸 순서, 찾은 것만), missing, basis, recordHighReady, warnings }
export async function readRealpriceInsights(db, params, { nowMs }) {
  const ids = parseInsightIds(params);
  const context = await readTradesContext(db, nowMs);
  const result = await db.prepare(REALPRICE_TRADES_BY_IDS_SQL).bind(JSON.stringify(ids)).all();
  let rowsRead = rowsReadOf(result);
  const byKey = new Map((result.results ?? []).map((row) => [row.trade_key, row]));
  const found = ids.filter((id) => byKey.has(id)).map((id) => byKey.get(id));
  const warnings = [];
  if (context.readSoftExceeded) warnings.push({ code: "RT_READ_BUDGET", level: "soft" });
  // 신고가와 같이 구마다 판정 준비를 본다(0008). 준비 전 구의 거래는 pending, 하루 읽기 첫 상한을 넘은 날은 budget.
  const blockedOf = (row) => (context.enabledFor(row.lawd_cd) ? null : context.readSoftExceeded ? "budget" : "pending");
  const targets = found.filter((row) => blockedOf(row) === null && insightSkipReason(row) === null);

  let entries = new Map();
  let prevMaxList = [];
  const households = new Map();
  if (targets.length > 0) {
    const insights = await db.prepare(REALPRICE_INSIGHTS_SQL).bind(JSON.stringify(insightGroups(targets))).all();
    rowsRead += rowsReadOf(insights);
    entries = entriesOf(insights.results ?? []);
    // 신고가(22.8)와 같은 함수: 창 앞 최고 1행(deal_date null) + 창 안 거래를 previousMaxByRow에 넘긴다.
    const priorRows = (insights.results ?? []).filter((item) => item.part !== "last").map((item) => (item.part === "max" ? { ...item, deal_date: null } : item));
    prevMaxList = previousMaxByRow(targets, priorRows);
    const aptSeqs = [...new Set(targets.map((row) => row.apt_seq).filter(Boolean))];
    if (aptSeqs.length > 0) {
      const watch = await db.prepare(REALPRICE_INSIGHT_WATCH_SQL).bind(JSON.stringify(aptSeqs)).all();
      rowsRead += rowsReadOf(watch);
      for (const item of watch.results ?? []) if (HOUSEHOLDS.has(item.complex_slug)) households.set(item.apt_seq, HOUSEHOLDS.get(item.complex_slug));
    }
  }
  await addReadUsage(db, nowMs, 1 + rowsReadOf(context.monthsResult) + rowsRead);

  const targetKeys = new Set(targets.map((row) => row.trade_key));
  const items = found.map((row) => {
    if (blockedOf(row)) return { tradeKey: row.trade_key, available: false, reason: blockedOf(row) };
    if (!targetKeys.has(row.trade_key)) return { tradeKey: row.trade_key, available: false, reason: insightSkipReason(row) };
    const entry = entries.get(groupKey(row.cmp_seq, row.area_x100)) ?? { max: null, last: null, win: [] };
    return { tradeKey: row.trade_key, available: true, ...insightFor(row, entry, prevMaxList[targets.indexOf(row)]), households: households.get(row.apt_seq) ?? null };
  });
  return {
    items,
    missing: ids.filter((id) => !byKey.has(id)),
    basis: { months: REALPRICE_INSIGHT_MONTHS, recentMonths: REALPRICE_INSIGHT_RECENT_MONTHS },
    recordHighReady: found.every((row) => context.recordHighLawds.includes(row.lawd_cd)),
    warnings,
  };
}
