// 실거래가 거래 흐름(보드 63번) 화면 순수 함수: 흐름선 좌표, 직전 거래·최고가 대비·3개월 글자, 읽을 거래 고르기, 홍보물 기준 줄.
// 서버 요청·브라우저 저장·주소 변경은 하지 않는다(src/lib/work 공통 규칙, T0-115). 응답 모양은 worker/realprice-insights.mjs를 따른다.
// 2026-11-20 운영자 결정: 최고가 대비 = '앞선 최고 기준'(신고가는 100%를 넘음), 흐름 12개월, 세대수는 운영자가 연결한 단지만, '평'은 쓰지 않는다.
import { formatKoreanWon } from "./work-format.mjs";
import { dateText, floorText } from "./realprice-view.mjs";

// 서버 상수와 같은 값(tests/work-realprice-insight-view.test.mjs가 worker 상수와 대조한다).
export const INSIGHT_IDS_MAX = 30; // REALPRICE_INSIGHT_IDS_MAX
export const INSIGHT_MONTHS = 12; // REALPRICE_INSIGHT_MONTHS
export const INSIGHT_COMPARE_FROM_TEXT = "2006년 1월"; // REALPRICE_START_MONTHS.sale
export const INSIGHT_BASIS = "같은 단지·같은 전용면적";
export const INSIGHT_FLOW_RULE = `흐름선: ${INSIGHT_MONTHS}개월 월별 가운데 값`;
export const INSIGHT_REAL_RULE = "최고·직전: 실제 거래";
export const INSIGHT_ONE_MONTH_NOTE = "흐름선은 거래가 있는 달이 두 달 이상일 때 그립니다";

// 계산하지 않은 까닭(available:false) → 화면 글자. budget·pending은 빈 칸으로 두지 않고 그 뜻을 쓴다(날개대장 조건 2).
export const INSIGHT_REASON_TEXT = Object.freeze({
  not_sale: "매매만 계산",
  cancelled: "해제 거래는 계산 안 함",
  direct: "직거래는 계산 안 함",
  no_complex: "단지 번호 없음",
  pending: "과거 자료 채우는 중",
  budget: "오늘 조회 한도",
  error: "불러오지 못함",
});
export const INSIGHT_BUDGET_NOTICE = "오늘 조회가 많아 흐름·직전 거래 표시를 잠시 껐습니다. 한국 시각 오전 9시 뒤에 다시 보입니다. 목록은 그대로 볼 수 있습니다.";
export const INSIGHT_ERROR_NOTICE = "흐름·직전 거래를 불러오지 못했습니다. 목록은 그대로 볼 수 있습니다. 잠시 뒤 화면을 새로 고치면 다시 불러옵니다.";

// 서버에 물어볼 만한 거래(매매·해제 아님·직거래 아님)인지. 나머지는 서버도 계산하지 않으므로 묻지 않는다.
export const isInsightCandidate = (item) => item?.kind === "sale" && item.cancelled !== true && item.dealingGbn !== "direct";

// 아직 읽지 않은 거래 ID를 30개씩 묶는다(같은 ID는 한 번, 보이는 순서).
export function insightBatches(items, known, max = INSIGHT_IDS_MAX) {
  const ids = [...new Set(items.filter(isInsightCandidate).map((item) => item.tradeKey).filter((key) => !known.has(key)))];
  const batches = [];
  for (let at = 0; at < ids.length; at += max) batches.push(ids.slice(at, at + max));
  return batches;
}

const shortDate = (isoDate) => `${Number(isoDate.slice(5, 7))}. ${Number(isoDate.slice(8, 10))}.`;
const pctText = (ratio) => `${ratio.toFixed(1)}%`;

// 흐름선 좌표. 거래가 있는 달만 이어 긋고(빈 달은 건너뜀) x는 12칸 자리 그대로. 거래 있는 달이 2개 미만이면 null.
// maxWon을 주면 그 높이도 세로 범위에 넣고 점선 높이(maxY)를 돌려준다(점선은 월별 가운데 값이 아니라 실제 최고 거래 금액).
// prevYm을 주면 그 달 점(직전 거래 달)을 빈 점 자리로 돌려준다.
/**
 * @param {{ ym: string; medianWon: number | null }[] | undefined} series
 * @param {{ width: number; height: number; padX?: number; padTop?: number; padBottom?: number; maxWon?: number | null; prevYm?: string | null }} options
 * @returns {{ line: string; area: string; end: { ym: string; x: number; y: number }; prev: { ym: string; x: number; y: number } | null; maxY: number | null; months: number } | null}
 */
export function sparkGeometry(series, { width, height, padX = 6, padTop = 6, padBottom = 6, maxWon = null, prevYm = null }) {
  const slots = Array.isArray(series) ? series : [];
  const points = slots.map((month, index) => ({ index, ym: month?.ym, won: month?.medianWon })).filter((point) => Number.isSafeInteger(point.won));
  if (points.length < 2 || slots.length < 2) return null;
  const values = points.map((point) => point.won);
  if (Number.isSafeInteger(maxWon)) values.push(maxWon);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const x = (index) => padX + (index * (width - padX * 2)) / (slots.length - 1);
  const y = (won) => (hi === lo ? (padTop + height - padBottom) / 2 : padTop + (1 - (won - lo) / span) * (height - padTop - padBottom));
  const xy = points.map((point) => ({ ym: point.ym, x: round(x(point.index)), y: round(y(point.won)) }));
  const line = xy.map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`).join(" ");
  const base = round(height - padBottom);
  const end = xy[xy.length - 1];
  const area = `${line} L${end.x},${base} L${xy[0].x},${base} Z`;
  const prev = prevYm ? xy.find((point) => point.ym === prevYm) ?? null : null;
  return { line, area, end, prev, maxY: Number.isSafeInteger(maxWon) ? round(y(maxWon)) : null, months: points.length };
}
const round = (value) => Math.round(value * 10) / 10;

// 한 거래의 화면 글자. insight: 서버 items[] 한 개(또는 { available:false, reason }). high: 그 거래가 신고가로 표시되는지(trades의 recordHigh).
export function insightView(insight, { high = false } = {}) {
  if (!insight || insight.available !== true) {
    const reason = insight?.reason ?? "error";
    return { available: false, reason, reasonText: INSIGHT_REASON_TEXT[reason] ?? INSIGHT_REASON_TEXT.error };
  }
  const prev = insight.prev && Number.isSafeInteger(insight.prev.priceWon) ? insight.prev : null;
  const ratio = typeof insight.ratioPct === "number" && Number.isFinite(insight.ratioPct) ? insight.ratioPct : null;
  // 신고가 비율(100% 넘음)은 '▲'와 함께 쓴다(날개대장 시안 고칠 것 3).
  const up = ratio !== null && (high || ratio > 100);
  const ratioText = ratio === null ? "첫 거래" : `${up ? "▲ " : ""}${pctText(ratio)}`;
  const months = (insight.series ?? []).filter((month) => Number.isSafeInteger(month?.medianWon)).length;
  return {
    available: true,
    reason: null,
    up,
    ratioText,
    ratioLabel: ratio === null ? "앞선 같은 면적 매매 없음" : "앞선 최고 대비",
    maxWon: Number.isSafeInteger(insight.prevMaxWon) ? insight.prevMaxWon : null,
    maxText: Number.isSafeInteger(insight.prevMaxWon) ? formatKoreanWon(insight.prevMaxWon) : null,
    prevPrice: prev ? formatKoreanWon(prev.priceWon) : null,
    prevSub: prev ? [shortDate(prev.dealDate), floorText(prev.floor)].filter(Boolean).join(" · ") : null,
    prevLine: prev
      ? `직전 거래 ${[dateText(prev.dealDate), floorText(prev.floor), formatKoreanWon(prev.priceWon)].filter(Boolean).join(" · ")}`
      : `직전 거래 없음(${INSIGHT_COMPARE_FROM_TEXT} 이후)`,
    prevYm: prev ? prev.dealDate.slice(0, 7) : null,
    recentText: `${Number(insight.recent3m ?? 0).toLocaleString("ko-KR")}건`,
    months,
    chartNote: months >= 2 ? null : INSIGHT_ONE_MONTH_NOTE,
    summary: ratio === null ? "흐름·직전 거래" : `흐름·직전 거래 · 대비 ${ratioText}`,
    households: Number.isSafeInteger(insight.households) && insight.households > 0 ? insight.households : null,
  };
}

// 홍보물 그림 한 건 자료. 계산하지 못한 거래는 null(그 거래는 지금 모양 그대로 그림, 날개대장 조건 4).
// 직전 거래가 없으면 그 줄을 빼고, 앞선 최고가 없으면 그 칸과 최고가 대비 칸을 뺀다(0·빈 값을 그리지 않음).
export function promoFlow(insight, { high = false, buildYear = null } = {}) {
  const view = insightView(insight, { high });
  if (!view.available) return null;
  const stats = [];
  if (view.maxText) stats.push({ label: "앞선 최고", value: view.maxText.replace(/ 원$/u, "") });
  if (view.maxText) stats.push({ label: "최고가 대비", value: view.ratioText });
  stats.push({ label: "최근 3개월", value: view.recentText });
  const sub = [
    Number.isInteger(buildYear) && buildYear > 1900 ? `${buildYear}년 준공` : null,
    view.households ? `${view.households.toLocaleString("ko-KR")}세대` : null,
  ].filter(Boolean);
  return {
    series: insight.series,
    chart: view.months >= 2,
    maxWon: view.maxWon,
    prevYm: view.prevYm,
    prevLine: view.prevPrice ? view.prevLine : "",
    prevShort: view.prevPrice ? view.prevPrice.replace(/ 원$/u, "") : "",
    stats,
    strip: [view.prevPrice ? `직전 ${view.prevPrice.replace(/ 원$/u, "")}` : null, view.maxText ? `최고가 대비 ${view.ratioText}` : null, `3개월 ${view.recentText}`].filter(Boolean).join(" · "),
    sub,
    real: Boolean(view.prevPrice || view.maxText),
  };
}

// 홍보물 기준 줄: 실제로 그린 항목만 적는다(날개대장 조건 4·시안 고칠 것 1). 그린 흐름이 없으면 빈 글자.
export function promoBasisLine(flows) {
  const drawn = flows.filter(Boolean);
  if (drawn.length === 0) return "";
  const parts = [];
  if (drawn.some((flow) => flow.chart)) parts.push(INSIGHT_FLOW_RULE);
  if (drawn.some((flow) => flow.real)) parts.push(INSIGHT_REAL_RULE);
  if (parts.length === 0) parts.push("최근 3개월: 계약일 기준 거래 수");
  return `${INSIGHT_BASIS} · ${parts.join(" · ")}`;
}
