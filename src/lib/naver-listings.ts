import naverListingData from "../data/naver-listings.json";

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
  confirmedAt: string;
  source: "네이버페이 부동산";
  url: string;
}

interface NaverListingData {
  checkedAt: string;
  items: NaverListing[];
}

const data = naverListingData as NaverListingData;

export const naverListingsCheckedAt = data.checkedAt;
export const naverListings = data.items;
export const naverPropertyTypes = [...new Set(naverListings.map((listing) => listing.propertyType))];

export function getNaverListingPriceValue(priceLabel: string) {
  const normalized = priceLabel.replaceAll(",", "").trim();
  const [eokPart, remainder = ""] = normalized.split("억");
  if (!normalized.includes("억")) return Number(normalized.replace(/[^0-9.]/g, "")) || 0;
  const eok = Number(eokPart.replace(/[^0-9.]/g, "")) || 0;
  const manWon = Number(remainder.replace(/[^0-9.]/g, "")) || 0;
  return eok * 10_000 + manWon;
}

export function getNaverListingAreaValue(areaLabel: string | null) {
  return Number(areaLabel?.match(/[0-9]+(?:\.[0-9]+)?/)?.[0] ?? 0);
}

export const naverTradeNames: Record<NaverListingTradeType, string> = {
  sale: "매매",
  jeonse: "전세",
  "monthly-rent": "월세",
};
