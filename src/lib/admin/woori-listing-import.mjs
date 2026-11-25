// 우리집부동산(woori-house.co.kr) 매물 목록 엑셀을 브라우저에서만 읽어 공개 네이버 매물 카드로 바꾼다.
// 원본은 서버로 보내지 않는다. 상세주소의 정확한 호수·지번·중개사 메모는 버리고 공개 동 번호와 광고 층만 쓴다.
// 2026-11-24 사용자 지시 "상가 토지도 해"·"그 밖도 다 해"로 아파트·분양권 밖의 종류도 받는다(종류 이름은 아래 표, 처음 보는 이름이면 저장을 막음).
// 부동산뱅크 가져오기(bank-listing-import.mjs)와 달리 지난번 우리집부동산 기준선(재확인 상태 source "woori")에서
// 이번 파일에 없는 매물만 지운다. 부동산뱅크 자동 받기 매물(source "bank")은 건너뛰고 건드리지 않는다.
import { formatBankPriceLabel, normalizeBankListingText } from "./bank-listing-import.mjs";
import { getNaverListingPublicTextErrors } from "../naver-listing-public-validation.mjs";

export const WOORI_LISTING_MAX_FILE_BYTES = 5 * 1024 * 1024;

// 새 우리집부동산 매물에만 넣는 요약 문장(2026-11-24 사용자 결정). 이미 있는 매물은 기존 요약을 그대로 둔다.
export const WOORI_LISTING_DEFAULT_SUMMARY = "네이버에 공개된 광고 매물입니다. 자세한 조건은 상세 화면에서 확인해 주세요.";

export const WOORI_LISTING_EXPECTED_HEADERS = Object.freeze([
  "번호",
  "홍보방식",
  "우리집매물번호",
  "네이버매물번호",
  "매물종류",
  "거래종류",
  "소재지",
  "매물명",
  "상세주소",
  "면적1(㎡)",
  "면적2(㎡)",
  "매물가",
  "등록",
  "진행상황",
  "거래완료",
  "중개사메모",
]);

const tradeTypeMap = new Map([
  ["매매", "sale"],
  ["전세", "jeonse"],
  ["월세", "monthly-rent"],
]);

// 우리집부동산 매물종류 → 사이트 매물 종류(부동산뱅크·직접 등록과 같은 이름). 2026-11-24 공개 목록에 실제로 온 이름은
// 아파트·아파트 분양권·상가점포뿐이고, 나머지는 네이버 부동산 종류 이름을 보고 넣은 것이다(추정). 표에 없는 이름이 오면
// 형식 오류로 그날 반영 전체를 막는다(모르는 종류 때문에 매물을 지우거나 엉뚱한 종류로 싣지 않게).
const propertyTypeMap = new Map([
  ["아파트", "아파트"],
  ["아파트 분양권", "아파트분양권"],
  ["아파트분양권", "아파트분양권"],
  ["상가점포", "상가점포"],
  ["상가", "상가점포"],
  ["빌라/연립", "빌라/연립"],
  ["빌라", "빌라/연립"],
  ["연립", "빌라/연립"],
  ["다세대", "빌라/연립"],
  ["다세대/연립", "빌라/연립"],
  ["단독/다가구", "단독/다가구"],
  ["단독", "단독/다가구"],
  ["다가구", "단독/다가구"],
  ["토지", "토지"],
  ["오피스텔", "오피스텔"],
  ["오피스텔 분양권", "오피스텔분양권"],
  ["오피스텔분양권", "오피스텔분양권"],
  ["사무실", "사무실"],
  ["원룸", "원룸"],
  ["상가주택", "상가주택"],
  ["전원주택", "전원주택"],
  ["한옥주택", "한옥주택"],
  ["공장/창고", "공장/창고"],
  ["지식산업센터", "지식산업센터"],
  ["건물", "건물"],
  ["상가건물", "건물"],
  ["재건축", "재건축"],
  ["재개발", "재개발"],
]);

export const WOORI_PROPERTY_TYPE_NAMES = Object.freeze([...propertyTypeMap.keys()]);

// 우리집부동산 매물종류 이름 → 사이트 매물 종류(표에 없으면 null).
export function wooriSitePropertyType(name) {
  return propertyTypeMap.get(normalizeBankListingText(name)) ?? null;
}

const titledPropertyTypes = new Set(["아파트", "아파트분양권"]);
// 매물명이 없을 때 "{동네} {말}" 제목에 쓰는 말. 표에 없으면 사이트 종류 이름 그대로.
const titleWords = new Map([
  ["상가점포", "상가"],
  ["빌라/연립", "빌라"],
  ["단독/다가구", "단독주택"],
  ["공장/창고", "공장·창고"],
]);

const comparedFields = [
  "title",
  "propertyType",
  "tradeType",
  "priceLabel",
  "areaLabel",
  "floorLabel",
  "direction",
  "summary",
  "registeredAt",
  "source",
  "url",
];

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/u.test(value ?? "");
}

function normalizeComplexName(value) {
  return normalizeBankListingText(value)
    .replace(/^리더스시티\s*4\s*BL$/iu, "리더스시티 4블록")
    .replace(/^리더스시티\s*5\s*BL$/iu, "리더스시티 5블록");
}

// "999동 9999호 (고)" · "999동 9999호 (7층)" → { building: "999", floor: "고" | "7" | null }. 호수는 돌려주지 않는다.
// 공개 목록 자동 받기(scripts/sync/woori-listings.mjs)는 총층을 알 때 "999동 (7/22층)" · "999동 (고/22층)"으로 넘긴다.
export function parseWooriDetailAddress(value) {
  const text = normalizeBankListingText(value);
  const building = /^(\d{1,4})\s*동(?:\s|$)/u.exec(text)?.[1] ?? null;
  const paren = /\(\s*([^()]*?)\s*\)\s*$/u.exec(text)?.[1] ?? "";
  const withTotal = /^(고|중|저|\d{1,3})\s*\/\s*(\d{1,3})\s*층$/u.exec(paren);
  if (withTotal) return { building, floor: withTotal[1], totalFloors: withTotal[2] };
  // 상가처럼 동 번호가 없는 엑셀 줄은 "123-4 1층 101호"처럼 지번·층·호수를 적는다. 그때는 따로 떨어진 "1층"의 층 숫자만 쓴다.
  const loose = building ? null : /(?:^|\s)(\d{1,3})\s*층(?=\s|$)/u.exec(text.replace(/\([^()]*\)\s*$/u, ""))?.[1] ?? null;
  const floor = /^(고|중|저)$/u.exec(paren)?.[1] ?? /^(\d{1,3})\s*층$/u.exec(paren)?.[1] ?? loose;
  return { building, floor: floor !== null && /^\d+$/u.test(floor) && Number(floor) === 0 ? null : floor, totalFloors: null };
}

// 소재지 "대전광역시 동구 천동 123-4" → "천동". 동·가·리·읍·면으로 끝나는 마지막 낱말만 쓰고 지번은 버린다.
export function parseWooriNeighborhood(value) {
  const words = normalizeBankListingText(value).split(" ").filter((word) => /^[가-힣]{1,8}\d{0,2}[가-힣]{0,3}(?:동|가|리|읍|면)$/u.test(word));
  return words.at(-1) ?? null;
}

// 공개 매물명이 지번·호수·전화번호처럼 보이면 쓰지 않는다(그때는 "{동네} {말}").
function isSafeListingName(value) {
  if (!value || value.length > 40) return false;
  if (/\d\s*-\s*\d|번지|\d\s*호|\d{3,}/u.test(value)) return false;
  return getNaverListingPublicTextErrors({ title: value }).length === 0;
}

// 아파트·분양권이 아닌 매물의 처음 제목: 공개 매물명 → "{동네} {종류 말}" → "{종류 말} 매물".
// 공개 면적 글(areaLabel)이 있으면 끝 면적(전용·연면적, 하나뿐이면 그 값)의 정수를 붙인다(예: "천동 복합상가 168㎡").
// 같은 건물·같은 동네 상가가 여러 건이면 제목이 모두 같아 목록에서 구별되지 않아서다(2026-11-25 사용자 지시 "제목 바꾸기도 같이 해").
export function buildWooriOtherTitle({ name, neighborhood, propertyType, areaLabel = null }) {
  const cleanName = normalizeBankListingText(name);
  const word = titleWords.get(propertyType) ?? propertyType;
  const base = isSafeListingName(cleanName) ? cleanName : neighborhood ? `${neighborhood} ${word}` : `${word} 매물`;
  const area = titleAreaText(areaLabel);
  return area ? `${base} ${area}` : base;
}

// "계약 299.04㎡ · 전용 168.8㎡" → "168㎡", "토지 1200㎡" → "1,200㎡". 읽지 못하면 null(면적 없이 제목만).
function titleAreaText(areaLabel) {
  const matches = [...String(areaLabel ?? "").matchAll(/(\d+(?:\.\d+)?)㎡/gu)];
  const area = Math.trunc(Number(matches.at(-1)?.[1]));
  return Number.isFinite(area) && area > 0 ? `${area.toLocaleString("en-US")}㎡` : null;
}

// 엑셀에는 광고 층 하나만 있다. 총층이 없으므로 "7층"·"고층" 꼴로 적는다. 이미 같은 층으로 시작하는 "7/22층" 꼴이 있으면 그 값을 둔다.
// 총층을 알면(공개 목록 자동 받기) 부동산뱅크 매물과 같은 "7/22층"·"고/22층" 꼴로 적는다.
export function formatWooriFloorLabel(floor, existingFloorLabel = null, totalFloors = null) {
  if (!floor) return existingFloorLabel ?? null;
  if (totalFloors) return `${floor}/${totalFloors}층`;
  if (typeof existingFloorLabel === "string" && new RegExp(`^${floor}/\\d+층$`, "u").test(existingFloorLabel)) return existingFloorLabel;
  return `${floor}층`;
}

function cleanDecimal(value) {
  value = String(value ?? "").replace(/,/gu, "");
  if (!/^\d+(?:\.\d+)?$/u.test(value)) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return String(number);
}

// 면적1 "[공급] 99.99" 또는 "[계약] 99.99", 면적2 "[전용] 99.99" → 지금 공개 카드와 같은 꼴.
// 단독·다가구는 "[대지] …"·"[연면적] …"(부동산뱅크와 같은 "대지 …㎡ · 연면적 …㎡"), 토지는 "[토지] …" 하나("토지 …㎡").
// 아파트·분양권 밖의 종류는 둘째 칸이 비었거나 0이면 첫 칸만 적는다. 첫 칸을 못 읽거나 짝이 맞지 않으면 null(저장을 막음).
export function formatWooriAreaLabel(firstValue, secondValue, propertyType) {
  const first = /^\[(공급|계약|대지|토지)\]\s*(\S+)$/u.exec(normalizeBankListingText(firstValue));
  const secondText = normalizeBankListingText(secondValue);
  const second = /^\[(전용|연면적)\]\s*(\S*)$/u.exec(secondText);
  if (!first || (secondText && !second)) return null;
  const kind = first[1];
  const firstArea = cleanDecimal(first[2]);
  const secondArea = second ? cleanDecimal(second[2]) : null;
  const secondKind = second?.[1] ?? null;
  if (!firstArea) return null;
  if (kind === "토지") return secondArea ? null : `토지 ${firstArea}㎡`;
  if (!secondArea) return titledPropertyTypes.has(propertyType) ? null : `${kind} ${firstArea}㎡`;
  if ((kind === "대지") !== (secondKind === "연면적")) return null;
  if (kind === "대지") return `대지 ${firstArea}㎡ · 연면적 ${secondArea}㎡`;
  if (kind === "계약") return `계약 ${firstArea}㎡ · 전용 ${secondArea}㎡`;
  if (titledPropertyTypes.has(propertyType)) return `${Math.trunc(Number(firstArea))}㎡ · 전용 ${secondArea}㎡`;
  return `공급 ${firstArea}㎡ · 전용 ${secondArea}㎡`;
}

// 매물가(만원): 매매·전세는 "9,999", 월세는 "보증금/월세".
export function formatWooriPriceLabel(value, tradeType) {
  const text = normalizeBankListingText(value);
  if (tradeType !== "monthly-rent") return text.includes("/") ? null : formatBankPriceLabel(text);
  const parts = text.split("/").map((part) => part.trim());
  if (parts.length !== 2) return null;
  const [deposit, rent] = parts.map((part) => formatBankPriceLabel(part));
  return deposit && rent ? `${deposit}/${rent}` : null;
}

// 등록 "YY.MM.DD" → "YYYY-MM-DD"
export function parseWooriRegisteredAt(value) {
  const match = /^(\d{2})\.(\d{2})\.(\d{2})$/u.exec(normalizeBankListingText(value));
  if (!match) return null;
  const year = 2000 + Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function getHeaderErrors(headers) {
  if (headers.length !== WOORI_LISTING_EXPECTED_HEADERS.length) {
    return [`우리집부동산 엑셀 칸 수가 바뀌었습니다. 지금 ${headers.length}개, 예상 ${WOORI_LISTING_EXPECTED_HEADERS.length}개입니다.`];
  }
  const errors = [];
  WOORI_LISTING_EXPECTED_HEADERS.forEach((expected, index) => {
    if (headers[index] !== expected) errors.push(`${index + 1}번째 칸이 "${expected}"가 아닙니다.`);
  });
  return errors;
}

function rowToRecord(headers, values) {
  return Object.fromEntries(headers.map((header, index) => [header, normalizeBankListingText(values[index])]));
}

// 한 줄 → { listing } 또는 { skip: 까닭 } 또는 { errors: [...] }(형식이 틀려 저장을 막음)
function normalizeWooriRow(row, existing, reviewSource, checkedAt) {
  const naverId = row["네이버매물번호"];
  if (!naverId) return { naverId: null, skip: "네이버 매물번호가 없어 홈페이지에 싣지 않습니다." };
  if (!/^\d+$/u.test(naverId)) return { naverId: null, errors: ["네이버 매물번호 형식을 확인해 주세요."] };
  if (reviewSource === "bank") return { naverId, skip: "부동산뱅크 자동 받기 매물이라 건너뜁니다(부동산뱅크 값 그대로)." };
  if (!row["진행상황"].startsWith("서비스중")) return { naverId, skip: "진행상황이 '서비스중'이 아니라 싣지 않습니다." };
  if (row["거래완료"]) return { naverId, skip: "거래완료 칸이 차 있어 싣지 않습니다." };

  const errors = [];
  const tradeType = tradeTypeMap.get(row["거래종류"]);
  if (!tradeType) errors.push("지원하지 않는 거래 종류입니다.");
  const rawType = row["매물종류"];
  const propertyType = wooriSitePropertyType(rawType);
  if (!rawType) errors.push("매물종류가 비어 있습니다.");
  else if (!propertyType) errors.push("처음 보는 매물종류입니다. 종류 이름 표(woori-listing-import.mjs)에 넣은 뒤 다시 받아 주세요.");
  const priceLabel = tradeType ? formatWooriPriceLabel(row["매물가"], tradeType) : null;
  if (tradeType && !priceLabel) errors.push("매물가를 공개 가격 형식으로 바꿀 수 없습니다.");
  const areaLabel = formatWooriAreaLabel(row["면적1(㎡)"], row["면적2(㎡)"], propertyType);
  if (!areaLabel) errors.push("면적을 공개 면적 형식으로 바꿀 수 없습니다.");
  const registeredAt = parseWooriRegisteredAt(row["등록"]);
  if (!registeredAt) errors.push("등록일을 확인할 수 없습니다.");
  else if (isIsoDate(checkedAt) && registeredAt > checkedAt) errors.push("등록일이 오늘보다 늦습니다.");
  if (errors.length > 0) return { naverId, errors };

  const address = parseWooriDetailAddress(row["상세주소"]);
  let title;
  if (titledPropertyTypes.has(propertyType)) {
    // 아파트·분양권은 지금 그대로 "{단지} {동}동"(동 번호가 없으면 이미 있는 제목, 그것도 없으면 건너뜀).
    const complexName = normalizeComplexName(row["매물명"]);
    title = (complexName && address.building ? `${complexName} ${address.building}동` : null) ?? existing?.title ?? null;
    if (!title) return { naverId, skip: "동 번호가 없어 안전한 공개 제목을 만들 수 없습니다. 직접 등록으로 넣어 주세요." };
  } else {
    // 그 밖의 종류는 이미 있는 제목(직접 등록에서 넘어온 매물 포함)을 두고, 처음이면 공개 매물명 또는 "{동네} {종류 말}" 뒤에 면적.
    title = existing?.title ?? buildWooriOtherTitle({ name: row["매물명"], neighborhood: parseWooriNeighborhood(row["소재지"]), propertyType, areaLabel });
  }

  const listing = {
    id: naverId,
    title,
    propertyType,
    tradeType,
    priceLabel,
    areaLabel,
    floorLabel: formatWooriFloorLabel(address.floor, existing?.floorLabel ?? null, address.totalFloors),
    direction: existing?.direction ?? null,
    summary: existing?.summary || WOORI_LISTING_DEFAULT_SUMMARY,
    registeredAt,
    source: "네이버페이 부동산",
    url: `https://fin.land.naver.com/articles/${naverId}`,
  };
  const textErrors = getNaverListingPublicTextErrors(listing, "우리집부동산").map((message) => message.replace(/^우리집부동산\.[^:]+:\s*/u, ""));
  if (textErrors.length > 0) return { naverId, errors: textErrors };
  return { naverId, listing };
}

/**
 * @param {string[]} headersInput 표 머리칸
 * @param {string[][]} rowValues 자료 줄(머리칸과 칸 수가 다른 줄은 표 아래 안내 줄로 보고 건너뜀)
 * @param {{ checkedAt: string, items: any[] }} currentData 지금 naver-listings.json
 * @param {{ items?: Record<string, { source: string }> }} reviewState 지금 listing-review-state.json
 * @param {string} today 한국 날짜(YYYY-MM-DD)
 */
export function createWooriListingImport(headersInput, rowValues, currentData, reviewState, today) {
  const headers = headersInput.map(normalizeBankListingText);
  const headerErrors = getHeaderErrors(headers);
  const currentItems = Array.isArray(currentData?.items) ? currentData.items : [];
  const existingById = new Map(currentItems.map((item) => [item.id, item]));
  const reviewItems = reviewState?.items ?? {};
  const checkedAt = [currentData?.checkedAt, today].filter(isIsoDate).sort().at(-1) ?? today;
  const errors = headerErrors.map((message) => ({ rowNumber: 1, message }));
  if (!isIsoDate(today)) errors.push({ rowNumber: 1, message: "분석 기준일이 올바르지 않습니다." });

  const importedById = new Map();
  const skippedItems = [];
  let rowCount = 0;
  let ignoredRowCount = 0;

  if (headerErrors.length === 0) {
    rowValues.forEach((values, index) => {
      const rowNumber = index + 2;
      if (values.every((value) => normalizeBankListingText(value) === "")) return;
      if (values.length !== headers.length) {
        ignoredRowCount += 1;
        return;
      }
      rowCount += 1;
      const row = rowToRecord(headers, values);
      const naverId = /^\d+$/u.test(row["네이버매물번호"]) ? row["네이버매물번호"] : null;
      if (naverId && importedById.has(naverId)) {
        skippedItems.push({ rowNumber, id: naverId, title: importedById.get(naverId).title, reason: "같은 네이버 매물번호가 위 줄에 있어 하나만 씁니다." });
        return;
      }
      const result = normalizeWooriRow(row, naverId ? existingById.get(naverId) : null, naverId ? reviewItems[naverId]?.source : null, checkedAt);
      if (result.errors) {
        result.errors.forEach((message) => errors.push({ rowNumber, message }));
        return;
      }
      if (result.skip) {
        skippedItems.push({ rowNumber, id: result.naverId, title: result.naverId ? existingById.get(result.naverId)?.title ?? null : null, reason: result.skip });
        return;
      }
      importedById.set(result.listing.id, result.listing);
    });
  }

  const importedItems = [...importedById.values()];
  const comparisons = importedItems.map((listing) => {
    const existing = existingById.get(listing.id);
    const previousSource = reviewItems[listing.id]?.source ?? null;
    if (!existing) return { id: listing.id, title: listing.title, status: "new", changes: comparedFields, previousSource };
    const changes = comparedFields.filter((field) => existing[field] !== listing[field]);
    return { id: listing.id, title: listing.title, status: changes.length > 0 ? "changed" : "same", changes, previousSource };
  });
  // 지난번 우리집부동산 기준선(source "woori")에서 이번 파일에 없는 매물만 지운다. 건너뛴 줄(진행상황 끝남 등)도 지울 대상이다.
  const removedItems = currentItems
    .filter((item) => reviewItems[item.id]?.source === "woori" && !importedById.has(item.id))
    .map((item) => ({ id: item.id, title: item.title }));
  const removedIds = new Set(removedItems.map((item) => item.id));
  const nextItems = currentItems.filter((item) => !removedIds.has(item.id)).map((item) => importedById.get(item.id) ?? item);
  importedItems.filter((item) => !existingById.has(item.id)).forEach((item) => nextItems.push(item));
  const ok = errors.length === 0 && nextItems.length > 0;

  return {
    checkedAt,
    rowCount,
    ignoredRowCount,
    columnCount: headers.length,
    importedCount: importedItems.length,
    newItems: comparisons.filter((item) => item.status === "new"),
    changedItems: comparisons.filter((item) => item.status === "changed"),
    sameItems: comparisons.filter((item) => item.status === "same"),
    takenOverItems: comparisons.filter((item) => item.previousSource === "manual"),
    removedItems,
    skippedItems,
    errors,
    nextData: ok ? { checkedAt, items: nextItems } : null,
    wooriIds: new Set(importedItems.map((item) => item.id)),
  };
}

function extractTableRows(html) {
  if (typeof DOMParser === "undefined") throw new Error("이 브라우저에서는 우리집부동산 파일을 읽을 수 없습니다.");
  const safeHtml = html.replace(/<(?:script|style|iframe|object|embed|img|link|video|audio|source)\b[^>]*>[\s\S]*?<\/(?:script|style|iframe|object|embed|video|audio)>/giu, "")
    .replace(/<(?:script|style|iframe|object|embed|img|link|video|audio|source)\b[^>]*\/?\s*>/giu, "");
  const document = new DOMParser().parseFromString(safeHtml, "text/html");
  for (const table of document.querySelectorAll("table")) {
    const rows = [...table.querySelectorAll("tr")].map((row) => [...row.querySelectorAll(":scope > th, :scope > td")].map((cell) => normalizeBankListingText(cell.textContent)));
    const headerIndex = rows.findIndex((cells) => cells.includes("우리집매물번호"));
    if (headerIndex >= 0) return { headers: rows[headerIndex], rows: rows.slice(headerIndex + 1) };
  }
  throw new Error("우리집부동산 매물 표를 찾지 못했습니다.");
}

export async function readWooriListingFile(file) {
  if (!(file instanceof File)) throw new Error("우리집부동산 엑셀 파일을 선택해 주세요.");
  if (!file.name.toLocaleLowerCase("en-US").endsWith(".xls")) throw new Error("우리집부동산 .xls 파일만 선택할 수 있습니다.");
  if (file.size <= 0 || file.size > WOORI_LISTING_MAX_FILE_BYTES) throw new Error("우리집부동산 파일은 5MB 이하이어야 합니다.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf) throw new Error("바이너리 XLS는 지원하지 않습니다. 우리집부동산에서 다시 엑셀로 내려받아 주세요.");
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) throw new Error("XLSX는 지원하지 않습니다. 우리집부동산 .xls 파일을 선택해 주세요.");
  let html;
  try {
    html = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("우리집부동산 파일을 UTF-8로 읽지 못했습니다. 부동산뱅크 파일이면 위 '엑셀 매물 가져오기'를 써 주세요.");
  }
  if (!/<table\b/iu.test(html)) throw new Error("지원하지 않는 우리집부동산 파일 형식입니다.");
  return extractTableRows(html);
}
