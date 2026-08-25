const allowedStatuses = new Set(["draft", "published", "contracted", "ended"]);
const allowedTradeTypes = new Set(["sale", "jeonse", "monthly-rent"]);
const allowedComplexes = new Set(["leaders-city-4", "leaders-city-5"]);
const bannedKeys = new Set([
  "exactUnit",
  "unitNumber",
  "owner",
  "landlord",
  "tenant",
  "clientPhone",
  "internalMemo",
  "privateNote",
]);

function isPositiveSafeInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function isKebabCase(value) {
  return typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

export function findBannedKeys(value, path = "root", errors = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => findBannedKeys(item, `${path}[${index}]`, errors));
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (bannedKeys.has(key)) errors.push(`${path}.${key}: 공개 저장 금지 필드입니다.`);
      findBannedKeys(child, `${path}.${key}`, errors);
    }
  }
  return errors;
}

export function validateListing(listing, index = 0) {
  const path = `listings[${index}]`;
  const errors = [];
  if (!isKebabCase(listing.id)) errors.push(`${path}.id: 영문 kebab-case가 필요합니다.`);
  if (!isKebabCase(listing.slug)) errors.push(`${path}.slug: 영문 kebab-case가 필요합니다.`);
  if (!allowedStatuses.has(listing.status)) errors.push(`${path}.status: 허용되지 않은 상태입니다.`);
  if (!allowedTradeTypes.has(listing.tradeType)) errors.push(`${path}.tradeType: 허용되지 않은 거래유형입니다.`);
  if (!allowedComplexes.has(listing.complex)) errors.push(`${path}.complex: 4블록 또는 5블록이어야 합니다.`);

  const sale = listing.salePriceKrw;
  const deposit = listing.depositKrw;
  const monthly = listing.monthlyRentKrw;
  if (listing.tradeType === "sale" && (!isPositiveSafeInteger(sale) || deposit !== null || monthly !== null)) {
    errors.push(`${path}: 매매는 salePriceKrw만 양의 정수로 입력합니다.`);
  }
  if (listing.tradeType === "jeonse" && (!isPositiveSafeInteger(deposit) || sale !== null || monthly !== null)) {
    errors.push(`${path}: 전세는 depositKrw만 양의 정수로 입력합니다.`);
  }
  if (listing.tradeType === "monthly-rent" && (!isPositiveSafeInteger(deposit) || !isPositiveSafeInteger(monthly) || sale !== null)) {
    errors.push(`${path}: 월세는 depositKrw와 monthlyRentKrw만 양의 정수로 입력합니다.`);
  }

  if (listing.status === "published") {
    for (const key of ["title", "summary", "source", "confirmedAt"]) {
      if (typeof listing[key] !== "string" || listing[key].trim() === "") errors.push(`${path}.${key}: 공개 매물 필수값입니다.`);
    }
    if (!(typeof listing.exclusiveAreaM2 === "number" && listing.exclusiveAreaM2 > 0)) errors.push(`${path}.exclusiveAreaM2: 양수여야 합니다.`);
    if (!Array.isArray(listing.features)) errors.push(`${path}.features: 배열이어야 합니다.`);
  }

  return errors;
}

export function validateContent({ office, listings, complexes, externalLinks, faq, reviews }) {
  const errors = [];
  for (const key of ["legalName", "representative", "mobile", "address", "registrationNumber"]) {
    if (typeof office[key] !== "string" || office[key].trim() === "") errors.push(`office.${key}: 확정 공개 정보가 필요합니다.`);
  }
  if (!Array.isArray(listings)) errors.push("listings: 배열이어야 합니다.");
  if (!Array.isArray(complexes) || complexes.length !== 2) errors.push("complexes: 4블록과 5블록 두 항목이 필요합니다.");
  if (!Array.isArray(externalLinks) || !Array.isArray(faq) || !Array.isArray(reviews)) errors.push("외부 콘텐츠·FAQ·후기는 배열이어야 합니다.");

  if (Array.isArray(listings)) {
    const ids = new Set();
    const slugs = new Set();
    listings.forEach((listing, index) => {
      errors.push(...validateListing(listing, index));
      if (ids.has(listing.id)) errors.push(`listings[${index}].id: 중복 ID입니다.`);
      if (slugs.has(listing.slug)) errors.push(`listings[${index}].slug: 중복 slug입니다.`);
      ids.add(listing.id);
      slugs.add(listing.slug);
    });
  }

  for (const [index, link] of externalLinks.entries()) {
    try {
      const url = new URL(link.url);
      if (url.protocol !== "https:") errors.push(`externalLinks[${index}].url: HTTPS만 허용합니다.`);
    } catch {
      errors.push(`externalLinks[${index}].url: 올바른 URL이 아닙니다.`);
    }
  }

  errors.push(...findBannedKeys({ office, listings, complexes, externalLinks, faq, reviews }));
  return errors;
}
