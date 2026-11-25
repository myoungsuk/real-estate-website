// 최근 거래 완료 소식의 꼴 검사와 '넣는 순간' 판정(관리자 전용, 순수 함수. 서버 요청·저장·브라우저 저장소 없음).
// 공개 화면이 쓰는 목록·한 줄 글은 src/lib/deal-news.mjs에 있다(공개 화면은 이 파일을 가져오지 않는다).
// - 꼴 검사 validateDealNews(): 빌드 전 검증(scripts/content-validation.mjs)·관리자 저장 검증(worker/admin-resource-validation.mjs)·화면이 같이 쓴다.
//   허용 칸 8개 밖의 키(금액·동·층·호수·날짜·손님 칸)는 거절하고, 단지 이름 안의 동 번호·호수·층·전화·날짜·금액 꼴도 거절한다.
// - 판정 judgeDealNews(): 계약일·잔금 여부·건수·실거래 자료 확인은 넣는 순간 화면에서만 보고 **어디에도 저장하지 않는다**.
//   그래서 JSON을 직접 고친 커밋·변경 이력 복원·content/validate는 꼴만 보고 이 판정을 거치지 않는다(막는 것은 화면 한 겹).
//   공개 저장소에는 draft도 그대로 올라가므로, 화면은 '올릴 수 없는' 거래를 draft로도 저장하게 하면 안 된다.
// - 날짜는 한국 날짜 'YYYY-MM-DD' 문자열로만 계산한다(시각·시간대 없음).
import { DONE_NAME_PATTERNS, areaBandText } from "./work/promo-paper.mjs";
import { findDateText } from "./work/paper-parts.mjs";
import { REALPRICE_BASE_LAWD, realpriceRegion } from "./work/realprice-regions.mjs";
import {
  DEAL_NEWS_AREA_BAND,
  DEAL_NEWS_DEAL_TYPES,
  DEAL_NEWS_KEYS,
  DEAL_NEWS_PLACE_KINDS,
  DEAL_NEWS_PROPERTY_KINDS,
  DEAL_NEWS_PUBLIC_MAX,
  DEAL_NEWS_STATUSES,
} from "./deal-news.mjs";

// ── 기준 숫자(사용자 결정 2026-11-25 15:20:21) ──
export const DEAL_NEWS_WAIT_DAYS = 60; // 올릴 수 있는 때: 계약일에서 60일이 지난 뒤(61일째부터)
export const DEAL_NEWS_COUNT_MONTHS = 6; // 단지 이름 건수를 세는 구간: 오늘에서 6개월 전 ~ 오늘(양 끝 포함)
export const DEAL_NEWS_MIN_COUNT = 3; // 그 구간에 같은 단지·같은 전용면적대·같은 거래 종류가 3건 이상일 때만 단지 이름
export const DEAL_NEWS_COMPLEX_PROPERTY_KIND = "apartment"; // 단지 이름은 아파트만
export const DEAL_NEWS_NAME_MAX = 30;
export const DEAL_NEWS_ID_PATTERN = /^dn-[0-9a-f]{16}$/u;
// 동네 이름으로 쓸 수 있는 곳: 대전 동구 법정동(실거래가 지역 목록과 한 곳).
export const DEAL_NEWS_UMD_NAMES = realpriceRegion(REALPRICE_BASE_LAWD).umdNames;

const valuesOf = (list) => list.map((entry) => entry.value);
const PROPERTY_VALUES = valuesOf(DEAL_NEWS_PROPERTY_KINDS);
const DEAL_VALUES = valuesOf(DEAL_NEWS_DEAL_TYPES);
const DAY_MS = 24 * 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

// ── 날짜(문자열) 계산 ──
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const toUtc = (date) => {
  const match = DATE_PATTERN.exec(typeof date === "string" ? date : "");
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const ms = Date.UTC(year, month - 1, day);
  const parsed = new Date(ms);
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day ? ms : null;
};
const fromUtc = (ms) => new Date(ms).toISOString().slice(0, 10);

export const isDealNewsDate = (value) => toUtc(value) !== null;
// 서버·화면 시계(ms)의 한국 날짜.
export const dealNewsToday = (nowMs) => fromUtc(nowMs + KST_OFFSET_MS);

function addDays(date, days) {
  return fromUtc(toUtc(date) + days * DAY_MS);
}

// 같은 날짜의 n개월 앞. 그 달에 그 날이 없으면 그 달 마지막 날(8월 31일의 6개월 앞 = 2월 28일·29일).
function monthsBefore(date, months) {
  const [year, month, day] = date.split("-").map(Number);
  const index = year * 12 + (month - 1) - months;
  const targetYear = Math.floor(index / 12);
  const targetMonth = index % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return fromUtc(Date.UTC(targetYear, targetMonth, Math.min(day, lastDay)));
}

// 올릴 수 있게 되는 첫날(계약일 + 61일). 딱 60일째 날은 아직 올릴 수 없다.
export function dealNewsPublishableFrom(contractDate) {
  return isDealNewsDate(contractDate) ? addDays(contractDate, DEAL_NEWS_WAIT_DAYS + 1) : null;
}

// 단지 이름 건수를 세는 계약일 구간(양 끝 포함): 오늘에서 6개월 전 ~ 오늘. 서버(건수 API)가 서버 시계의 오늘로 부른다.
export function dealNewsCountWindow(today) {
  if (!isDealNewsDate(today)) return null;
  return { from: monthsBefore(today, DEAL_NEWS_COUNT_MONTHS), to: today };
}

// ── 단지 이름 검사 ──
// 금액 꼴: "3억"·"5.2억"·"삼억"·"2,500만"·"5천만"·"3천"·"4500만원"·"만원"·"3000원". 동네·단지 이름에 흔한 "천동"·"천년"·"원동"·"원룸"은 뺀다.
const MONEY_LIKE = /[\d일이삼사오육칠팔구십백천]\s*억|[\d일이삼사오육칠팔구]\s*(?:천|백)\s*만|만\s*원|\d[\d,.]*\s*(?:만|천(?!동|년)|원(?!동|룸))/u;
// 번호 꼴: 세 자리 이상 숫자("1203"), 숫자-숫자("104-1203"), 쉼표 낀 숫자("2,500"). 동·호수·금액·날짜를 글자 없이 적는 길을 막는다.
const NUMBER_LIKE = /\d{3,}|\d\s*[-~.,/]\s*\d/u;
const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/u;

// 단지 이름에 넣을 수 없는 것이 있으면 까닭 문장, 없으면 null. 전각 숫자 같은 글자는 NFKC로 바꿔서 본다.
export function dealNewsNameProblem(name) {
  if (typeof name !== "string" || name === "") return "단지 이름이 필요합니다.";
  if (CONTROL_OR_FORMAT.test(name) || name !== name.trim() || /\s{2,}/u.test(name)) return "단지 이름의 앞뒤·겹친 공백과 보이지 않는 글자를 지워 주세요.";
  if ([...name].length > DEAL_NEWS_NAME_MAX) return `단지 이름은 ${DEAL_NEWS_NAME_MAX}자까지입니다.`;
  const text = name.normalize("NFKC");
  if (DONE_NAME_PATTERNS.unit.test(text) || DONE_NAME_PATTERNS.dong.test(text) || DONE_NAME_PATTERNS.floor.test(text)) return "단지 이름에는 동 번호·호수·층을 넣지 않습니다.";
  if (DONE_NAME_PATTERNS.mobile.test(text)) return "단지 이름에는 전화번호를 넣지 않습니다.";
  if (findDateText([text]).length > 0) return "단지 이름에는 날짜를 넣지 않습니다.";
  if (MONEY_LIKE.test(text)) return "단지 이름에는 금액을 넣지 않습니다.";
  if (NUMBER_LIKE.test(text)) return "단지 이름에는 세 자리 이상 숫자나 숫자-숫자 꼴(동·호수·금액으로 읽힐 수 있음)을 넣지 않습니다.";
  return null;
}

// ── 꼴 검사(오류 문장 배열, 없으면 빈 배열) ──
export function validateDealNews(items) {
  if (!Array.isArray(items)) return ["dealNews: 배열이어야 합니다."];
  const errors = [];
  const ids = new Set();
  let published = 0;
  items.forEach((item, index) => {
    const path = `dealNews[${index}]`;
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      errors.push(`${path}: 소식 하나는 객체여야 합니다.`);
      return;
    }
    for (const key of Object.keys(item)) {
      if (!DEAL_NEWS_KEYS.includes(key)) errors.push(`${path}.${key}: 허용되지 않은 칸입니다(금액·동·층·호수·날짜·손님 정보 칸은 만들 수 없습니다).`);
    }
    if (typeof item.id !== "string" || !DEAL_NEWS_ID_PATTERN.test(item.id)) errors.push(`${path}.id: 'dn-' 뒤에 16진수 16자인 무작위 값이 필요합니다.`);
    else if (ids.has(item.id)) errors.push(`${path}.id: 중복 ID입니다.`);
    ids.add(item.id);
    if (!DEAL_NEWS_STATUSES.includes(item.status)) errors.push(`${path}.status: draft 또는 published여야 합니다.`);
    if (item.status === "published") published += 1;
    if (!DEAL_NEWS_UMD_NAMES.includes(item.umdName)) errors.push(`${path}.umdName: 대전 동구 법정동 이름이어야 합니다.`);
    if (!PROPERTY_VALUES.includes(item.propertyKind)) errors.push(`${path}.propertyKind: 정해 둔 건물 종류여야 합니다.`);
    if (!DEAL_VALUES.includes(item.dealType)) errors.push(`${path}.dealType: sale·jeonse·monthly-rent 중 하나여야 합니다.`);
    if (!Number.isInteger(item.areaBand) || item.areaBand < DEAL_NEWS_AREA_BAND.min || item.areaBand > DEAL_NEWS_AREA_BAND.max) {
      errors.push(`${path}.areaBand: ${DEAL_NEWS_AREA_BAND.min} ~ ${DEAL_NEWS_AREA_BAND.max} 사이 정수(전용면적 ㎡를 내린 값)여야 합니다.`);
    }
    if (item.placeKind === "complex") {
      if (item.propertyKind !== DEAL_NEWS_COMPLEX_PROPERTY_KIND) errors.push(`${path}.placeKind: 단지 이름은 아파트 거래에만 쓸 수 있습니다.`);
      const problem = dealNewsNameProblem(item.complexName);
      if (problem) errors.push(`${path}.complexName: ${problem}`);
    } else if (item.placeKind === "area") {
      if (Object.hasOwn(item, "complexName")) errors.push(`${path}.complexName: 동네 이름으로 올리는 소식에는 단지 이름 칸을 두지 않습니다.`);
    } else {
      errors.push(`${path}.placeKind: complex 또는 area여야 합니다.`);
    }
  });
  if (published > DEAL_NEWS_PUBLIC_MAX) errors.push(`dealNews: 공개(published)는 ${DEAL_NEWS_PUBLIC_MAX}건까지입니다.`);
  return errors;
}

// ── 넣는 순간 판정 ──
// 입력(모두 화면 메모리에만 있고 저장하지 않는다):
// - propertyKind·dealType: 목록 값
// - contractDate: 그 거래의 계약일, today: 오늘(한국 날짜). 둘 다 'YYYY-MM-DD'
// - balancePaid: 잔금이 끝났는지(참일 때만 올림)
// - saleSeenInData: 매매일 때만 본다. '실거래 자료에 이 거래가 올라온 것을 확인함'(참일 때만 올림). 전세·월세는 보지 않는다.
// - recentCount: 건수 API가 준 count(같은 단지·같은 전용면적대·같은 거래 종류, 오늘에서 6개월 전 ~ 오늘, 해제 뺌). 모르면 null
// 돌려주는 값:
// - canPublish: 올릴 수 있는지, blockers: 올릴 수 없는 까닭 [{ code, message }](없으면 빈 배열), publishableFrom: 60일 조건이 풀리는 첫날
// - placeKind: 올릴 때 써야 하는 자리 종류('complex' | 'area'), canUseComplexName, name: 그 까닭 { code, message }
export function judgeDealNews({ propertyKind, dealType, contractDate, today, balancePaid, saleSeenInData, recentCount = null } = {}) {
  const blockers = [];
  if (!PROPERTY_VALUES.includes(propertyKind)) blockers.push({ code: "PROPERTY_KIND", message: "건물 종류를 골라 주세요." });
  if (!DEAL_VALUES.includes(dealType)) blockers.push({ code: "DEAL_TYPE", message: "거래 종류를 골라 주세요." });

  let publishableFrom = null;
  if (!isDealNewsDate(today) || !isDealNewsDate(contractDate)) {
    blockers.push({ code: "DATE_INVALID", message: "계약일을 실제 날짜로 넣어 주세요." });
  } else if (contractDate > today) {
    blockers.push({ code: "DATE_FUTURE", message: "계약일이 오늘보다 뒤입니다." });
  } else {
    publishableFrom = dealNewsPublishableFrom(contractDate);
    if (today < publishableFrom) {
      blockers.push({ code: "WAIT_DAYS", message: `계약일에서 ${DEAL_NEWS_WAIT_DAYS}일이 지난 뒤에 올릴 수 있습니다.` });
    }
  }
  if (balancePaid !== true) blockers.push({ code: "BALANCE_UNPAID", message: "잔금이 끝난 거래만 올릴 수 있습니다." });
  if (dealType === "sale" && saleSeenInData !== true) {
    blockers.push({ code: "SALE_NOT_SEEN", message: "매매는 실거래 자료에 이 거래가 올라온 것을 확인한 뒤에 올릴 수 있습니다." });
  }

  const name = judgeDealNewsName({ propertyKind, recentCount });
  return {
    canPublish: blockers.length === 0,
    blockers,
    publishableFrom,
    placeKind: name.canUse ? "complex" : "area",
    canUseComplexName: name.canUse,
    name: { code: name.code, message: name.message },
  };
}

// 단지 이름을 쓸 수 있는지(아파트이고 건수가 기준 이상일 때만). 건수를 모르면 쓸 수 없다.
export function judgeDealNewsName({ propertyKind, recentCount = null }) {
  if (propertyKind !== DEAL_NEWS_COMPLEX_PROPERTY_KIND) {
    return { canUse: false, code: "NOT_APARTMENT", message: "아파트가 아닌 거래는 동네 이름으로 올립니다." };
  }
  if (!Number.isInteger(recentCount) || recentCount < 0) {
    return { canUse: false, code: "COUNT_UNKNOWN", message: "최근 거래 건수를 확인하지 못해 동네 이름으로 올립니다." };
  }
  const counted = `최근 ${DEAL_NEWS_COUNT_MONTHS}개월 동안 같은 단지·같은 전용면적대·같은 거래 종류가 ${recentCount}건입니다`;
  if (recentCount < DEAL_NEWS_MIN_COUNT) {
    return { canUse: false, code: "COUNT_LOW", message: `${counted}. ${DEAL_NEWS_MIN_COUNT}건보다 적어 동네 이름으로 올립니다.` };
  }
  return { canUse: true, code: "COUNT_OK", message: `${counted}. ${DEAL_NEWS_MIN_COUNT}건 이상이라 단지 이름을 쓸 수 있습니다.` };
}

// ── 항목 만들기(화면이 씀) ──
// "84.97" → 84(홍보 종이 areaBandText와 같은 규칙: 소수 둘째 자리까지, 10 ~ 400). 틀리면 null.
export function dealNewsAreaBand(value) {
  return areaBandText(value) === null ? null : Math.floor(Number(String(value).trim()));
}

// 무작위 ID('dn-' + 16진수 16자). 거래·손님 UUID나 시각을 넣지 않는다.
export function newDealNewsId(cryptoImpl = globalThis.crypto) {
  const bytes = cryptoImpl.getRandomValues(new Uint8Array(8));
  return `dn-${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

// 허용 칸만 정해진 순서로 담은 항목. placeKind가 area이면 단지 이름을 넣어도 버린다.
export function buildDealNewsItem({ id, status, placeKind, umdName, complexName, propertyKind, dealType, areaBand }) {
  return {
    id,
    status,
    placeKind,
    umdName,
    ...(placeKind === "complex" ? { complexName } : {}),
    propertyKind,
    dealType,
    areaBand,
  };
}

// 새 소식을 끝에 붙인다. published가 5건을 넘으면 가장 오래된 published부터 뺀다(화면이 미리 보여 줄 수 있게 뺀 것을 함께 돌려줌).
export function appendDealNews(items, item) {
  const next = [...items, item];
  const dropped = [];
  let over = next.filter((entry) => entry?.status === "published").length - DEAL_NEWS_PUBLIC_MAX;
  while (over > 0) {
    const index = next.findIndex((entry) => entry?.status === "published");
    dropped.push(...next.splice(index, 1));
    over -= 1;
  }
  return { items: next, dropped };
}
