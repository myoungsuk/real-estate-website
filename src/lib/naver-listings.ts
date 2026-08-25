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

export const naverTradeNames: Record<NaverListingTradeType, string> = {
  sale: "매매",
  jeonse: "전세",
  "monthly-rent": "월세",
};
