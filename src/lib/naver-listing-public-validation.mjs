export const NAVER_LISTING_PUBLIC_KEYS = Object.freeze([
  "id",
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
]);

const publicTextKeys = [
  "title",
  "propertyType",
  "priceLabel",
  "areaLabel",
  "floorLabel",
  "direction",
  "summary",
];

const phonePattern = /(?:^|[^\d])(?:01[016789]|0\d{1,2})[-.\s]?\d{3,4}[-.\s]?\d{4}(?!\d)/u;
const exactUnitPattern = /(?:^|[^\d])\d{1,4}\s*호(?!선|점|기|차)/u;
const privateRolePattern = /(?:소유자|매도자|임대인|임차인)\s*(?:명|연락처|전화|휴대폰|핸드폰|:)/u;
const htmlPattern = /<\s*\/?\s*[a-z][^>]*>/iu;

export function getNaverListingPublicTextErrors(listing, path = "naverListing") {
  const errors = [];
  for (const key of publicTextKeys) {
    const value = listing?.[key];
    if (typeof value !== "string" || value.trim() === "") continue;
    if (phonePattern.test(value)) errors.push(`${path}.${key}: 전화번호를 공개 매물에 저장할 수 없습니다.`);
    if (exactUnitPattern.test(value)) errors.push(`${path}.${key}: 정확한 호수를 공개 매물에 저장할 수 없습니다.`);
    if (privateRolePattern.test(value)) errors.push(`${path}.${key}: 의뢰인·소유자 정보를 공개 매물에 저장할 수 없습니다.`);
    if (htmlPattern.test(value)) errors.push(`${path}.${key}: HTML 태그를 공개 매물에 저장할 수 없습니다.`);
  }
  return errors;
}

export function getUnexpectedNaverListingKeys(listing) {
  if (!listing || typeof listing !== "object" || Array.isArray(listing)) return [];
  const allowed = new Set(NAVER_LISTING_PUBLIC_KEYS);
  return Object.keys(listing).filter((key) => !allowed.has(key));
}
