// 글 초안(P3) 자료 고르기: 번들에 들어간 공개 JSON에서만 고를 자료와 사실 값을 만든다(설계서 22.11절 1).
// 화면(자료 목록 표시)과 Worker(GET /work/blog/sources, 만들기 때 다시 찾기)가 같은 함수를 쓴다. 자료를 바꾸지 않는다.
// - 네이버 매물(naver-listings.json): 표기 글자(가격 "2억 6,000"·"10,000/140"은 만 원 단위, 면적 "111B㎡ · 전용 84.77B㎡", 층 "2/22층"·"중/15층")를 숫자로 읽는다.
// - 홈페이지 매물(listings.json): published만.
// - 단지(complexes.json): published만. 단지 소개 글은 매물 숫자가 없다(DEC-WT-34).
// - 매물 종류별 명시 규칙(ad-disclosure-rules.json)에 없는 종류나 막아 둔 종류(분양권)는 목록에 남기되 고를 수 없게 이유를 붙인다.
import { parseNaverListingPriceLabel } from "../naver-listing-filter.mjs";

const MAN_WON = 10_000;
const FLOOR_BANDS = new Set(["저", "중", "고"]);
export const BLOG_SOURCE_TYPES = Object.freeze(["naver_listing", "listing", "complex"]);
export const TRADE_LABELS = Object.freeze({ sale: "매매", jeonse: "전세", "monthly-rent": "월세" });

const roundArea = (value) => Math.round(value * 100) / 100;

// 만 원 단위 표기 → 원(정수). 읽지 못하면 null.
export function readPriceFacts(priceLabel, tradeType) {
  const parts = parseNaverListingPriceLabel(priceLabel, tradeType);
  const toWon = (value) => (Number.isFinite(value) && value !== null ? Math.round(value * MAN_WON) : null);
  if (tradeType === "monthly-rent") {
    const depositWon = toWon(parts.deposit);
    const monthlyRentWon = toWon(parts.monthlyRent);
    return depositWon !== null && monthlyRentWon !== null ? { priceWon: null, depositWon, monthlyRentWon } : null;
  }
  const value = toWon(parts.standard ?? parts.deposit ?? null);
  if (value === null || value <= 0) return null;
  return tradeType === "jeonse" ? { priceWon: null, depositWon: value, monthlyRentWon: null } : { priceWon: value, depositWon: null, monthlyRentWon: null };
}

// "111B㎡ · 전용 84.77B㎡" → { exclusiveM2: 84.77, otherAreasM2: [111] }, "대지 4027㎡" → { landM2: 4027 }.
// 타입 글자(B·C)는 무시한다. 전용면적이 없으면 exclusiveM2는 null(화면에서 넣어야 함).
export function readAreaFacts(areaLabel) {
  const result = { exclusiveM2: null, landM2: null, otherAreasM2: [] };
  if (typeof areaLabel !== "string") return result;
  for (const piece of areaLabel.split("·")) {
    const number = Number(piece.match(/[0-9]+(?:\.[0-9]+)?/u)?.[0]);
    if (!Number.isFinite(number) || number <= 0) continue;
    if (/전용/u.test(piece)) result.exclusiveM2 = roundArea(number);
    else if (/대지/u.test(piece) && !/연면적/u.test(areaLabel)) result.landM2 = roundArea(number);
    else result.otherAreasM2.push(roundArea(number));
  }
  return result;
}

// "2/22층" → { floor: 2, band: null, totalFloors: 22 }, "중/15층" → { floor: null, band: "중", totalFloors: 15 }, "1층" → { floor: 1, totalFloors: null }.
export function readFloorFacts(floorLabel) {
  const empty = { floor: null, band: null, totalFloors: null };
  if (typeof floorLabel !== "string" || floorLabel.trim() === "") return empty;
  const text = floorLabel.replace(/\s/gu, "");
  const pair = text.match(/^(-?\d{1,3}|[저중고])\/(\d{1,3})층$/u);
  if (pair) {
    const total = Number(pair[2]);
    if (FLOOR_BANDS.has(pair[1])) return { floor: null, band: pair[1], totalFloors: total };
    return { floor: Number(pair[1]), band: null, totalFloors: total };
  }
  const single = text.match(/^(-?\d{1,3})층$/u);
  if (single) return { floor: Number(single[1]), band: null, totalFloors: null };
  return empty;
}

// 매물 종류 → 명시 규칙 분류. 규칙이 없거나 막아 둔 종류면 { category: null, blockedReason }.
export function classifyPropertyType(propertyType, rules) {
  const blocked = rules.blockedPropertyTypes.find((entry) => entry.propertyType === propertyType);
  if (blocked) return { category: null, blockedReason: blocked.reason };
  const category = rules.categories.find((entry) => entry.propertyTypes.includes(propertyType));
  if (!category) return { category: null, blockedReason: "이 매물 종류는 명시 기준을 아직 정하지 않아 고를 수 없습니다." };
  return { category: category.id, blockedReason: null };
}

function naverSource(item, rules) {
  const { category, blockedReason } = classifyPropertyType(item.propertyType, rules);
  const price = readPriceFacts(item.priceLabel, item.tradeType);
  const area = readAreaFacts(item.areaLabel);
  const floor = readFloorFacts(item.floorLabel);
  return {
    type: "naver_listing",
    id: item.id,
    title: item.title,
    category,
    blockedReason: blockedReason ?? (price ? null : "가격 표기를 읽지 못해 고를 수 없습니다."),
    facts: {
      propertyType: item.propertyType,
      tradeType: item.tradeType,
      priceWon: price?.priceWon ?? null,
      depositWon: price?.depositWon ?? null,
      monthlyRentWon: price?.monthlyRentWon ?? null,
      exclusiveM2: area.exclusiveM2,
      landM2: area.landM2,
      otherAreasM2: area.otherAreasM2,
      floor: floor.floor,
      floorBand: floor.band,
      totalFloors: floor.totalFloors,
      direction: typeof item.direction === "string" && item.direction.trim() ? item.direction.trim() : null,
      summary: typeof item.summary === "string" ? item.summary : "",
      registeredAt: item.registeredAt ?? null,
    },
  };
}

function homepageSource(item, rules) {
  const propertyType = item.propertyType === "apartment" ? "아파트" : item.propertyType;
  const { category, blockedReason } = classifyPropertyType(propertyType, rules);
  const floor = readFloorFacts(item.floorLabel ?? null);
  return {
    type: "listing",
    id: item.id,
    title: item.title,
    category,
    blockedReason,
    facts: {
      propertyType,
      tradeType: item.tradeType,
      priceWon: item.tradeType === "sale" ? item.salePriceKrw : null,
      depositWon: item.tradeType === "sale" ? null : item.depositKrw,
      monthlyRentWon: item.tradeType === "monthly-rent" ? item.monthlyRentKrw : null,
      exclusiveM2: Number.isFinite(item.exclusiveAreaM2) ? roundArea(item.exclusiveAreaM2) : null,
      landM2: null,
      otherAreasM2: [],
      floor: floor.floor,
      floorBand: floor.band,
      totalFloors: floor.totalFloors,
      direction: typeof item.direction === "string" && item.direction.trim() ? item.direction.trim() : null,
      summary: typeof item.summary === "string" ? item.summary : "",
      registeredAt: item.publishedAt ?? null,
    },
  };
}

function complexSource(item) {
  return {
    type: "complex",
    id: item.slug,
    title: item.name,
    category: "complex",
    blockedReason: null,
    facts: {
      areaName: item.areaName ?? null,
      summary: typeof item.summary === "string" ? item.summary : "",
      items: (Array.isArray(item.facts) ? item.facts : [])
        .filter((fact) => typeof fact?.label === "string" && typeof fact?.value === "string")
        .map((fact) => ({ label: fact.label, value: fact.value })),
    },
  };
}

// 고를 수 있는 공개 자료 전부(종류 순서: 네이버 매물 → 홈페이지 매물 → 단지).
export function listBlogSources({ naverListings, listings, complexes, rules }) {
  const naver = (naverListings?.items ?? []).map((item) => naverSource(item, rules));
  const homepage = (Array.isArray(listings) ? listings : []).filter((item) => item?.status === "published").map((item) => homepageSource(item, rules));
  const complexItems = (Array.isArray(complexes) ? complexes : []).filter((item) => item?.status === "published").map(complexSource);
  return [...naver, ...homepage, ...complexItems];
}

export function findBlogSource(sources, type, id) {
  return sources.find((source) => source.type === type && source.id === id) ?? null;
}

// 찾기: 띄어쓰기·대소문자를 무시하고 제목·종류·단지 동네에 들어 있으면 맞음.
export function matchesBlogSourceQuery(source, query) {
  const needle = String(query ?? "").normalize("NFKC").replace(/\s/gu, "").toLowerCase();
  if (!needle) return true;
  const hay = [source.title, source.facts.propertyType, source.facts.areaName].filter(Boolean).join(" ").normalize("NFKC").replace(/\s/gu, "").toLowerCase();
  return hay.includes(needle);
}
