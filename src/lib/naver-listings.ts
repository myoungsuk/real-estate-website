import naverListingData from "../data/naver-listings.json";
import { parseNaverListingAreaLabel, parseNaverListingPriceLabel } from "./naver-listing-filter.mjs";

export type NaverListingTradeType = "sale" | "jeonse" | "monthly-rent";

export interface NaverListing {
  id: string;
  title: string;
  propertyType: string;
  tradeType: NaverListingTradeType;
  priceLabel: string;
  areaLabel: string | null;
  floorLabel: string | null;
  direction: string | null;
  summary: string;
  registeredAt: string;
  source: "네이버페이 부동산";
  url: string;
}

export interface NaverListingData {
  checkedAt: string;
  items: NaverListing[];
}

const data = naverListingData as NaverListingData;

export const naverListingsUpdatedAt = data.checkedAt;
export const naverListings = [...data.items].sort((first, second) => second.registeredAt.localeCompare(first.registeredAt));
export const naverPropertyTypes = [...new Set(naverListings.map((listing) => listing.propertyType))];

export function getNaverListingPriceParts(priceLabel: string, tradeType: NaverListingTradeType) {
  return parseNaverListingPriceLabel(priceLabel, tradeType);
}

export function getNaverListingPriceValue(priceLabel: string, tradeType: NaverListingTradeType = "sale") {
  const price = getNaverListingPriceParts(priceLabel, tradeType);
  return price.standard ?? price.deposit ?? null;
}

export function getNaverListingAreaValue(areaLabel: string | null) {
  return parseNaverListingAreaLabel(areaLabel);
}

export const naverTradeNames: Record<NaverListingTradeType, string> = {
  sale: "매매",
  jeonse: "전세",
  "monthly-rent": "월세",
};
