const TRADE_TYPES = new Set(["sale", "jeonse", "monthly-rent"]);
const SORT_KEYS = new Set(["latest", "price", "price-desc", "area", "area-desc"]);
const MAX_MONEY_VALUE = 10_000_000;
const MAX_AREA_VALUE = 10_000;

export const defaultListingExplorerState = Object.freeze({
  trade: "",
  propertyType: "",
  complex: "",
  sort: "latest",
  minPrice: null,
  maxPrice: null,
  minArea: null,
  maxArea: null,
  minDeposit: null,
  maxDeposit: null,
  minMonthlyRent: null,
  maxMonthlyRent: null,
});

function parseKoreanMoneyPart(value) {
  if (typeof value !== "string") return null;
  const normalized = value.replaceAll(",", "").replace(/\s+/gu, "").trim();
  if (!normalized || !/[0-9]/u.test(normalized)) return null;

  const eokIndex = normalized.indexOf("억");
  let amount;
  if (eokIndex >= 0) {
    const eokText = normalized.slice(0, eokIndex).replace(/[^0-9.]/gu, "");
    const remainderText = normalized.slice(eokIndex + 1).replace(/[^0-9.]/gu, "");
    const eok = Number(eokText || 0);
    const remainder = Number(remainderText || 0);
    amount = eok * 10_000 + remainder;
  } else {
    amount = Number(normalized.replace(/[^0-9.]/gu, ""));
  }

  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

export function parseNaverListingPriceLabel(priceLabel, tradeType) {
  if (tradeType === "monthly-rent") {
    const parts = typeof priceLabel === "string" ? priceLabel.split("/") : [];
    if (parts.length !== 2) {
      return { standard: null, deposit: null, monthlyRent: null, valid: false };
    }
    const deposit = parseKoreanMoneyPart(parts[0]);
    const monthlyRent = parseKoreanMoneyPart(parts[1]);
    return {
      standard: null,
      deposit,
      monthlyRent,
      valid: deposit !== null && monthlyRent !== null,
    };
  }

  const standard = parseKoreanMoneyPart(priceLabel);
  return {
    standard,
    deposit: null,
    monthlyRent: null,
    valid: standard !== null,
  };
}

export function parseNaverListingAreaLabel(areaLabel) {
  if (typeof areaLabel !== "string") return null;
  const value = Number(areaLabel.match(/[0-9]+(?:\.[0-9]+)?/u)?.[0]);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function readRangeValue(value, max) {
  if (value === null || value === undefined || value === "") return null;
  const normalized = typeof value === "string" ? value.trim() : value;
  if (normalized === "") return null;
  const number = Number(normalized);
  return Number.isFinite(number) && number >= 0 && number <= max ? number : null;
}

function normalizeRange(state, minimumKey, maximumKey, errorKey, invalidRanges) {
  const minimum = state[minimumKey];
  const maximum = state[maximumKey];
  if (minimum !== null && maximum !== null && minimum > maximum) {
    state[minimumKey] = null;
    state[maximumKey] = null;
    invalidRanges.push(errorKey);
  }
}

export function normalizeListingExplorerQuery(input, options = {}) {
  const params = input instanceof URLSearchParams ? input : new URLSearchParams(input ?? "");
  const propertyTypes = new Set(options.propertyTypes ?? []);
  const complexes = new Set(options.complexes ?? []);
  const trade = TRADE_TYPES.has(params.get("trade")) ? params.get("trade") : "";
  const propertyType = propertyTypes.has(params.get("type")) ? params.get("type") : "";
  const complex = complexes.has(params.get("complex")) ? params.get("complex") : "";
  const sort = SORT_KEYS.has(params.get("sort")) ? params.get("sort") : "latest";
  const state = {
    trade,
    propertyType,
    complex,
    sort,
    minPrice: readRangeValue(params.get("minPrice"), MAX_MONEY_VALUE),
    maxPrice: readRangeValue(params.get("maxPrice"), MAX_MONEY_VALUE),
    minArea: readRangeValue(params.get("minArea"), MAX_AREA_VALUE),
    maxArea: readRangeValue(params.get("maxArea"), MAX_AREA_VALUE),
    minDeposit: readRangeValue(params.get("minDeposit"), MAX_MONEY_VALUE),
    maxDeposit: readRangeValue(params.get("maxDeposit"), MAX_MONEY_VALUE),
    minMonthlyRent: readRangeValue(params.get("minRent"), MAX_MONEY_VALUE),
    maxMonthlyRent: readRangeValue(params.get("maxRent"), MAX_MONEY_VALUE),
  };
  const invalidRanges = [];

  if (state.trade === "monthly-rent") {
    state.minPrice = null;
    state.maxPrice = null;
    normalizeRange(state, "minDeposit", "maxDeposit", "deposit", invalidRanges);
    normalizeRange(state, "minMonthlyRent", "maxMonthlyRent", "monthlyRent", invalidRanges);
  } else {
    state.minDeposit = null;
    state.maxDeposit = null;
    state.minMonthlyRent = null;
    state.maxMonthlyRent = null;
    if (!state.trade) {
      state.minPrice = null;
      state.maxPrice = null;
    } else {
      normalizeRange(state, "minPrice", "maxPrice", "price", invalidRanges);
    }
  }
  normalizeRange(state, "minArea", "maxArea", "area", invalidRanges);

  return { state, invalidRanges };
}

function isWithinRange(value, minimum, maximum) {
  if (minimum === null && maximum === null) return true;
  const number = Number(value);
  if (!Number.isFinite(number)) return false;
  return (minimum === null || number >= minimum) && (maximum === null || number <= maximum);
}

export function matchesListingExplorerState(listing, state) {
  if (state.trade && listing.trade !== state.trade) return false;
  if (state.propertyType && listing.propertyType !== state.propertyType) return false;
  if (state.complex && listing.complex !== state.complex) return false;
  if (!isWithinRange(listing.area, state.minArea, state.maxArea)) return false;

  if (state.trade === "monthly-rent") {
    return isWithinRange(listing.deposit, state.minDeposit, state.maxDeposit)
      && isWithinRange(listing.monthlyRent, state.minMonthlyRent, state.maxMonthlyRent);
  }
  return isWithinRange(listing.price, state.minPrice, state.maxPrice);
}

export function buildListingExplorerSearchParams(state) {
  const params = new URLSearchParams();
  if (state.trade) params.set("trade", state.trade);
  if (state.propertyType) params.set("type", state.propertyType);
  if (state.complex) params.set("complex", state.complex);
  if (state.sort && state.sort !== "latest") params.set("sort", state.sort);
  if (state.trade === "monthly-rent") {
    if (state.minDeposit !== null) params.set("minDeposit", String(state.minDeposit));
    if (state.maxDeposit !== null) params.set("maxDeposit", String(state.maxDeposit));
    if (state.minMonthlyRent !== null) params.set("minRent", String(state.minMonthlyRent));
    if (state.maxMonthlyRent !== null) params.set("maxRent", String(state.maxMonthlyRent));
  } else if (state.trade) {
    if (state.minPrice !== null) params.set("minPrice", String(state.minPrice));
    if (state.maxPrice !== null) params.set("maxPrice", String(state.maxPrice));
  }
  if (state.minArea !== null) params.set("minArea", String(state.minArea));
  if (state.maxArea !== null) params.set("maxArea", String(state.maxArea));
  return params;
}
