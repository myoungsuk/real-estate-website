// 실거래가 단지 상세 칸(2026-11-25) 화면 순수 함수: 머리 글자, 면적 탭 글자, 최근 거래·직전·숫자 칸, 최근 거래 줄, 막힌 까닭 글.
// 서버 요청·브라우저 저장·주소 변경은 하지 않는다(src/lib/work 공통 규칙). 응답 모양은 worker/realprice-complex.mjs를 따른다.
// 2026-11-20 운영자 결정을 그대로 따른다: '평'은 쓰지 않고(평형 최고 대신 '○○㎡대 최고'), 84.97㎡와 84.98㎡는 따로 보며, 최고가 대비는 '앞선 최고 기준'이다.
import { formatKoreanWon } from "./work-format.mjs";
import { areaText, dateText, floorText } from "./realprice-view.mjs";
import { INSIGHT_COMPARE_FROM_TEXT, INSIGHT_REASON_TEXT } from "./realprice-insight-view.mjs";

// 서버 상수와 같은 값(tests/work-realprice-complex-view.test.mjs가 worker 상수와 대조한다).
export const COMPLEX_MONTHS = 36; // REALPRICE_COMPLEX_MONTHS
export const COMPLEX_RECENT_MAX = 20; // REALPRICE_COMPLEX_RECENT_MAX
export const COMPLEX_APT_PATTERN = /^[0-9A-Za-z-]{1,20}$/u; // APT_SEQ_PATTERN('*' 제외)
export const COMPLEX_FLOW_RULE = `${COMPLEX_MONTHS}개월 월별 가운데 값 · 같은 단지·같은 전용면적 · 해제·직거래 빼고`;

export const COMPLEX_BLOCKED_TEXT = Object.freeze({
  budget: "오늘 조회가 많아 단지 상세를 잠시 껐습니다. 한국 시각 오전 9시 뒤에 다시 보입니다.",
  pending: "과거 자료를 채우는 중이라 단지 상세를 아직 계산하지 않습니다. 채우기가 끝나면 보입니다.",
});
export const COMPLEX_EMPTY_TEXT = "이 단지의 매매 자료가 없습니다.";
export const COMPLEX_ERROR_TEXT = "단지 상세를 불러오지 못했습니다. 잠시 뒤 다시 눌러 보세요.";
export const COMPLEX_PARTIAL_TEXT = "거래가 많아 최근 거래부터 일부만 읽었습니다. 최고·흐름은 읽은 범위 기준입니다.";

// 단지 상세를 열 수 있는 거래(단지 고유번호가 있고 모호한 '*'가 아님).
export const canOpenComplex = (item) => typeof item?.aptSeq === "string" && item.aptSeq !== "*" && COMPLEX_APT_PATTERN.test(item.aptSeq);

// 화면 메모리 열쇠(단지 + 면적). 면적을 넣지 않은 요청은 빈 면적.
export const complexCacheKey = (aptSeq, areaM2) => `${aptSeq}|${areaM2 === null || areaM2 === undefined ? "" : Number(areaM2).toFixed(2)}`;

// 업무 API 요청 글(apt는 형식 검사를 통과한 것만).
export function complexQuery(aptSeq, areaM2) {
  if (!COMPLEX_APT_PATTERN.test(String(aptSeq ?? "")) || aptSeq === "*") return null;
  const area = Number(areaM2);
  return Number.isFinite(area) && area > 0 ? `apt=${encodeURIComponent(aptSeq)}&area=${area.toFixed(2)}` : `apt=${encodeURIComponent(aptSeq)}`;
}

const dealingText = (gbn) => (gbn === "direct" ? "직거래" : gbn === "broker" ? "중개거래" : "");
const won = (value) => (Number.isSafeInteger(value) ? formatKoreanWon(value) : null);

// 머리: 단지 이름 아래 한 줄(동네·준공 연도·세대수). 자료에 없는 칸은 뺀다.
export function complexHead(complex, fallback = {}) {
  const name = complex?.aptName || fallback.aptName || "단지명 없음";
  const sub = [
    complex?.umdName || fallback.umdName || null,
    Number.isInteger(complex?.buildYear) && complex.buildYear > 1900 ? `${complex.buildYear}년 준공` : null,
    Number.isSafeInteger(complex?.households) && complex.households > 0 ? `${complex.households.toLocaleString("ko-KR")}세대` : null,
  ].filter(Boolean);
  return { name, sub: sub.join(" · ") };
}

// 면적 탭 글자: 전용면적(소수 둘째 자리)과 해제 아닌 매매 건수.
export const areaTab = (area) => ({ label: areaText(area.areaM2), count: `${Number(area.tradeCount ?? 0).toLocaleString("ko-KR")}건`, areaM2: area.areaM2 });

// 고른 면적의 최근 거래 머리(큰 금액·한 줄 설명·직전 거래).
export function latestView(area) {
  const latest = area?.latest;
  if (!latest) return null;
  const meta = [floorText(latest.floor), dateText(latest.dealDate), dealingText(latest.dealingGbn)].filter(Boolean).join(" · ");
  const prev = area.prev && Number.isSafeInteger(area.prev.priceWon) ? area.prev : null;
  let change = null;
  if (prev && Number.isSafeInteger(latest.priceWon)) {
    const diff = latest.priceWon - prev.priceWon;
    change = diff === 0 ? "직전과 같음" : `직전보다 ${diff > 0 ? "▲" : "▼"} ${formatKoreanWon(Math.abs(diff)).replace(/ 원$/u, "")}`;
  }
  return {
    price: won(latest.priceWon) ?? "금액 없음",
    meta,
    high: latest.recordHigh === true,
    prevLine: prev
      ? `직전 거래 ${[dateText(prev.dealDate), floorText(prev.floor), formatKoreanWon(prev.priceWon)].filter(Boolean).join(" · ")}`
      : `직전 거래 없음(${INSIGHT_COMPARE_FROM_TEXT} 이후)`,
    change,
  };
}

// 숫자 칸(값이 없는 칸은 빼지 않고 '없음'으로 둔다. 다만 ㎡대 최고는 면적이 하나뿐이면 이 면적 최고와 같으므로 뺀다).
export function statsView(area) {
  if (!area) return [];
  const ratio = typeof area.ratioPct === "number" && Number.isFinite(area.ratioPct) ? area.ratioPct : null;
  const up = ratio !== null && (area.latest?.recordHigh === true || ratio > 100);
  let ratioValue;
  if (ratio !== null) ratioValue = `${up ? "▲ " : ""}${ratio.toFixed(1)}%`;
  else if (area.ratioSkip) ratioValue = INSIGHT_REASON_TEXT[area.ratioSkip] ?? "계산 안 함";
  else ratioValue = "첫 거래";
  const stats = [
    { key: "ratio", label: "최고가 대비", value: ratioValue, note: Number.isSafeInteger(area.prevMaxWon) ? `앞선 최고 ${formatKoreanWon(area.prevMaxWon)}` : null, up },
    { key: "recent", label: "최근 3개월 거래", value: `${Number(area.recent3m ?? 0).toLocaleString("ko-KR")}건`, note: "이번 달 포함" },
    { key: "type", label: "이 면적 최고", value: won(area.typeMaxWon) ?? "없음", note: areaText(area.areaM2) },
  ];
  if (Number(area.bandTypes) > 1) {
    stats.push({ key: "band", label: `${area.bandM2}㎡대 최고`, value: won(area.bandMaxWon) ?? "없음", note: `${area.bandM2}㎡대 면적 ${area.bandTypes}가지` });
  }
  stats.push({ key: "date", label: "최고 거래일", value: area.typeMaxDate ? dateText(area.typeMaxDate) : "없음", note: "이 면적 최고 기준" });
  return stats;
}

// 최근 거래 한 줄. picked: 목록에서 누른 거래 ID(그 줄에 '누른 거래' 표시).
/**
 * @param {{ tradeKey: string; dealDate: string; floor: number | null; priceWon: number | null; dealingGbn: string | null; cancelled: boolean; recordHigh: boolean }} item
 * @param {{ picked?: string | null }} [options]
 */
export function recentRow(item, { picked = null } = {}) {
  const tags = [];
  if (item.cancelled) tags.push({ key: "cancel", text: "해제" });
  if (item.dealingGbn === "direct") tags.push({ key: "direct", text: "직거래" });
  if (item.recordHigh) tags.push({ key: "high", text: "신고가" });
  return {
    tradeKey: item.tradeKey,
    date: dateText(item.dealDate),
    floor: floorText(item.floor),
    price: won(item.priceWon) ?? "금액 없음",
    tags,
    current: picked !== null && item.tradeKey === picked,
    cancelled: item.cancelled === true,
  };
}

// 흐름 그림 아래 글(거래가 있는 달 수).
export function flowNote(series) {
  const months = (Array.isArray(series) ? series : []).filter((month) => Number.isSafeInteger(month?.medianWon)).length;
  if (months < 2) return "흐름은 거래가 있는 달이 두 달 이상일 때 그립니다";
  return `최근 ${COMPLEX_MONTHS}개월 가운데 거래 있는 달 ${months}개`;
}

// 흐름 그림 가로 눈금(처음·가운데·끝 달).
export function flowTicks(series) {
  const slots = Array.isArray(series) ? series : [];
  if (slots.length < 2) return [];
  const pick = [0, Math.floor((slots.length - 1) / 2), slots.length - 1];
  return pick.map((index) => {
    const [year, month] = String(slots[index].ym).split("-");
    return { index, text: `${year.slice(2)}.${month}` };
  });
}

// '홍보물에 담기' 단추 상태. count: 지금 담은 수, max: 최대, has: 이 거래를 담았는지.
export function pickButtonState(latest, { has, count, max }) {
  if (!latest) return { disabled: true, text: "홍보물에 담기", note: "담을 거래 없음" };
  if (has) return { disabled: false, text: "담음 · 빼기", note: null };
  if (count >= max) return { disabled: true, text: "홍보물에 담기", note: `최대 ${max}건까지 담을 수 있습니다` };
  return { disabled: false, text: "홍보물에 담기", note: null };
}
