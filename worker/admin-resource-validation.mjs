import {
  validateComplexes,
  validateComplexOverview,
  validateExternalLinks,
  validateFaq,
  validateHomeContent,
  validateListings,
  validateNaverListings,
  validateOffice,
} from "../scripts/content-validation.mjs";

export const ADMIN_RESOURCE_PATHS = Object.freeze({
  listings: "src/data/listings.json",
  "naver-listings": "src/data/naver-listings.json",
  office: "src/data/office.json",
  complexes: "src/data/complexes.json",
  "complexes-overview": "src/data/complexes-overview.json",
  "external-links": "src/data/external-links.json",
  "home-content": "src/data/home-content.json",
  faq: "src/data/faq.json",
  reviews: "src/data/reviews.json",
});

export function getAdminResourcePath(resource) {
  return ADMIN_RESOURCE_PATHS[resource] ?? null;
}

export function validateAdminResource(resource, data) {
  switch (resource) {
    case "listings": return validateListings(data);
    case "naver-listings": return validateNaverListings(data);
    case "office": return validateOffice(data);
    case "complexes": return validateComplexes(data);
    case "complexes-overview": return validateComplexOverview(data);
    case "external-links": return validateExternalLinks(data);
    case "home-content": return validateHomeContent(data);
    case "faq": return validateFaq(data);
    case "reviews": return Array.isArray(data) ? [] : ["reviews: 배열이어야 합니다."];
    default: return ["허용되지 않은 콘텐츠 종류입니다."];
  }
}
