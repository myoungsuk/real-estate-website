import { getNaverListingPublicTextErrors } from "../../src/lib/naver-listing-public-validation.mjs";
import { validateNaverListings } from "../content-validation.mjs";

export const BANK_OFFICE_START_URL = "https://land.neonet.co.kr/r/info/503143";
export const BANK_OFFICE_HOSTS = new Set(["0427214924.neonet.co.kr", "land.neonet.co.kr"]);
export const BANK_OFFICE_PATH = "/r/info/503143";
export const BANK_OFFICE_NAME = "리더스시티행복한공인중개사사무소";
export const BANK_SYNC_STATE_VERSION = 1;
export const BANK_SYNC_MAX_PAGES = 10;

const tradeTypeMap = new Map([
  ["매매", "sale"],
  ["전세", "jeonse"],
  ["월세", "monthly-rent"],
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

function trustError(message) {
  return new Error(`부동산뱅크 공개 매물 신뢰 검증 실패: ${message}`);
}

function decodeCodePoint(value, radix) {
  const codePoint = Number.parseInt(value, radix);
  if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return "";
  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return "";
  }
}

export function decodeHtmlEntities(value) {
  return String(value ?? "")
    .replace(/&#x([0-9a-f]+);/giu, (_, codePoint) => decodeCodePoint(codePoint, 16))
    .replace(/&#([0-9]+);/gu, (_, codePoint) => decodeCodePoint(codePoint, 10))
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;/giu, "\"")
    .replace(/&(?:apos|#39);/giu, "'");
}

export function normalizeBankPublicText(value) {
  return decodeHtmlEntities(value)
    .normalize("NFC")
    .replace(/[\u00a0\u200b]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function stripHtml(value) {
  return normalizeBankPublicText(String(value ?? "")
    .replace(/<!--[\s\S]*?-->/gu, " ")
    .replace(/<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>/giu, " ")
    .replace(/<br\s*\/?\s*>/giu, " ")
    .replace(/<[^>]+>/gu, " "));
}

function attributeValue(tag, name) {
  const match = new RegExp(`\\b${name}\\s*=\\s*([\"'])([\\s\\S]*?)\\1`, "iu").exec(tag);
  return match?.[2] ?? null;
}

function anchorTags(value) {
  return [...String(value ?? "").matchAll(/<a\b[^>]*>/giu)].map((match) => match[0]);
}

function anchorBlocks(value) {
  return [...String(value ?? "").matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/giu)].map((match) => ({
    block: match[0],
    tag: /^<a\b[^>]*>/iu.exec(match[0])?.[0] ?? "",
  }));
}

function parseNaverIdFromHref(value) {
  return /onClickOpenNaverDetail\(\s*'(\d+)'\s*\)/u.exec(value ?? "")?.[1] ?? null;
}

function parseBankIdFromHref(value) {
  const match = /onClickOpenDetail\(\s*'([A-Z]+)'\s*,\s*'(\d+)'\s*\)/u.exec(value ?? "");
  return match ? { bankType: match[1], bankId: match[2] } : null;
}

function mobileDirections(html) {
  const byId = new Map();
  for (const match of html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/giu)) {
    const block = match[0];
    if (!/\boffer_contents\b/iu.test(block)) continue;
    const openingTag = /^<a\b[^>]*>/iu.exec(block)?.[0] ?? "";
    const naverId = parseNaverIdFromHref(attributeValue(openingTag, "href"));
    if (!naverId) continue;
    const paragraphs = [...block.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/giu)].map((paragraph) => stripHtml(paragraph[1]));
    const details = paragraphs[2] ?? "";
    const direction = normalizeBankPublicText(details.split(",").at(-1)).replace(/[.。]+$/u, "") || null;
    if (byId.has(naverId)) throw trustError(`모바일 매물 ID가 중복됩니다: ${naverId}`);
    byId.set(naverId, direction);
  }
  return byId;
}

function parseIsoDate(value) {
  const match = /^(\d{2})\.(\d{2})\.(\d{2})$/u.exec(normalizeBankPublicText(value));
  if (!match) return null;
  const year = 2000 + Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normalizeComplexName(value) {
  return normalizeBankPublicText(value)
    .replace(/^리더스시티\s*4\s*BL$/iu, "리더스시티 4블록")
    .replace(/^리더스시티\s*5\s*BL$/iu, "리더스시티 5블록");
}

function formatManWon(value) {
  const normalized = normalizeBankPublicText(value).replaceAll(",", "");
  if (!/^\d+$/u.test(normalized)) return null;
  const manWon = Number(normalized);
  if (!Number.isSafeInteger(manWon) || manWon <= 0) return null;
  const eok = Math.floor(manWon / 10_000);
  const remainder = manWon % 10_000;
  if (eok > 0 && remainder > 0) return `${eok}억 ${remainder.toLocaleString("ko-KR")}`;
  if (eok > 0) return `${eok}억`;
  return remainder.toLocaleString("ko-KR");
}

function formatPriceLabel(value, tradeType) {
  if (tradeType !== "monthly-rent") return formatManWon(value);
  const match = /^([\d,]+)\s*\/\s*([\d,]+)$/u.exec(normalizeBankPublicText(value));
  if (!match) return null;
  const deposit = Number(match[1].replaceAll(",", ""));
  const monthly = Number(match[2].replaceAll(",", ""));
  if (!Number.isSafeInteger(deposit) || deposit < 0 || !Number.isSafeInteger(monthly) || monthly <= 0) return null;
  return `${deposit.toLocaleString("ko-KR")}/${monthly.toLocaleString("ko-KR")}`;
}

function formatAreaLabel(value, propertyType) {
  const match = /^(\d+(?:\.\d+)?)([A-Za-z0-9-]*)\s*\/\s*(\d+(?:\.\d+)?)$/u.exec(normalizeBankPublicText(value));
  if (!match) return null;
  const supply = Number(match[1]);
  const exclusive = Number(match[3]);
  if (!Number.isFinite(supply) || supply <= 0 || !Number.isFinite(exclusive) || exclusive <= 0) return null;
  const supplyLabel = `${Number.isInteger(supply) ? supply : String(supply)}${match[2].toUpperCase()}`;
  const exclusiveLabel = Number.isInteger(exclusive) ? exclusive : String(exclusive);
  if (propertyType === "단독/다가구") return `대지 ${supplyLabel}㎡ · 연면적 ${exclusiveLabel}㎡`;
  return `${supplyLabel}㎡ · 전용 ${exclusiveLabel}${match[2].toUpperCase()}㎡`;
}

function formatFloorLabel(value) {
  const normalized = normalizeBankPublicText(value).replace(/\s+/gu, "");
  if (!normalized) return null;
  if (/층$/u.test(normalized)) return normalized;
  if (/^(?:-?\d+|저|중|고)\/(?:\d+)$/u.test(normalized)) return `${normalized}층`;
  if (/^-?\d+$/u.test(normalized)) return `${normalized}층`;
  return null;
}

function parseDesktopListings(html) {
  const directions = mobileDirections(html);
  const rows = [...html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/giu)].map((match) => match[0]);
  const listings = [];

  rows.forEach((row, index) => {
    const anchors = anchorTags(row);
    const naverAnchor = anchorBlocks(row).find(({ tag }) => {
      const classes = normalizeBankPublicText(attributeValue(tag, "class"));
      return classes.split(" ").includes("link_blue") && parseNaverIdFromHref(attributeValue(tag, "href"));
    });
    if (!naverAnchor) return;

    const naverId = parseNaverIdFromHref(attributeValue(naverAnchor.tag, "href"));
    const bank = anchors.map((tag) => parseBankIdFromHref(attributeValue(tag, "href"))).find(Boolean);
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/giu)].map((cell) => stripHtml(cell[1]));
    if (!naverId || !bank) throw trustError("매물번호 링크를 해석하지 못했습니다.");
    if (cells.length !== 8) throw trustError(`${naverId}: 데스크톱 매물 컬럼이 8개가 아닙니다.`);

    const tradeType = tradeTypeMap.get(cells[0]);
    if (!tradeType) throw trustError(`${naverId}: 지원하지 않는 거래 유형입니다.`);
    const confirmedAt = parseIsoDate(cells[3]);
    if (!confirmedAt) throw trustError(`${naverId}: 확인일을 해석하지 못했습니다.`);
    const descriptionRow = rows[index + 1] ?? "";
    const summary = /onClickOpenNaverDetail/u.test(descriptionRow) ? "" : stripHtml(descriptionRow);

    const listing = {
      naverId,
      bankId: bank.bankId,
      bankType: bank.bankType,
      tradeType,
      propertyType: cells[1],
      location: cells[2],
      confirmedAt,
      title: stripHtml(naverAnchor.block),
      area: cells[5],
      floor: cells[6],
      price: cells[7],
      direction: directions.get(naverId) ?? null,
      summary,
    };
    for (const key of ["propertyType", "location", "title", "area", "floor", "price", "summary"]) {
      if (!listing[key]) throw trustError(`${naverId}: ${key} 값이 비어 있습니다.`);
    }
    listings.push(listing);
  });
  return listings;
}

function parsePageNumbers(html) {
  const pageNumbers = new Set([1]);
  for (const tag of anchorTags(html)) {
    const href = decodeHtmlEntities(attributeValue(tag, "href") ?? "");
    const page = Number(/[?&]page=(\d+)/u.exec(href)?.[1]);
    if (Number.isSafeInteger(page) && page > 0) pageNumbers.add(page);
  }
  return [...pageNumbers].sort((left, right) => left - right);
}

export function parseBankPublicPage(html, { expectedOfficeName = BANK_OFFICE_NAME } = {}) {
  if (typeof html !== "string" || html.length === 0) throw trustError("HTML이 비어 있습니다.");
  if (!html.includes(expectedOfficeName)) throw trustError("승인된 중개사무소 페이지가 아닙니다.");
  const totalMatch = /등록한\s*매물\s*수\s*\(\s*(\d+)\s*건\s*\)/u.exec(stripHtml(html));
  if (!totalMatch) throw trustError("전체 매물 수를 확인하지 못했습니다.");
  const total = Number(totalMatch[1]);
  if (!Number.isSafeInteger(total) || total < 0) throw trustError("전체 매물 수가 올바르지 않습니다.");
  const listings = parseDesktopListings(html);
  if (total > 0 && listings.length === 0) throw trustError("공개 매물 표를 찾지 못했습니다.");
  const ids = new Set();
  for (const listing of listings) {
    if (ids.has(listing.naverId)) throw trustError(`한 페이지에 네이버 매물번호가 중복됩니다: ${listing.naverId}`);
    ids.add(listing.naverId);
  }
  return { total, listings, pageNumbers: parsePageNumbers(html) };
}

export function mergeBankPublicPages(pages) {
  if (!Array.isArray(pages) || pages.length === 0) throw trustError("수집한 페이지가 없습니다.");
  const totals = new Set(pages.map(({ total }) => total));
  if (totals.size !== 1) throw trustError("페이지별 전체 매물 수가 서로 다릅니다.");
  const total = pages[0].total;
  const listings = pages.flatMap((page) => page.listings);
  const ids = new Set();
  for (const listing of listings) {
    if (ids.has(listing.naverId)) throw trustError(`페이지 사이에 네이버 매물번호가 중복됩니다: ${listing.naverId}`);
    ids.add(listing.naverId);
  }
  if (listings.length !== total) throw trustError(`전체 ${total}건 중 ${listings.length}건만 수집했습니다.`);
  return { total, listings };
}

function createPublicListing(candidate, existing) {
  const priceLabel = formatPriceLabel(candidate.price, candidate.tradeType);
  const areaLabel = existing?.areaLabel ?? formatAreaLabel(candidate.area, candidate.propertyType);
  const floorLabel = formatFloorLabel(candidate.floor);
  const title = existing?.title ?? normalizeComplexName(candidate.title);
  const candidateSummary = candidate.summary || "";
  const summaryPrefix = candidateSummary.replace(/\.{3}$/u, "").trim();
  const summary = candidateSummary.endsWith("...") && existing?.summary?.startsWith(summaryPrefix)
    ? existing.summary
    : candidateSummary || existing?.summary || "";
  if (!priceLabel || !areaLabel || !floorLabel || !title || !summary) {
    throw trustError(`${candidate.naverId}: 홈페이지 카드 필수 정보를 만들 수 없습니다.`);
  }
  const listing = {
    id: candidate.naverId,
    title,
    propertyType: candidate.propertyType,
    tradeType: candidate.tradeType,
    priceLabel,
    areaLabel,
    floorLabel,
    direction: candidate.direction ?? existing?.direction ?? null,
    summary,
    confirmedAt: candidate.confirmedAt,
    source: "네이버페이 부동산",
    url: `https://fin.land.naver.com/articles/${candidate.naverId}`,
  };
  const privacyErrors = getNaverListingPublicTextErrors(listing, `부동산뱅크 ${candidate.naverId}`);
  if (privacyErrors.length > 0) throw trustError(`${candidate.naverId}: 공개 안전 검증을 통과하지 못했습니다. ${privacyErrors.join(" ")}`);
  return listing;
}

export function validateBankSyncState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) throw trustError("동기화 상태가 객체가 아닙니다.");
  if (state.version !== BANK_SYNC_STATE_VERSION) throw trustError("동기화 상태 버전이 올바르지 않습니다.");
  if (state.officePath !== BANK_OFFICE_PATH) throw trustError("동기화 상태의 중개사무소 경로가 다릅니다.");
  if (state.updatedAt !== null && !/^\d{4}-\d{2}-\d{2}$/u.test(state.updatedAt ?? "")) {
    throw trustError("동기화 상태 updatedAt이 올바르지 않습니다.");
  }
  if (!Array.isArray(state.items)) throw trustError("동기화 상태 items가 배열이 아닙니다.");
  const naverIds = new Set();
  const bankIds = new Set();
  for (const [index, item] of state.items.entries()) {
    const keys = item && typeof item === "object" && !Array.isArray(item) ? Object.keys(item).sort() : [];
    if (keys.join(",") !== "bankId,naverId" || !/^\d+$/u.test(item?.naverId ?? "") || !/^\d+$/u.test(item?.bankId ?? "")) {
      throw trustError(`동기화 상태 items[${index}] 형식이 올바르지 않습니다.`);
    }
    if (naverIds.has(item.naverId) || bankIds.has(item.bankId)) throw trustError("동기화 상태의 매물번호가 중복됩니다.");
    naverIds.add(item.naverId);
    bankIds.add(item.bankId);
  }
}

function changedFields(previous, next) {
  return comparedFields.filter((key) => previous?.[key] !== next[key]);
}

export function planBankListingSync(currentData, snapshot, state, checkedAt) {
  const currentErrors = validateNaverListings(currentData);
  if (currentErrors.length > 0) throw trustError(`기존 naver-listings.json 검증 실패: ${currentErrors.join(" ")}`);
  validateBankSyncState(state);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(checkedAt ?? "")) throw trustError("실행 기준일이 올바르지 않습니다.");
  if (!snapshot || !Number.isSafeInteger(snapshot.total) || snapshot.total < 0 || snapshot.total !== snapshot.listings?.length) {
    throw trustError("수집 결과가 완전하지 않습니다.");
  }

  const currentById = new Map(currentData.items.map((item) => [item.id, item]));
  const crawledById = new Map(snapshot.listings.map((item) => [item.naverId, item]));
  if (crawledById.size !== snapshot.listings.length) throw trustError("수집 결과에 네이버 매물번호가 중복됩니다.");
  const previousBankIds = new Set(state.items.map((item) => item.naverId));
  const removedIds = [...previousBankIds].filter((id) => !crawledById.has(id));
  const removedIdSet = new Set(removedIds);
  const nextById = new Map();
  const newItems = [];
  const changedItems = [];
  const sameItems = [];

  for (const candidate of snapshot.listings) {
    const existing = currentById.get(candidate.naverId);
    const listing = createPublicListing(candidate, existing);
    const changes = changedFields(existing, listing);
    if (!existing) newItems.push({ id: listing.id, title: listing.title });
    else if (changes.length > 0) changedItems.push({ id: listing.id, title: listing.title, changes });
    else sameItems.push({ id: listing.id, title: listing.title });
    nextById.set(listing.id, listing);
  }

  const nextItems = currentData.items
    .filter((item) => !removedIdSet.has(item.id))
    .map((item) => nextById.get(item.id) ?? item);
  for (const candidate of snapshot.listings) {
    if (!currentById.has(candidate.naverId)) nextItems.push(nextById.get(candidate.naverId));
  }
  const contentItemsChanged = newItems.length > 0 || changedItems.length > 0 || removedIds.length > 0;
  const nextData = {
    checkedAt: contentItemsChanged ? checkedAt : currentData.checkedAt,
    items: nextItems,
  };
  const nextErrors = validateNaverListings(nextData);
  if (nextErrors.length > 0) throw trustError(`동기화 결과 검증 실패: ${nextErrors.join(" ")}`);

  const nextStateItems = snapshot.listings
    .map(({ naverId, bankId }) => ({ naverId, bankId }))
    .sort((left, right) => left.naverId.localeCompare(right.naverId));
  const previousStateItems = [...state.items].sort((left, right) => left.naverId.localeCompare(right.naverId));
  const stateItemsChanged = JSON.stringify(previousStateItems) !== JSON.stringify(nextStateItems);
  const nextState = {
    version: BANK_SYNC_STATE_VERSION,
    officePath: BANK_OFFICE_PATH,
    updatedAt: stateItemsChanged ? checkedAt : state.updatedAt,
    items: nextStateItems,
  };
  validateBankSyncState(nextState);

  const currentIds = new Set(currentData.items.map((item) => item.id));
  const outsideBankIds = [...currentIds].filter((id) => !previousBankIds.has(id) && !crawledById.has(id));
  return {
    nextData,
    nextState,
    newItems,
    changedItems,
    sameItems,
    removedIds,
    outsideBankIds,
    contentChanged: JSON.stringify(nextData) !== JSON.stringify(currentData),
    stateChanged: JSON.stringify(nextState) !== JSON.stringify(state),
  };
}
