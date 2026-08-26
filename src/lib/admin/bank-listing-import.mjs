import { getNaverListingPublicTextErrors } from "../naver-listing-public-validation.mjs";

export const BANK_LISTING_MAX_FILE_BYTES = 5 * 1024 * 1024;

export const BANK_LISTING_EXPECTED_HEADERS = Object.freeze([
  "번호",
  "매물번호 (네이버번호)",
  "거래",
  "매물종류",
  "소재지",
  "매물명",
  "매물설명",
  "면적(㎡)",
  "해당층/총층",
  "방향",
  "방수",
  "욕실수",
  "월관리비",
  "매물가(만원)",
  "입주가능일",
  "특징",
  "상세설명",
  "등록기간",
  "소유자명",
  "소유자 핸드폰번호",
  "매도자명",
  "매도자 핸드폰번호",
  "진행상황 (확인방식)",
  "메모",
  "사진 개수",
]);

const tradeTypeMap = new Map([
  ["매매", "sale"],
  ["전세", "jeonse"],
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
  "confirmedAt",
  "source",
  "url",
];

export function normalizeBankListingText(value) {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/[\u00a0\u200b]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/u.test(value ?? "");
}

function parseBankListingNumber(value) {
  const match = /^(\d+)\s*\(\s*(\d+)\s*\)$/u.exec(normalizeBankListingText(value));
  return match ? { bankListingId: match[1], naverListingId: match[2] } : null;
}

function normalizeComplexName(value) {
  return normalizeBankListingText(value)
    .replace(/^리더스시티\s*4\s*BL$/iu, "리더스시티 4블록")
    .replace(/^리더스시티\s*5\s*BL$/iu, "리더스시티 5블록");
}

function createApartmentTitle(row, existing) {
  const complexName = normalizeComplexName(row["매물명"]);
  const buildingMatch = /(?:^|\s)(\d{1,4})\s*동(?:\s|$)/u.exec(normalizeBankListingText(row["매물설명"]));
  if (complexName && buildingMatch) return `${complexName} ${buildingMatch[1]}동`;
  return existing?.title ?? null;
}

export function formatBankPriceLabel(value) {
  const normalized = normalizeBankListingText(value).replaceAll(",", "");
  if (!/^\d+$/u.test(normalized)) return null;
  const manWon = Number(normalized);
  if (!Number.isSafeInteger(manWon) || manWon <= 0) return null;
  const eok = Math.floor(manWon / 10_000);
  const remainder = manWon % 10_000;
  if (eok > 0 && remainder > 0) return `${eok}억 ${remainder.toLocaleString("ko-KR")}`;
  if (eok > 0) return `${eok}억`;
  return remainder.toLocaleString("ko-KR");
}

function cleanDecimal(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return String(number);
}

export function formatBankAreaLabel(value, propertyType) {
  const [supplyRaw, exclusiveRaw, extra] = normalizeBankListingText(value).split("/").map((part) => part.trim());
  if (!supplyRaw || !exclusiveRaw || extra !== undefined) return null;
  const supplyMatch = /^(\d+(?:\.\d+)?)([A-Za-z0-9-]*)$/u.exec(supplyRaw);
  const exclusive = cleanDecimal(exclusiveRaw);
  if (!supplyMatch || !exclusive) return null;
  const supply = Math.trunc(Number(supplyMatch[1]));
  if (!Number.isSafeInteger(supply) || supply <= 0) return null;
  const typeSuffix = supplyMatch[2].toUpperCase();
  if (propertyType === "단독/다가구") return `대지 ${supply}㎡ · 연면적 ${exclusive}㎡`;
  return `${supply}${typeSuffix}㎡ · 전용 ${exclusive}${typeSuffix}㎡`;
}

export function parseBankConfirmedAt(value) {
  const match = /^(\d{2})\.(\d{2})\.(\d{2})\s*~/u.exec(normalizeBankListingText(value));
  if (!match) return null;
  const year = 2000 + Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function rowToRecord(headers, values) {
  return Object.fromEntries(headers.map((header, index) => [header, normalizeBankListingText(values[index])]));
}

function getHeaderErrors(headers) {
  if (headers.length !== BANK_LISTING_EXPECTED_HEADERS.length) {
    return [`부동산뱅크 엑셀 컬럼 수가 변경되었습니다. 현재 ${headers.length}개, 예상 ${BANK_LISTING_EXPECTED_HEADERS.length}개입니다.`];
  }
  const errors = [];
  BANK_LISTING_EXPECTED_HEADERS.forEach((expected, index) => {
    if (headers[index] !== expected) errors.push(`${index + 1}번째 컬럼이 "${expected}"가 아닙니다.`);
  });
  return errors;
}

function normalizeBankRow(row, rowNumber, existing) {
  const errors = [];
  const listingNumber = parseBankListingNumber(row["매물번호 (네이버번호)"]);
  if (!listingNumber) errors.push("네이버 매물번호 형식을 확인해 주세요.");

  const tradeType = tradeTypeMap.get(row["거래"]);
  if (!tradeType) {
    errors.push(row["거래"] === "월세" ? "부동산뱅크 월세 엑셀 샘플이 필요합니다." : "지원하지 않는 거래 유형입니다.");
  }

  const serviceStatus = row["진행상황 (확인방식)"];
  if (!serviceStatus.startsWith("서비스중")) errors.push("서비스 중인 매물만 가져올 수 있습니다.");

  const propertyType = row["매물종류"];
  if (!propertyType) errors.push("매물종류가 비어 있습니다.");

  let title = null;
  if (["아파트", "아파트분양권"].includes(propertyType)) title = createApartmentTitle(row, existing);
  else title = existing?.title ?? null;
  if (!title) errors.push("안전한 공개 제목을 자동으로 만들 수 없습니다. 수동 등록을 이용해 주세요.");

  const priceLabel = formatBankPriceLabel(row["매물가(만원)"]);
  if (!priceLabel) errors.push("매물가를 공개 가격 형식으로 바꿀 수 없습니다.");

  const areaLabel = formatBankAreaLabel(row["면적(㎡)"], propertyType);
  if (!areaLabel) errors.push("면적을 공개 면적 형식으로 바꿀 수 없습니다.");

  const summary = row["특징"] || existing?.summary || "";
  if (!summary) errors.push("공개할 한줄 설명이 없습니다.");

  const confirmedAt = parseBankConfirmedAt(row["등록기간"]);
  if (!confirmedAt) errors.push("등록기간 시작일을 확인할 수 없습니다.");

  if (errors.length > 0 || !listingNumber || !tradeType || !title || !priceLabel || !areaLabel || !confirmedAt) {
    return { rowNumber, bankListingId: listingNumber?.bankListingId ?? null, naverListingId: listingNumber?.naverListingId ?? null, errors };
  }

  const listing = {
    id: listingNumber.naverListingId,
    title,
    propertyType,
    tradeType,
    priceLabel,
    areaLabel,
    floorLabel: existing?.floorLabel ?? null,
    direction: row["방향"] || null,
    summary,
    confirmedAt,
    source: "네이버페이 부동산",
    url: `https://fin.land.naver.com/articles/${listingNumber.naverListingId}`,
  };

  errors.push(...getNaverListingPublicTextErrors(listing, `부동산뱅크 ${rowNumber}행`).map((message) => message.replace(/^부동산뱅크 \d+행\.[^:]+:\s*/u, "")));
  return { rowNumber, bankListingId: listingNumber.bankListingId, naverListingId: listingNumber.naverListingId, listing, errors };
}

export function createBankListingImport(headersInput, rowValues, currentData, checkedAt) {
  const headers = headersInput.map(normalizeBankListingText);
  const headerErrors = getHeaderErrors(headers);
  const currentItems = Array.isArray(currentData?.items) ? currentData.items : [];
  const existingById = new Map(currentItems.map((item) => [item.id, item]));
  const importedById = new Map();
  const rowResults = [];
  const errors = headerErrors.map((message) => ({ rowNumber: 1, message }));

  if (!isIsoDate(checkedAt)) errors.push({ rowNumber: 1, message: "분석 기준일이 올바르지 않습니다." });

  if (headerErrors.length === 0) {
    rowValues.forEach((values, index) => {
      const rowNumber = index + 2;
      if (values.every((value) => normalizeBankListingText(value) === "")) return;
      const row = rowToRecord(headers, values);
      const parsedNumber = parseBankListingNumber(row["매물번호 (네이버번호)"]);
      const result = normalizeBankRow(row, rowNumber, parsedNumber ? existingById.get(parsedNumber.naverListingId) : null);
      if (result.naverListingId && importedById.has(result.naverListingId)) result.errors.push("같은 네이버 매물번호가 파일에 두 번 있습니다.");
      if (result.listing && result.errors.length === 0) importedById.set(result.listing.id, result.listing);
      result.errors.forEach((message) => errors.push({ rowNumber, message }));
      rowResults.push(result);
    });
  }

  const importedItems = [...importedById.values()];
  const comparisons = importedItems.map((listing) => {
    const existing = existingById.get(listing.id);
    if (!existing) return { id: listing.id, title: listing.title, status: "new", changes: comparedFields };
    const changes = comparedFields.filter((field) => existing[field] !== listing[field]);
    return { id: listing.id, title: listing.title, status: changes.length > 0 ? "changed" : "same", changes };
  });
  const siteOnly = currentItems.filter((item) => !importedById.has(item.id));
  const importedIds = new Set(importedItems.map((item) => item.id));
  const nextItems = currentItems.map((item) => importedById.get(item.id) ?? item);
  importedItems.filter((item) => !existingById.has(item.id)).forEach((item) => nextItems.push(item));

  return {
    checkedAt,
    rowCount: rowResults.length,
    columnCount: headers.length,
    importedCount: importedItems.length,
    newItems: comparisons.filter((item) => item.status === "new"),
    changedItems: comparisons.filter((item) => item.status === "changed"),
    sameItems: comparisons.filter((item) => item.status === "same"),
    siteOnlyItems: siteOnly.map((item) => ({ id: item.id, title: item.title })),
    errors,
    nextData: errors.length === 0 ? { checkedAt, items: nextItems } : null,
    importedIds,
  };
}

function extractTableRows(html) {
  if (typeof DOMParser === "undefined") throw new Error("이 브라우저에서는 부동산뱅크 파일을 읽을 수 없습니다.");
  const safeHtml = html.replace(/<(?:script|style|iframe|object|embed|img|link|video|audio|source)\b[^>]*>[\s\S]*?<\/(?:script|style|iframe|object|embed|video|audio)>/giu, "")
    .replace(/<(?:script|style|iframe|object|embed|img|link|video|audio|source)\b[^>]*\/?\s*>/giu, "");
  const document = new DOMParser().parseFromString(safeHtml, "text/html");
  for (const table of document.querySelectorAll("table")) {
    const rows = [...table.querySelectorAll("tr")].map((row) => [...row.querySelectorAll(":scope > th, :scope > td")].map((cell) => normalizeBankListingText(cell.textContent)));
    if (rows.length > 0 && rows[0].includes("매물번호 (네이버번호)")) return { headers: rows[0], rows: rows.slice(1) };
  }
  throw new Error("부동산뱅크 매물 표를 찾지 못했습니다.");
}

export async function readBankListingFile(file) {
  if (!(file instanceof File)) throw new Error("부동산뱅크 엑셀 파일을 선택해 주세요.");
  if (!file.name.toLocaleLowerCase("en-US").endsWith(".xls")) throw new Error("부동산뱅크 .xls 파일만 선택할 수 있습니다.");
  if (file.size <= 0 || file.size > BANK_LISTING_MAX_FILE_BYTES) throw new Error("부동산뱅크 파일은 5MB 이하이어야 합니다.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf) throw new Error("바이너리 XLS는 지원하지 않습니다. 부동산뱅크에서 다시 엑셀출력해 주세요.");
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) throw new Error("XLSX는 지원하지 않습니다. 부동산뱅크 .xls 파일을 선택해 주세요.");
  let html;
  try {
    html = new TextDecoder("euc-kr", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("부동산뱅크 EUC-KR 파일을 읽지 못했습니다.");
  }
  if (!/<table\b/iu.test(html) || !/charset\s*=\s*["']?(?:euc-kr|ks_c_5601-1987|cp949)/iu.test(html)) {
    throw new Error("지원하지 않는 부동산뱅크 파일 형식입니다.");
  }
  return extractTableRows(html);
}

export function createManualNaverListing(input) {
  const id = normalizeBankListingText(input?.id);
  const listing = {
    id,
    title: normalizeBankListingText(input?.title),
    propertyType: normalizeBankListingText(input?.propertyType),
    tradeType: normalizeBankListingText(input?.tradeType),
    priceLabel: normalizeBankListingText(input?.priceLabel),
    areaLabel: normalizeBankListingText(input?.areaLabel) || null,
    floorLabel: normalizeBankListingText(input?.floorLabel) || null,
    direction: normalizeBankListingText(input?.direction) || null,
    summary: normalizeBankListingText(input?.summary),
    confirmedAt: normalizeBankListingText(input?.confirmedAt),
    source: "네이버페이 부동산",
    url: `https://fin.land.naver.com/articles/${id}`,
  };
  const errors = [];
  if (!/^\d+$/u.test(listing.id)) errors.push("네이버 매물번호는 숫자만 입력해 주세요.");
  for (const key of ["title", "propertyType", "priceLabel", "summary"]) {
    if (!listing[key]) errors.push("필수 공개 정보를 모두 입력해 주세요.");
  }
  if (!["sale", "jeonse", "monthly-rent"].includes(listing.tradeType)) errors.push("거래 유형을 확인해 주세요.");
  if (!isIsoDate(listing.confirmedAt)) errors.push("확인일을 입력해 주세요.");
  errors.push(...getNaverListingPublicTextErrors(listing, "수동 매물").map((message) => message.replace(/^수동 매물\.[^:]+:\s*/u, "")));
  return { listing, errors: [...new Set(errors)] };
}
