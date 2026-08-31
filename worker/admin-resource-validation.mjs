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
import { ADMIN_RESOURCE_PATHS } from "../src/lib/admin-resource-digest.mjs";
import { validateListingReviewState } from "../src/lib/listing-review.mjs";

export { ADMIN_RESOURCE_PATHS };

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

function validateListingReviewResource(data, currentResources) {
  const listingIds = Array.isArray(currentResources?.["naver-listings"]?.items)
    ? currentResources["naver-listings"].items.map((item) => item?.id).filter((id) => typeof id === "string")
    : Object.keys(data?.items ?? {});
  const bankIds = Object.entries(data?.items ?? {})
    .filter(([, item]) => item?.source === "bank")
    .map(([id]) => id);
  try {
    validateListingReviewState(data, { listingIds, bankIds });
    return [];
  } catch (error) {
    return [error instanceof Error ? error.message : "매물 재확인 상태가 올바르지 않습니다."];
  }
}

export function validateAdminResource(resource, data, currentResources = null) {
  if (resource === "listing-review-state") {
    const errors = validateListingReviewResource(data, currentResources);
    errors.push(...findBannedKeys(data, resource));
    errors.push(...findSensitiveStrings(data, { path: resource, office: null }));
    return [...new Set(errors)];
  }
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
