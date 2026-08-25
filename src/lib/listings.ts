import listingData from "../data/listings.json";

export type ListingStatus = "draft" | "published" | "contracted" | "ended";
export type TradeType = "sale" | "jeonse" | "monthly-rent";
export type ComplexId = "leaders-city-4" | "leaders-city-5";

export interface Listing {
  id: string;
  slug: string;
  title: string;
  status: ListingStatus;
  propertyType: "apartment";
  tradeType: TradeType;
  complex: ComplexId;
  salePriceKrw: number | null;
  depositKrw: number | null;
  monthlyRentKrw: number | null;
  exclusiveAreaM2: number;
  floorLabel?: string | null;
  direction?: string | null;
  moveIn?: string | null;
  summary: string;
  features: string[];
  source: string;
  confirmedAt: string;
  publishedAt: string | null;
}

export const listings = listingData as Listing[];
export const publishedListings = listings
  .filter((listing) => listing.status === "published")
  .sort((a, b) => b.confirmedAt.localeCompare(a.confirmedAt));

export const tradeNames: Record<TradeType, string> = {
  sale: "매매",
  jeonse: "전세",
  "monthly-rent": "월세",
};

export const complexNames: Record<ComplexId, string> = {
  "leaders-city-4": "리더스시티 4블록",
  "leaders-city-5": "리더스시티 5블록",
};

export function formatKoreanPrice(krw: number) {
  if (!Number.isSafeInteger(krw) || krw < 0) return "가격 확인 필요";
  const eok = Math.floor(krw / 100_000_000);
  const man = Math.floor((krw % 100_000_000) / 10_000);
  if (eok > 0 && man > 0) return `${eok}억 ${man.toLocaleString("ko-KR")}만원`;
  if (eok > 0) return `${eok}억원`;
  return `${man.toLocaleString("ko-KR")}만원`;
}

export function formatListingPrice(listing: Listing) {
  if (listing.tradeType === "sale" && listing.salePriceKrw !== null) {
    return formatKoreanPrice(listing.salePriceKrw);
  }
  if (listing.tradeType === "jeonse" && listing.depositKrw !== null) {
    return formatKoreanPrice(listing.depositKrw);
  }
  if (
    listing.tradeType === "monthly-rent" &&
    listing.depositKrw !== null &&
    listing.monthlyRentKrw !== null
  ) {
    return `${formatKoreanPrice(listing.depositKrw)} / ${formatKoreanPrice(listing.monthlyRentKrw)}`;
  }
  return "가격 확인 필요";
}

export function squareMetersToPyeong(squareMeters: number) {
  return Math.round((squareMeters / 3.3058) * 10) / 10;
}
