// 최근 거래 완료 소식(공개 JSON src/data/deal-news.json)에서 공개 화면과 관리자 화면이 같이 쓰는 부분.
// - 이 파일은 공개 화면(홈)도 가져다 쓰므로 관리자 전용 경로(src/lib/work/ 등)를 가져오지 않는다(tests/indexnow.test.mjs가 봄).
//   꼴 검사·넣는 순간 판정은 관리자 전용 src/lib/admin-deal-news.mjs에 있다.
// - 칸은 아래 DEAL_NEWS_KEYS 8개뿐이다. 금액·동·층·호수·날짜·손님 정보를 넣을 칸이 없고, 다른 칸은 검사가 거절한다.
// - 배열 순서가 올린 순서다(뒤에 붙임, 끝이 가장 새 것). 날짜·시각 칸이 없으므로 공개 화면은 배열을 뒤집어 새 것부터 보인다.
// - 거래 종류 이름·안내 한 줄은 홍보 종이(src/lib/work/promo-paper.mjs)의 DONE_DEAL_TYPES·DONE_GUARD와 같아야 한다(시험이 대조).

export const DEAL_NEWS_PUBLIC_MAX = 5; // 화면에 보이는 수 = published로 둘 수 있는 수

export const DEAL_NEWS_KEYS = Object.freeze(["id", "status", "placeKind", "umdName", "complexName", "propertyKind", "dealType", "areaBand"]);
export const DEAL_NEWS_STATUSES = Object.freeze(["draft", "published"]);
// complex: 단지 이름으로 올림(아파트만) / area: 동네 이름으로 올림("천동 아파트")
export const DEAL_NEWS_PLACE_KINDS = Object.freeze(["complex", "area"]);
export const DEAL_NEWS_PROPERTY_KINDS = Object.freeze([
  Object.freeze({ value: "apartment", label: "아파트" }),
  Object.freeze({ value: "villa", label: "빌라" }),
  Object.freeze({ value: "officetel", label: "오피스텔" }),
  Object.freeze({ value: "house", label: "주택" }),
  Object.freeze({ value: "shop", label: "상가" }),
]);
export const DEAL_NEWS_DEAL_TYPES = Object.freeze([
  Object.freeze({ value: "sale", label: "매매" }),
  Object.freeze({ value: "jeonse", label: "전세" }),
  Object.freeze({ value: "monthly-rent", label: "월세" }),
]);
// 전용면적대(㎡ 정수 내림)의 범위. 홍보 종이 DONE_LIMITS.areaMin·areaMax와 같다.
export const DEAL_NEWS_AREA_BAND = Object.freeze({ min: 10, max: 400 });
export const DEAL_NEWS_TITLE = "최근 거래 완료 소식";
export const DEAL_NEWS_GUARD = "거래하신 분을 위해 가격·동·층·계약 날짜는 싣지 않습니다.";

const labelOf = (list, value) => list.find((entry) => entry.value === value)?.label ?? "";

export const dealNewsPropertyLabel = (value) => labelOf(DEAL_NEWS_PROPERTY_KINDS, value);
export const dealNewsDealLabel = (value) => labelOf(DEAL_NEWS_DEAL_TYPES, value);
// 84 → "전용 84㎡대". 홍보 종이 areaBandText("84.97")와 같은 글이다.
export const dealNewsAreaText = (areaBand) => `전용 ${areaBand}㎡대`;

// 소식 한 줄. complex: "리더스시티 4블록 · 전용 84㎡대 · 매매" / area: "천동 아파트 · 전용 84㎡대 · 매매"
// 검사를 통과한 항목만 넣는다(빌드 전 검증·관리자 저장 검증이 먼저 막음).
export function dealNewsLine(item) {
  const place = item.placeKind === "complex" ? item.complexName : `${item.umdName} ${dealNewsPropertyLabel(item.propertyKind)}`;
  const area = dealNewsAreaText(item.areaBand);
  const deal = dealNewsDealLabel(item.dealType);
  return { place, area, deal, text: `${place} · ${area} · ${deal}` };
}

// 공개 화면에 보일 목록: published만, 새 것부터, 최대 DEAL_NEWS_PUBLIC_MAX건. 0건이면 빈 배열(칸을 그리지 않음).
export function publicDealNews(items) {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item) => item?.status === "published")
    .reverse()
    .slice(0, DEAL_NEWS_PUBLIC_MAX)
    .map((item) => ({ id: item.id, ...dealNewsLine(item) }));
}
