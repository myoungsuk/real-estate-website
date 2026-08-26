import {
  getNaverListingPublicTextErrors,
  getUnexpectedNaverListingKeys,
} from "../src/lib/naver-listing-public-validation.mjs";

const allowedStatuses = new Set(["draft", "published", "contracted", "ended"]);
const allowedTradeTypes = new Set(["sale", "jeonse", "monthly-rent"]);
const allowedComplexStatuses = new Set(["preparing", "published"]);
const allowedComplexSourceKinds = new Set(["official", "public-data", "operator", "news"]);
const allowedComplexAmenityVerifications = new Set(["official", "operator-confirmed", "historical-plan", "check-required"]);
const allowedComplexLivingCategories = new Set(["transport", "education", "daily-life", "nature"]);
const allowedExternalContentTypes = new Set(["blog", "youtube"]);
const allowedYoutubeContentFormats = new Set(["video", "short"]);
const allowedExternalContentStatuses = new Set(["draft", "published"]);
const allowedWeekDays = new Set(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]);
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

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isIsoDateOrNull(value) {
  return value === null || (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function isAllowedPublicImagePath(value) {
  return typeof value === "string"
    && value.startsWith("/images/")
    && !value.includes("..")
    && /\.(?:avif|jpe?g|png|webp)$/i.test(value);
}

function validateImage(image, path, { required = false } = {}) {
  if (image === null || image === undefined) return required ? [`${path}: 공개 이미지가 필요합니다.`] : [];
  const errors = [];
  if (!isAllowedPublicImagePath(image.src)) errors.push(`${path}.src: /images/ 아래의 공개 이미지 경로가 필요합니다.`);
  if (!isNonEmptyString(image.alt)) errors.push(`${path}.alt: 이미지 대체 텍스트가 필요합니다.`);
  return errors;
}

function validateTextPairs(items, path, firstKey, secondKey, { required = false } = {}) {
  if (!Array.isArray(items) || (required && items.length === 0)) {
    return [`${path}: ${required ? "한 개 이상의 항목" : "배열"}이 필요합니다.`];
  }
  const errors = [];
  items.forEach((item, index) => {
    if (!isNonEmptyString(item?.[firstKey]) || !isNonEmptyString(item?.[secondKey])) {
      errors.push(`${path}[${index}]: 표시 문구와 설명이 필요합니다.`);
    }
  });
  return errors;
}

function validateComplexSources(sources, path, confirmedAt, { required = false } = {}) {
  if (!Array.isArray(sources) || (required && sources.length === 0)) {
    return [`${path}: ${required ? "한 개 이상의 출처" : "배열"}가 필요합니다.`];
  }
  const errors = [];
  const ids = new Set();
  sources.forEach((source, index) => {
    const sourcePath = `${path}[${index}]`;
    if (!isKebabCase(source?.id)) errors.push(`${sourcePath}.id: 영문 kebab-case가 필요합니다.`);
    if (ids.has(source?.id)) errors.push(`${sourcePath}.id: 중복 출처 ID입니다.`);
    ids.add(source?.id);
    for (const key of ["publisher", "label"]) {
      if (!isNonEmptyString(source?.[key])) errors.push(`${sourcePath}.${key}: 출처 표시 정보가 필요합니다.`);
    }
    if (!allowedComplexSourceKinds.has(source?.kind)) errors.push(`${sourcePath}.kind: 허용되지 않은 출처 종류입니다.`);
    if (!isIsoDateOrNull(source?.checkedAt) || source.checkedAt === null) {
      errors.push(`${sourcePath}.checkedAt: YYYY-MM-DD 확인일이 필요합니다.`);
    } else if (isNonEmptyString(confirmedAt) && source.checkedAt > confirmedAt) {
      errors.push(`${sourcePath}.checkedAt: 페이지 확인일보다 늦을 수 없습니다.`);
    }
    if (source?.note !== undefined && !isNonEmptyString(source.note)) errors.push(`${sourcePath}.note: 비어 있지 않은 문자열이어야 합니다.`);
    try {
      const sourceUrl = new URL(source?.url);
      if (sourceUrl.protocol !== "https:") errors.push(`${sourcePath}.url: HTTPS 출처가 필요합니다.`);
    } catch {
      errors.push(`${sourcePath}.url: 올바른 출처 URL이 필요합니다.`);
    }
  });
  return errors;
}

function validateRelatedContentIds(ids, path, externalLinks) {
  if (!Array.isArray(ids)) return [`${path}: 배열이어야 합니다.`];
  const errors = [];
  const seen = new Set();
  const externalById = Array.isArray(externalLinks) ? new Map(externalLinks.map((item) => [item.id, item])) : null;
  ids.forEach((id, index) => {
    if (!isKebabCase(id)) errors.push(`${path}[${index}]: 영문 kebab-case ID가 필요합니다.`);
    if (seen.has(id)) errors.push(`${path}[${index}]: 중복 콘텐츠 ID입니다.`);
    seen.add(id);
    if (externalById) {
      const content = externalById.get(id);
      if (!content) errors.push(`${path}[${index}]: external-links.json에 없는 ID입니다.`);
      else if (content.status !== "published") errors.push(`${path}[${index}]: 공개 상태 콘텐츠만 연결할 수 있습니다.`);
      else if (!isIsoDateOrNull(content.publishedAt) || content.publishedAt === null) errors.push(`${path}[${index}]: 연결 콘텐츠 게시일이 필요합니다.`);
    }
  });
  return errors;
}

export function validateOffice(office) {
  const errors = [];
  for (const key of ["legalName", "brandName", "serviceArea", "representative", "mobile", "email", "address", "registrationNumber", "businessNumber", "parking"]) {
    if (!isNonEmptyString(office?.[key])) errors.push(`office.${key}: 확정 공개 정보가 필요합니다.`);
  }

  if (office?.serviceArea !== "대전광역시 동구") {
    errors.push("office.serviceArea: 현재 공개 서비스 범위는 대전광역시 동구여야 합니다.");
  }

  if (!/^\d{3}-\d{2}-\d{5}$/.test(office?.businessNumber ?? "")) {
    errors.push("office.businessNumber: 000-00-00000 형식이 필요합니다.");
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(office?.email ?? "")) {
    errors.push("office.email: 올바른 이메일 주소가 필요합니다.");
  }

  for (const key of ["naverPlaceUrl", "naverListingsUrl", "naverBlogUrl", "youtubeUrl", "kakaoUrl"]) {
    try {
      const url = new URL(office?.[key]);
      if (url.protocol !== "https:") errors.push(`office.${key}: HTTPS만 허용합니다.`);
    } catch {
      errors.push(`office.${key}: 올바른 공개 URL이 필요합니다.`);
    }
  }

  if (!Array.isArray(office?.hours) || office.hours.length === 0) {
    errors.push("office.hours: 공개 영업시간이 필요합니다.");
  } else {
    office.hours.forEach((hour, index) => {
      const path = `office.hours[${index}]`;
      if (!isNonEmptyString(hour.label)) errors.push(`${path}.label: 표시 이름이 필요합니다.`);
      if (!Array.isArray(hour.days) || hour.days.length === 0 || hour.days.some((day) => !allowedWeekDays.has(day))) {
        errors.push(`${path}.days: 올바른 요일이 필요합니다.`);
      }
      const hasOpenHours = /^\d{2}:\d{2}$/.test(hour.opens ?? "") && /^\d{2}:\d{2}$/.test(hour.closes ?? "");
      if (!hasOpenHours && !isNonEmptyString(hour.note)) {
        errors.push(`${path}: 영업 시작·종료 시간 또는 휴무 안내가 필요합니다.`);
      }
    });
  }

  if (!Array.isArray(office?.introduction) || office.introduction.length === 0 || office.introduction.some((paragraph) => !isNonEmptyString(paragraph))) {
    errors.push("office.introduction: 승인된 대표 소개 문안이 필요합니다.");
  }

  if (!isNonEmptyString(office?.publicClaims?.basis) || !Array.isArray(office?.publicClaims?.items) || office.publicClaims.items.length === 0) {
    errors.push("office.publicClaims: 공개 승인된 운영 현황 문구가 필요합니다.");
  } else {
    office.publicClaims.items.forEach((claim, index) => {
      if (!isNonEmptyString(claim.label) || !isNonEmptyString(claim.value)) {
        errors.push(`office.publicClaims.items[${index}]: 표시 문구와 값이 필요합니다.`);
      }
    });
  }

  return errors;
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
  if (listing.district !== "대전 동구") errors.push(`${path}.district: 대전 동구 매물만 공개합니다.`);
  if (!isKebabCase(listing.neighborhoodSlug)) errors.push(`${path}.neighborhoodSlug: 영문 kebab-case가 필요합니다.`);
  if (!isNonEmptyString(listing.neighborhoodName)) errors.push(`${path}.neighborhoodName: 공개할 동네 이름이 필요합니다.`);
  if (listing.complexName !== null && !isNonEmptyString(listing.complexName)) errors.push(`${path}.complexName: 단지명은 문자열 또는 null이어야 합니다.`);

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

  errors.push(...validateImage(listing.thumbnail, `${path}.thumbnail`));
  if (listing.images !== undefined) {
    if (!Array.isArray(listing.images)) errors.push(`${path}.images: 배열이어야 합니다.`);
    else listing.images.forEach((image, imageIndex) => errors.push(...validateImage(image, `${path}.images[${imageIndex}]`)));
  }

  return errors;
}

export function validateListings(listings) {
  if (!Array.isArray(listings)) return ["listings: 배열이어야 합니다."];
  const errors = [];
  const ids = new Set();
  const slugs = new Set();
  listings.forEach((listing, index) => {
    errors.push(...validateListing(listing, index));
    if (ids.has(listing.id)) errors.push(`listings[${index}].id: 중복 ID입니다.`);
    if (slugs.has(listing.slug)) errors.push(`listings[${index}].slug: 중복 slug입니다.`);
    ids.add(listing.id);
    slugs.add(listing.slug);
  });
  return errors;
}

export function validateNaverListings(data) {
  const errors = [];
  if (!isIsoDateOrNull(data?.checkedAt) || data.checkedAt === null) {
    errors.push("naverListings.checkedAt: YYYY-MM-DD 확인일이 필요합니다.");
  }
  if (!Array.isArray(data?.items) || data.items.length === 0) {
    return [...errors, "naverListings.items: 네이버 공개 매물이 하나 이상 필요합니다."];
  }

  const ids = new Set();
  data.items.forEach((listing, index) => {
    const path = `naverListings.items[${index}]`;
    const unexpectedKeys = getUnexpectedNaverListingKeys(listing);
    if (unexpectedKeys.length > 0) errors.push(`${path}: 허용되지 않은 필드가 있습니다.`);
    if (!/^\d+$/.test(listing.id ?? "")) errors.push(`${path}.id: 네이버 숫자 매물번호가 필요합니다.`);
    if (ids.has(listing.id)) errors.push(`${path}.id: 중복 ID입니다.`);
    ids.add(listing.id);
    for (const key of ["title", "propertyType", "priceLabel", "summary", "source"]) {
      if (!isNonEmptyString(listing[key])) errors.push(`${path}.${key}: 네이버 공개 정보가 필요합니다.`);
    }
    if (!allowedTradeTypes.has(listing.tradeType)) errors.push(`${path}.tradeType: 허용되지 않은 거래유형입니다.`);
    for (const key of ["areaLabel", "floorLabel", "direction"]) {
      if (listing[key] !== null && !isNonEmptyString(listing[key])) errors.push(`${path}.${key}: 문자열 또는 null이어야 합니다.`);
    }
    if (!isIsoDateOrNull(listing.confirmedAt) || listing.confirmedAt === null) {
      errors.push(`${path}.confirmedAt: YYYY-MM-DD 확인일이 필요합니다.`);
    } else if (isNonEmptyString(data.checkedAt) && listing.confirmedAt > data.checkedAt) {
      errors.push(`${path}.confirmedAt: 데이터 확인일보다 늦을 수 없습니다.`);
    }
    if (listing.source !== "네이버페이 부동산") errors.push(`${path}.source: 네이버페이 부동산이어야 합니다.`);
    try {
      const url = new URL(listing.url);
      if (url.protocol !== "https:" || url.hostname !== "fin.land.naver.com" || url.pathname !== `/articles/${listing.id}`) {
        errors.push(`${path}.url: 해당 네이버 매물번호의 HTTPS 주소가 필요합니다.`);
      }
    } catch {
      errors.push(`${path}.url: 올바른 네이버 매물 주소가 필요합니다.`);
    }
    errors.push(...getNaverListingPublicTextErrors(listing, path));
  });
  return errors;
}

export function validateComplexes(complexes, externalLinks) {
  const errors = [];
  if (!Array.isArray(complexes) || complexes.length === 0) {
    return ["complexes: 공개할 주요 단지 항목이 하나 이상 필요합니다."];
  }

  const slugs = new Set();
  complexes.forEach((complex, index) => {
    const path = `complexes[${index}]`;
    if (!isKebabCase(complex.slug)) errors.push(`${path}.slug: 영문 kebab-case가 필요합니다.`);
    if (!isKebabCase(complex.areaSlug)) errors.push(`${path}.areaSlug: 영문 kebab-case가 필요합니다.`);
    for (const key of ["areaName", "eyebrow", "mark", "name", "summary"]) {
      if (!isNonEmptyString(complex[key])) errors.push(`${path}.${key}: 공개 정보가 필요합니다.`);
    }
    if (!allowedComplexStatuses.has(complex.status)) errors.push(`${path}.status: 허용되지 않은 상태입니다.`);
    if (!isNonEmptyString(complex.introTitle)) errors.push(`${path}.introTitle: 단지 소개 제목이 필요합니다.`);
    if (!Array.isArray(complex.introduction) || complex.introduction.length === 0 || complex.introduction.some((paragraph) => !isNonEmptyString(paragraph))) {
      errors.push(`${path}.introduction: 한 개 이상의 단지 소개 문단이 필요합니다.`);
    }
    errors.push(...validateImage(complex.image, `${path}.image`, { required: complex.status === "published" }));
    const required = complex.status === "published";
    errors.push(...validateTextPairs(complex.facts, `${path}.facts`, "label", "value", { required }));
    errors.push(...validateTextPairs(complex.highlights, `${path}.highlights`, "title", "description", { required }));
    errors.push(...validateTextPairs(complex.supplySummary, `${path}.supplySummary`, "label", "value", { required }));
    errors.push(...validateTextPairs(complex.checkpoints, `${path}.checkpoints`, "title", "description", { required }));
    errors.push(...validateTextPairs(complex.faqs, `${path}.faqs`, "question", "answer", { required }));
    if (!Array.isArray(complex.unitGroups) || (required && complex.unitGroups.length === 0)) {
      errors.push(`${path}.unitGroups: 공개 단지에는 한 개 이상의 면적별 세대 구성이 필요합니다.`);
    } else if (Array.isArray(complex.unitGroups)) {
      complex.unitGroups.forEach((unit, unitIndex) => {
        const unitPath = `${path}.unitGroups[${unitIndex}]`;
        if (!isNonEmptyString(unit?.category) || !isNonEmptyString(unit?.areaLabel)) errors.push(`${unitPath}: 공급 구분과 전용면적 표시가 필요합니다.`);
        if (!isPositiveSafeInteger(unit?.households)) errors.push(`${unitPath}.households: 양의 정수 세대수가 필요합니다.`);
        if (unit?.note !== undefined && !isNonEmptyString(unit.note)) errors.push(`${unitPath}.note: 비어 있지 않은 문자열이어야 합니다.`);
      });
    }
    if (!Array.isArray(complex.livingSections) || (required && complex.livingSections.length === 0)) {
      errors.push(`${path}.livingSections: 공개 단지에는 생활환경 안내가 필요합니다.`);
    } else if (Array.isArray(complex.livingSections)) {
      complex.livingSections.forEach((section, sectionIndex) => {
        const sectionPath = `${path}.livingSections[${sectionIndex}]`;
        if (!allowedComplexLivingCategories.has(section?.category)) errors.push(`${sectionPath}.category: 허용되지 않은 생활환경 종류입니다.`);
        if (!isNonEmptyString(section?.title) || !isNonEmptyString(section?.description)) errors.push(`${sectionPath}: 제목과 설명이 필요합니다.`);
      });
    }
    if (!Array.isArray(complex.amenityGroups) || (required && complex.amenityGroups.length === 0)) {
      errors.push(`${path}.amenityGroups: 공개 단지에는 시설 정보와 확인 상태가 필요합니다.`);
    } else if (Array.isArray(complex.amenityGroups)) {
      complex.amenityGroups.forEach((group, groupIndex) => {
        const groupPath = `${path}.amenityGroups[${groupIndex}]`;
        if (!isNonEmptyString(group?.title)) errors.push(`${groupPath}.title: 시설 묶음 제목이 필요합니다.`);
        if (!allowedComplexAmenityVerifications.has(group?.verification)) errors.push(`${groupPath}.verification: 허용되지 않은 확인 상태입니다.`);
        if (!Array.isArray(group?.items) || group.items.length === 0 || group.items.some((item) => !isNonEmptyString(item))) {
          errors.push(`${groupPath}.items: 한 개 이상의 시설명이 필요합니다.`);
        }
        if (group?.note !== undefined && !isNonEmptyString(group.note)) errors.push(`${groupPath}.note: 비어 있지 않은 문자열이어야 합니다.`);
      });
    }
    errors.push(...validateRelatedContentIds(complex.relatedContentIds, `${path}.relatedContentIds`, externalLinks));
    errors.push(...validateComplexSources(complex.sources, `${path}.sources`, complex.confirmedAt, { required }));
    if (complex.status === "published") {
      if (!isIsoDateOrNull(complex.confirmedAt) || complex.confirmedAt === null) errors.push(`${path}.confirmedAt: 공개 단지는 확인일이 필요합니다.`);
    }
    if (slugs.has(complex.slug)) errors.push(`${path}.slug: 중복 slug입니다.`);
    slugs.add(complex.slug);
  });

  const leadersCity4 = complexes.find((complex) => complex.slug === "leaders-city-4");
  const leadersCity5 = complexes.find((complex) => complex.slug === "leaders-city-5");
  if (leadersCity4?.status === "published" && Array.isArray(leadersCity4.unitGroups)) {
    const total = leadersCity4.unitGroups.reduce((sum, unit) => sum + (Number.isSafeInteger(unit.households) ? unit.households : 0), 0);
    if (total !== 1328) errors.push("complexes.leaders-city-4.unitGroups: 세대수 합계는 1,328이어야 합니다.");
  }
  if (leadersCity5?.status === "published" && Array.isArray(leadersCity5.unitGroups)) {
    const rentalTotal = leadersCity5.unitGroups.filter((unit) => unit.category === "10년 공공임대").reduce((sum, unit) => sum + (Number.isSafeInteger(unit.households) ? unit.households : 0), 0);
    const saleTotal = leadersCity5.unitGroups.filter((unit) => unit.category === "분양").reduce((sum, unit) => sum + (Number.isSafeInteger(unit.households) ? unit.households : 0), 0);
    if (rentalTotal !== 712) errors.push("complexes.leaders-city-5.unitGroups: 10년 공공임대 세대수 합계는 712이어야 합니다.");
    if (saleTotal !== 1423) errors.push("complexes.leaders-city-5.unitGroups: 분양 세대수 합계는 1,423이어야 합니다.");
    if (rentalTotal + saleTotal !== 2135) errors.push("complexes.leaders-city-5.unitGroups: 전체 세대수 합계는 2,135여야 합니다.");
  }
  return errors;
}

export function validateComplexOverview(overview, complexes, externalLinks) {
  const errors = [];
  for (const key of ["eyebrow", "title", "description", "note"]) {
    if (!isNonEmptyString(overview?.[key])) errors.push(`complexOverview.${key}: 공개 문구가 필요합니다.`);
  }
  if (!isIsoDateOrNull(overview?.confirmedAt) || overview.confirmedAt === null) {
    errors.push("complexOverview.confirmedAt: YYYY-MM-DD 확인일이 필요합니다.");
  }
  if (!Array.isArray(overview?.stats) || overview.stats.length === 0) {
    errors.push("complexOverview.stats: 한 개 이상의 숫자 카드가 필요합니다.");
  } else {
    overview.stats.forEach((stat, index) => {
      if (!isNonEmptyString(stat?.label) || !isNonEmptyString(stat?.value) || !isNonEmptyString(stat?.description)) {
        errors.push(`complexOverview.stats[${index}]: 제목, 값과 설명이 필요합니다.`);
      }
    });
  }
  errors.push(...validateTextPairs(overview?.reasons, "complexOverview.reasons", "title", "description", { required: true }));
  errors.push(...validateTextPairs(overview?.sharedCheckpoints, "complexOverview.sharedCheckpoints", "title", "description", { required: true }));
  if (!Array.isArray(overview?.comparisonRows) || overview.comparisonRows.length === 0) {
    errors.push("complexOverview.comparisonRows: 한 개 이상의 비교 항목이 필요합니다.");
  } else {
    overview.comparisonRows.forEach((row, index) => {
      if (!isNonEmptyString(row?.label) || !row?.values || typeof row.values !== "object") {
        errors.push(`complexOverview.comparisonRows[${index}]: 비교 항목과 블록별 값이 필요합니다.`);
        return;
      }
      for (const complex of Array.isArray(complexes) ? complexes.filter((item) => item.status === "published") : []) {
        if (!isNonEmptyString(row.values[complex.slug])) errors.push(`complexOverview.comparisonRows[${index}].values.${complex.slug}: 비교값이 필요합니다.`);
      }
    });
  }
  errors.push(...validateRelatedContentIds(overview?.relatedContentIds, "complexOverview.relatedContentIds", externalLinks));
  errors.push(...validateComplexSources(overview?.sources, "complexOverview.sources", overview?.confirmedAt, { required: true }));

  if (Array.isArray(complexes)) {
    const leadersCity4 = complexes.find((complex) => complex.slug === "leaders-city-4");
    const leadersCity5 = complexes.find((complex) => complex.slug === "leaders-city-5");
    const combinedTotal = [leadersCity4, leadersCity5].reduce((sum, complex) => sum + (complex?.unitGroups?.reduce((subtotal, unit) => subtotal + (Number.isSafeInteger(unit.households) ? unit.households : 0), 0) ?? 0), 0);
    if (combinedTotal !== 3463) errors.push("complexOverview: 4·5블록 세대수 합계는 3,463이어야 합니다.");
  }
  if (!overview?.stats?.some((stat) => stat.label === "전체 규모" && stat.value === "3,463세대")) {
    errors.push("complexOverview.stats: 전체 규모 3,463세대 카드가 필요합니다.");
  }
  return errors;
}

export function validateExternalLinks(externalLinks) {
  const errors = [];
  if (!Array.isArray(externalLinks)) return ["externalLinks: 배열이어야 합니다."];
  const ids = new Set();
  externalLinks.forEach((link, index) => {
    const path = `externalLinks[${index}]`;
    if (!isKebabCase(link.id)) errors.push(`${path}.id: 영문 kebab-case가 필요합니다.`);
    if (ids.has(link.id)) errors.push(`${path}.id: 중복 ID입니다.`);
    ids.add(link.id);
    if (!allowedExternalContentTypes.has(link.type)) errors.push(`${path}.type: blog 또는 youtube만 허용합니다.`);
    if (link.type === "youtube" && !allowedYoutubeContentFormats.has(link.youtubeFormat)) {
      errors.push(`${path}.youtubeFormat: video 또는 short만 허용합니다.`);
    }
    if (link.type === "blog" && link.youtubeFormat !== undefined) {
      errors.push(`${path}.youtubeFormat: 블로그 콘텐츠에는 사용할 수 없습니다.`);
    }
    if (!allowedExternalContentStatuses.has(link.status)) errors.push(`${path}.status: draft 또는 published만 허용합니다.`);
    for (const key of ["title", "summary"]) {
      if (!isNonEmptyString(link[key])) errors.push(`${path}.${key}: 공개 문구가 필요합니다.`);
    }
    try {
      const url = new URL(link.url);
      if (url.protocol !== "https:") errors.push(`${path}.url: HTTPS만 허용합니다.`);
      if (link.type === "blog" && !["blog.naver.com", "m.blog.naver.com"].includes(url.hostname)) {
        errors.push(`${path}.url: 네이버 블로그 주소만 허용합니다.`);
      }
      if (link.type === "youtube" && !["youtube.com", "www.youtube.com", "youtu.be"].includes(url.hostname)) {
        errors.push(`${path}.url: 유튜브 주소만 허용합니다.`);
      }
    } catch {
      errors.push(`${path}.url: 올바른 URL이 아닙니다.`);
    }
    if (!isIsoDateOrNull(link.publishedAt)) errors.push(`${path}.publishedAt: YYYY-MM-DD 또는 null이어야 합니다.`);
    errors.push(...validateImage(link.thumbnail, `${path}.thumbnail`));
  });
  return errors;
}

export function validateHomeContent(homeContent) {
  const errors = [];
  const requiredStrings = [
    ["broker.eyebrow", homeContent?.broker?.eyebrow],
    ["broker.headline", homeContent?.broker?.headline],
    ["broker.lead", homeContent?.broker?.lead],
    ["office.eyebrow", homeContent?.office?.eyebrow],
    ["office.title", homeContent?.office?.title],
    ["office.description", homeContent?.office?.description],
    ["areaGuide.eyebrow", homeContent?.areaGuide?.eyebrow],
    ["areaGuide.title", homeContent?.areaGuide?.title],
    ["areaGuide.description", homeContent?.areaGuide?.description],
  ];
  requiredStrings.forEach(([path, value]) => {
    if (!isNonEmptyString(value)) errors.push(`homeContent.${path}: 공개 문구가 필요합니다.`);
  });
  errors.push(...validateImage(homeContent?.broker?.portrait, "homeContent.broker.portrait", { required: true }));
  errors.push(...validateImage(homeContent?.office?.image, "homeContent.office.image", { required: true }));
  if (!Array.isArray(homeContent?.office?.badges) || homeContent.office.badges.length === 0 || homeContent.office.badges.some((badge) => !isNonEmptyString(badge))) {
    errors.push("homeContent.office.badges: 한 개 이상의 표시 문구가 필요합니다.");
  }
  if (!Array.isArray(homeContent?.areaGuide?.cards) || homeContent.areaGuide.cards.length === 0) {
    errors.push("homeContent.areaGuide.cards: 한 개 이상의 지역 안내 카드가 필요합니다.");
  } else {
    homeContent.areaGuide.cards.forEach((card, index) => {
      if (!isNonEmptyString(card.title) || !isNonEmptyString(card.description)) {
        errors.push(`homeContent.areaGuide.cards[${index}]: 제목과 설명이 필요합니다.`);
      }
    });
  }
  return errors;
}

export function validateContent({ office, listings, naverListings, complexes, complexOverview, externalLinks, homeContent, faq, reviews }) {
  const errors = validateOffice(office);
  errors.push(...validateListings(listings));
  errors.push(...validateNaverListings(naverListings));
  errors.push(...validateComplexes(complexes, externalLinks));
  errors.push(...validateComplexOverview(complexOverview, complexes, externalLinks));
  errors.push(...validateExternalLinks(externalLinks));
  errors.push(...validateHomeContent(homeContent));
  if (!Array.isArray(faq) || !Array.isArray(reviews)) errors.push("FAQ·후기는 배열이어야 합니다.");

  errors.push(...findBannedKeys({ office, listings, naverListings, complexes, complexOverview, externalLinks, homeContent, faq, reviews }));
  return errors;
}
