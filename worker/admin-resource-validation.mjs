import {
  findBannedKeys,
  findSensitiveStrings,
  findUnexpectedKeys,
  validateContent,
  validateComplexes,
  validateComplexOverview,
  validateExternalLinks,
  validateFaq,
  validateHomeContent,
  validateListings,
  validateNaverListings,
  validateOffice,
  validateReviews,
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

export const ADMIN_RESOURCE_CONTENT_KEYS = Object.freeze({
  listings: "listings",
  "naver-listings": "naverListings",
  office: "office",
  complexes: "complexes",
  "complexes-overview": "complexOverview",
  "external-links": "externalLinks",
  "home-content": "homeContent",
  faq: "faq",
  reviews: "reviews",
});

export function getAdminResourcePath(resource) {
  return ADMIN_RESOURCE_PATHS[resource] ?? null;
}

function validateSingleResource(resource, data) {
  switch (resource) {
    case "listings": return validateListings(data);
    case "naver-listings": return validateNaverListings(data);
    case "office": return validateOffice(data);
    case "complexes": return validateComplexes(data);
    case "complexes-overview": return validateComplexOverview(data);
    case "external-links": return validateExternalLinks(data);
    case "home-content": return validateHomeContent(data);
    case "faq": return validateFaq(data);
    case "reviews": return validateReviews(data);
    default: return ["허용되지 않은 콘텐츠 종류입니다."];
  }
}

export function validateAdminResource(resource, data, currentResources = null) {
  const contentKey = ADMIN_RESOURCE_CONTENT_KEYS[resource];
  if (!contentKey) return ["허용되지 않은 콘텐츠 종류입니다."];

  if (currentResources) {
    const content = {};
    for (const [resourceName, key] of Object.entries(ADMIN_RESOURCE_CONTENT_KEYS)) {
      content[key] = resourceName === resource ? data : currentResources[resourceName];
    }
    return validateContent(content);
  }

  const errors = validateSingleResource(resource, data);
  errors.push(...findUnexpectedKeys(contentKey, data, resource));
  errors.push(...findBannedKeys(data, resource));
  errors.push(...findSensitiveStrings(data, {
    path: resource,
    office: resource === "office" ? data : null,
  }));
  return [...new Set(errors)];
}
