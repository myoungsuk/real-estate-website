import {
  getNaverListingPublicTextErrors,
  getUnexpectedNaverListingKeys,
} from "../src/lib/naver-listing-public-validation.mjs";
import { normalizeComplexText } from "../src/lib/complex-matching.mjs";

const allowedStatuses = new Set(["draft", "published", "contracted", "ended"]);
const allowedTradeTypes = new Set(["sale", "jeonse", "monthly-rent"]);
const allowedComplexStatuses = new Set(["preparing", "published"]);
const allowedComplexSourceKinds = new Set(["official", "public-data", "operator", "news"]);
const allowedComplexAmenityVerifications = new Set(["official", "operator-confirmed", "historical-plan", "check-required"]);
const allowedComplexLivingCategories = new Set(["transport", "education", "daily-life", "nature"]);
const complexSeoMaximumLengths = Object.freeze({ title: 70, description: 180 });
const allowedExternalContentTypes = new Set(["blog", "youtube"]);
const allowedYoutubeContentFormats = new Set(["video", "short"]);
const allowedExternalContentStatuses = new Set(["draft", "published"]);
const allowedFaqCategories = new Set([
  "매물 확인과 상담",
  "리더스시티 4블록·5블록",
  "가격과 시세",
  "매매계약과 권리관계",
  "전세·월세와 보증금 보호",
  "중개보수·대출·세금과 관리비",
  "하자·잔금과 입주",
  "정보의 범위와 책임",
]);
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

const valueSchema = Object.freeze({ kind: "value" });
const objectSchema = (properties) => Object.freeze({ kind: "object", properties: Object.freeze(properties) });
const arraySchema = (item) => Object.freeze({ kind: "array", item });
const recordSchema = (value) => Object.freeze({ kind: "record", value });

const imageSchema = objectSchema({ src: valueSchema, alt: valueSchema });
const sourceSchema = objectSchema({
  id: valueSchema,
  publisher: valueSchema,
  label: valueSchema,
  url: valueSchema,
  kind: valueSchema,
  checkedAt: valueSchema,
  note: valueSchema,
});
const textPairSchema = objectSchema({ title: valueSchema, description: valueSchema });

const publicContentSchemas = Object.freeze({
  office: objectSchema({
    legalName: valueSchema,
    brandName: valueSchema,
    serviceArea: valueSchema,
    representative: valueSchema,
    mobile: valueSchema,
    email: valueSchema,
    address: valueSchema,
    registrationNumber: valueSchema,
    businessNumber: valueSchema,
    parking: valueSchema,
    hours: arraySchema(objectSchema({
      label: valueSchema,
      days: arraySchema(valueSchema),
      opens: valueSchema,
      closes: valueSchema,
      note: valueSchema,
    })),
    introduction: arraySchema(valueSchema),
    publicClaims: objectSchema({
      basis: valueSchema,
      items: arraySchema(objectSchema({ label: valueSchema, value: valueSchema })),
    }),
    naverPlaceUrl: valueSchema,
    naverListingsUrl: valueSchema,
    naverBlogUrl: valueSchema,
    youtubeUrl: valueSchema,
    kakaoUrl: valueSchema,
  }),
  listings: arraySchema(objectSchema({
    id: valueSchema,
    slug: valueSchema,
    title: valueSchema,
    status: valueSchema,
    propertyType: valueSchema,
    tradeType: valueSchema,
    district: valueSchema,
    neighborhoodSlug: valueSchema,
    neighborhoodName: valueSchema,
    complexName: valueSchema,
    salePriceKrw: valueSchema,
    depositKrw: valueSchema,
    monthlyRentKrw: valueSchema,
    exclusiveAreaM2: valueSchema,
    floorLabel: valueSchema,
    direction: valueSchema,
    moveIn: valueSchema,
    summary: valueSchema,
    features: arraySchema(valueSchema),
    thumbnail: imageSchema,
    images: arraySchema(imageSchema),
    source: valueSchema,
    confirmedAt: valueSchema,
    publishedAt: valueSchema,
  })),
  naverListings: objectSchema({
    checkedAt: valueSchema,
    items: arraySchema(objectSchema({
      id: valueSchema,
      title: valueSchema,
      propertyType: valueSchema,
      tradeType: valueSchema,
      priceLabel: valueSchema,
      areaLabel: valueSchema,
      floorLabel: valueSchema,
      direction: valueSchema,
      summary: valueSchema,
      registeredAt: valueSchema,
      source: valueSchema,
      url: valueSchema,
    })),
  }),
  complexes: arraySchema(objectSchema({
    slug: valueSchema,
    areaSlug: valueSchema,
    areaName: valueSchema,
    eyebrow: valueSchema,
    mark: valueSchema,
    name: valueSchema,
    aliases: arraySchema(valueSchema),
    seo: objectSchema({ title: valueSchema, description: valueSchema }),
    unitDataNote: valueSchema,
    status: valueSchema,
    summary: valueSchema,
    introTitle: valueSchema,
    introduction: arraySchema(valueSchema),
    image: imageSchema,
    facts: arraySchema(objectSchema({ label: valueSchema, value: valueSchema })),
    highlights: arraySchema(textPairSchema),
    unitGroups: arraySchema(objectSchema({
      category: valueSchema,
      areaLabel: valueSchema,
      households: valueSchema,
      note: valueSchema,
    })),
    supplySummary: arraySchema(objectSchema({ label: valueSchema, value: valueSchema, description: valueSchema })),
    livingSections: arraySchema(objectSchema({ category: valueSchema, title: valueSchema, description: valueSchema })),
    amenityGroups: arraySchema(objectSchema({
      title: valueSchema,
      items: arraySchema(valueSchema),
      verification: valueSchema,
      note: valueSchema,
    })),
    checkpoints: arraySchema(textPairSchema),
    faqs: arraySchema(objectSchema({ question: valueSchema, answer: valueSchema })),
    relatedContentIds: arraySchema(valueSchema),
    sources: arraySchema(sourceSchema),
    confirmedAt: valueSchema,
  })),
  complexOverview: objectSchema({
    eyebrow: valueSchema,
    title: valueSchema,
    description: valueSchema,
    note: valueSchema,
    confirmedAt: valueSchema,
    featuredComplexSlugs: arraySchema(valueSchema),
    comparisonComplexSlugs: arraySchema(valueSchema),
    stats: arraySchema(objectSchema({ label: valueSchema, value: valueSchema, description: valueSchema })),
    reasons: arraySchema(textPairSchema),
    comparisonRows: arraySchema(objectSchema({ label: valueSchema, values: recordSchema(valueSchema) })),
    sharedCheckpoints: arraySchema(textPairSchema),
    relatedContentIds: arraySchema(valueSchema),
    sources: arraySchema(sourceSchema),
  }),
  externalLinks: arraySchema(objectSchema({
    id: valueSchema,
    type: valueSchema,
    youtubeFormat: valueSchema,
    status: valueSchema,
    title: valueSchema,
    summary: valueSchema,
    url: valueSchema,
    publishedAt: valueSchema,
    thumbnail: imageSchema,
  })),
  homeContent: objectSchema({
    broker: objectSchema({ eyebrow: valueSchema, headline: valueSchema, lead: valueSchema, portrait: imageSchema }),
    office: objectSchema({
      eyebrow: valueSchema,
      title: valueSchema,
      description: valueSchema,
      image: imageSchema,
      badges: arraySchema(valueSchema),
    }),
    areaGuide: objectSchema({
      eyebrow: valueSchema,
      title: valueSchema,
      description: valueSchema,
      cards: arraySchema(textPairSchema),
    }),
  }),
  faq: arraySchema(objectSchema({ category: valueSchema, question: valueSchema, answer: valueSchema })),
  reviews: arraySchema(objectSchema({
    id: valueSchema,
    displayName: valueSchema,
    content: valueSchema,
    confirmedAt: valueSchema,
    source: valueSchema,
    isPublished: valueSchema,
    privacyReviewed: valueSchema,
    privacyReviewedAt: valueSchema,
    archivedAt: valueSchema,
    updatedAt: valueSchema,
  })),
});

const KOREA_TIME_OFFSET_MS = 9 * 60 * 60 * 1000;

function getTodayInKorea(now = Date.now()) {
  return new Date(now + KOREA_TIME_OFFSET_MS).toISOString().slice(0, 10);
}

function isValidCalendarDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value ?? "");
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function isPositiveSafeInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function isKebabCase(value) {
  return typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isIsoDateOrNull(value, now = Date.now()) {
  return value === null
    || (typeof value === "string" && isValidCalendarDate(value) && value <= getTodayInKorea(now));
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

function findUnexpectedKeysWithSchema(value, schema, path, errors) {
  if (value === null || value === undefined || schema.kind === "value") return errors;
  if (schema.kind === "array") {
    if (Array.isArray(value)) {
      value.forEach((item, index) => findUnexpectedKeysWithSchema(item, schema.item, `${path}[${index}]`, errors));
    }
    return errors;
  }
  if (schema.kind === "record") {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      Object.entries(value).forEach(([key, child]) => findUnexpectedKeysWithSchema(child, schema.value, `${path}.${key}`, errors));
    }
    return errors;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return errors;
  for (const [key, child] of Object.entries(value)) {
    const childSchema = schema.properties[key];
    if (!childSchema) {
      errors.push(`${path}.${key}: 허용되지 않은 필드입니다.`);
      continue;
    }
    findUnexpectedKeysWithSchema(child, childSchema, `${path}.${key}`, errors);
  }
  return errors;
}

export function findUnexpectedKeys(resource, value, path = resource, errors = []) {
  const schema = publicContentSchemas[resource];
  if (!schema) return [`${path}: 허용되지 않은 콘텐츠 종류입니다.`];
  return findUnexpectedKeysWithSchema(value, schema, path, errors);
}

function normalizeDigits(value) {
  return value.replace(/\D/gu, "");
}

function getApprovedSensitiveValues(office) {
  const mobileNumbers = new Set();
  const emails = new Set();
  const unitLabels = new Set();
  if (typeof office?.mobile === "string") mobileNumbers.add(normalizeDigits(office.mobile));
  if (typeof office?.email === "string") emails.add(office.email.trim().toLowerCase());
  if (typeof office?.address === "string") {
    for (const match of office.address.matchAll(/(?<!\d)\d{1,4}\s*호(?!선|점|기|차)/gu)) {
      unitLabels.add(match[0].replace(/\s/gu, ""));
    }
  }
  return { mobileNumbers, emails, unitLabels };
}

function findSensitiveStringsRecursive(value, path, errors, approved) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => findSensitiveStringsRecursive(item, `${path}[${index}]`, errors, approved));
    return errors;
  }
  if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, child]) => findSensitiveStringsRecursive(child, `${path}.${key}`, errors, approved));
    return errors;
  }
  if (typeof value !== "string") return errors;

  for (const match of value.matchAll(/(?<!\d)01[016789](?:[- .]?\d){7,8}(?!\d)/gu)) {
    if (!approved.mobileNumbers.has(normalizeDigits(match[0]))) {
      errors.push(`${path}: 공개 승인되지 않은 휴대전화번호 패턴이 있습니다.`);
      break;
    }
  }
  for (const match of value.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu)) {
    if (!approved.emails.has(match[0].toLowerCase())) {
      errors.push(`${path}: 공개 승인되지 않은 이메일 주소 패턴이 있습니다.`);
      break;
    }
  }
  for (const match of value.matchAll(/(?<!\d)\d{1,4}\s*호(?!선|점|기|차)/gu)) {
    if (!approved.unitLabels.has(match[0].replace(/\s/gu, ""))) {
      errors.push(`${path}: 공개 승인되지 않은 정확한 호수 패턴이 있습니다.`);
      break;
    }
  }
  if (/(?<!\d)\d{6}-?[1-4]\d{6}(?!\d)/u.test(value)) {
    errors.push(`${path}: 주민등록번호 형태의 민감정보가 있습니다.`);
  }
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u.test(value)) {
    errors.push(`${path}: 비공개 키 형태의 문자열이 있습니다.`);
  }
  if (/\b(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,})\b/u.test(value)) {
    errors.push(`${path}: GitHub 토큰 형태의 문자열이 있습니다.`);
  }
  if (/\b(?:AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|glpat-[0-9A-Za-z_-]{20,}|xox[baprs]-[0-9A-Za-z-]{10,})\b/u.test(value)) {
    errors.push(`${path}: 인증 토큰 형태의 문자열이 있습니다.`);
  }
  if (/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/iu.test(value)) {
    errors.push(`${path}: Bearer 인증정보 형태의 문자열이 있습니다.`);
  }
  if (/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/u.test(value)) {
    errors.push(`${path}: JWT 형태의 문자열이 있습니다.`);
  }
  if (/(?:api[_ -]?key|access[_ -]?token|secret|password|passwd)\s*[:=]\s*[^\s,;]{8,}/iu.test(value)) {
    errors.push(`${path}: 인증정보로 의심되는 문자열이 있습니다.`);
  }
  return errors;
}

export function findSensitiveStrings(value, { path = "root", office = null } = {}) {
  return findSensitiveStringsRecursive(value, path, [], getApprovedSensitiveValues(office));
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
    for (const key of ["title", "summary", "source"]) {
      if (typeof listing[key] !== "string" || listing[key].trim() === "") errors.push(`${path}.${key}: 공개 매물 필수값입니다.`);
    }
    if (!isIsoDateOrNull(listing.confirmedAt) || listing.confirmedAt === null) {
      errors.push(`${path}.confirmedAt: 오늘 이하의 실제 YYYY-MM-DD 확인일이 필요합니다.`);
    }
    if (!isIsoDateOrNull(listing.publishedAt)) {
      errors.push(`${path}.publishedAt: 오늘 이하의 실제 YYYY-MM-DD 또는 null이어야 합니다.`);
    }
    if (!(typeof listing.exclusiveAreaM2 === "number" && listing.exclusiveAreaM2 > 0)) errors.push(`${path}.exclusiveAreaM2: 양수여야 합니다.`);
    if (!Array.isArray(listing.features)) errors.push(`${path}.features: 배열이어야 합니다.`);
  } else {
    if (!isIsoDateOrNull(listing.confirmedAt)) errors.push(`${path}.confirmedAt: 오늘 이하의 실제 YYYY-MM-DD 또는 null이어야 합니다.`);
    if (!isIsoDateOrNull(listing.publishedAt)) errors.push(`${path}.publishedAt: 오늘 이하의 실제 YYYY-MM-DD 또는 null이어야 합니다.`);
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
    errors.push("naverListings.checkedAt: YYYY-MM-DD 매물 목록 업데이트일이 필요합니다.");
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
    if (!isIsoDateOrNull(listing.registeredAt) || listing.registeredAt === null) {
      errors.push(`${path}.registeredAt: YYYY-MM-DD 등록일이 필요합니다.`);
    } else if (isNonEmptyString(data.checkedAt) && listing.registeredAt > data.checkedAt) {
      errors.push(`${path}.registeredAt: 매물 목록 업데이트일보다 늦을 수 없습니다.`);
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
  const candidateOwners = new Map();
  complexes.forEach((complex, index) => {
    const path = `complexes[${index}]`;
    if (!isKebabCase(complex.slug)) errors.push(`${path}.slug: 영문 kebab-case가 필요합니다.`);
    if (!isKebabCase(complex.areaSlug)) errors.push(`${path}.areaSlug: 영문 kebab-case가 필요합니다.`);
    for (const key of ["areaName", "eyebrow", "mark", "name", "summary"]) {
      if (!isNonEmptyString(complex[key])) errors.push(`${path}.${key}: 공개 정보가 필요합니다.`);
    }
    const canonicalCandidate = normalizeComplexText(complex.name);
    const candidates = new Set();
    if (!canonicalCandidate) errors.push(`${path}.name: 매칭 가능한 한글·영문·숫자가 필요합니다.`);
    if (!Array.isArray(complex.aliases)) {
      errors.push(`${path}.aliases: 배열이어야 합니다.`);
    } else {
      complex.aliases.forEach((alias, aliasIndex) => {
        const aliasPath = `${path}.aliases[${aliasIndex}]`;
        if (!isNonEmptyString(alias)) {
          errors.push(`${aliasPath}: 비어 있지 않은 문자열이어야 합니다.`);
          return;
        }
        const candidate = normalizeComplexText(alias);
        if (!candidate) {
          errors.push(`${aliasPath}: 매칭 가능한 한글·영문·숫자가 필요합니다.`);
          return;
        }
        if (candidate.length < 2) {
          errors.push(`${aliasPath}: 오탐 방지를 위해 정규화 기준 두 글자 이상이어야 합니다.`);
          return;
        }
        if (candidate === canonicalCandidate) errors.push(`${aliasPath}: 표시명과 정규화 결과가 중복됩니다.`);
        if (candidates.has(candidate)) errors.push(`${aliasPath}: 같은 단지 안에서 정규화 결과가 중복됩니다.`);
        candidates.add(candidate);
      });
    }
    if (canonicalCandidate) candidates.add(canonicalCandidate);
    for (const candidate of candidates) {
      const owner = candidateOwners.get(candidate);
      if (owner && owner !== complex.slug) errors.push(`${path}.aliases: ${owner} 단지와 정규화 매칭 이름이 충돌합니다.`);
      else candidateOwners.set(candidate, complex.slug);
    }
    if (!complex.seo || typeof complex.seo !== "object") {
      errors.push(`${path}.seo: 제목과 설명 객체가 필요합니다.`);
    } else {
      for (const key of ["title", "description"]) {
        if (typeof complex.seo[key] !== "string") errors.push(`${path}.seo.${key}: 문자열이어야 합니다.`);
        else {
          if (complex.status === "published" && !isNonEmptyString(complex.seo[key])) errors.push(`${path}.seo.${key}: 공개 단지는 SEO 문구가 필요합니다.`);
          if (complex.seo[key].length > complexSeoMaximumLengths[key]) errors.push(`${path}.seo.${key}: 최대 ${complexSeoMaximumLengths[key]}자까지 입력할 수 있습니다.`);
        }
      }
    }
    if (complex.unitDataNote !== null && !isNonEmptyString(complex.unitDataNote)) {
      errors.push(`${path}.unitDataNote: null 또는 비어 있지 않은 문자열이어야 합니다.`);
    }
    if (!allowedComplexStatuses.has(complex.status)) errors.push(`${path}.status: 허용되지 않은 상태입니다.`);
    if (!isNonEmptyString(complex.introTitle)) errors.push(`${path}.introTitle: 단지 소개 제목이 필요합니다.`);
    if (!Array.isArray(complex.introduction) || complex.introduction.length === 0 || complex.introduction.some((paragraph) => !isNonEmptyString(paragraph))) {
      errors.push(`${path}.introduction: 한 개 이상의 단지 소개 문단이 필요합니다.`);
    }
    errors.push(...validateImage(complex.image, `${path}.image`, { required: complex.status === "published" }));
    const required = complex.status === "published";
    if (required && !/^\/images\/area\/[a-z0-9-]+\.webp$/u.test(complex.image?.src ?? "")) {
      errors.push(`${path}.image.src: 공개 단지 대표 사진은 검수된 /images/area/*.webp 원본과 반응형 파생본을 사용해야 합니다.`);
    }
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
  const sinheungSkView = complexes.find((complex) => complex.slug === "sinheung-sk-view");
  if (sinheungSkView?.status === "published") {
    const unitTotal = Array.isArray(sinheungSkView.unitGroups)
      ? sinheungSkView.unitGroups.reduce((sum, unit) => sum + (Number.isSafeInteger(unit.households) ? unit.households : 0), 0)
      : 0;
    const supplyTotal = Array.isArray(sinheungSkView.supplySummary)
      ? sinheungSkView.supplySummary.reduce((sum, item) => sum + Number(String(item?.value ?? "").replace(/\D/gu, "")), 0)
      : 0;
    const supplyByLabel = new Map(
      Array.isArray(sinheungSkView.supplySummary)
        ? sinheungSkView.supplySummary.map((item) => [item?.label, Number(String(item?.value ?? "").replace(/\D/gu, ""))])
        : [],
    );
    const unitsByArea = new Map(
      Array.isArray(sinheungSkView.unitGroups)
        ? sinheungSkView.unitGroups.map((unit) => [unit?.areaLabel, unit?.households])
        : [],
    );
    if (unitTotal !== 1588) errors.push("complexes.sinheung-sk-view.unitGroups: 전체 세대수 합계는 1,588이어야 합니다.");
    if (unitsByArea.get("60㎡ 이하") !== 897) errors.push("complexes.sinheung-sk-view.unitGroups: K-apt 공식 구간 60㎡ 이하 897세대가 필요합니다.");
    if (unitsByArea.get("60㎡ 초과~85㎡ 이하") !== 691) errors.push("complexes.sinheung-sk-view.unitGroups: K-apt 공식 구간 60㎡ 초과~85㎡ 이하 691세대가 필요합니다.");
    if (supplyTotal !== 1588) errors.push("complexes.sinheung-sk-view.supplySummary: 공급 구분 합계는 1,588이어야 합니다.");
    if (supplyByLabel.get("분양") !== 1499) errors.push("complexes.sinheung-sk-view.supplySummary: 분양 세대수는 공식 확인값 1,499여야 합니다.");
    if (supplyByLabel.get("임대") !== 89) errors.push("complexes.sinheung-sk-view.supplySummary: 임대 세대수는 공식 확인값 89여야 합니다.");

    const facts = new Map(Array.isArray(sinheungSkView.facts) ? sinheungSkView.facts.map((fact) => [fact?.label, fact?.value]) : []);
    if (!String(facts.get("주소") ?? "").includes("충무로 255")) errors.push("complexes.sinheung-sk-view.facts: 공식 확인 도로명주소 충무로 255가 필요합니다.");
    if (!String(facts.get("지번") ?? "").includes("신흥동 161-33")) errors.push("complexes.sinheung-sk-view.facts: 공식 확인 지번 신흥동 161-33이 필요합니다.");
    if (!String(facts.get("규모") ?? "").includes("12개동") || !String(facts.get("규모") ?? "").includes("1,588세대")) {
      errors.push("complexes.sinheung-sk-view.facts: 공식 확인 규모 12개동·1,588세대가 필요합니다.");
    }
    if (!String(facts.get("사용승인") ?? "").includes("2022년 4월 28일")) errors.push("complexes.sinheung-sk-view.facts: 공식 확인 사용승인일 2022년 4월 28일이 필요합니다.");
    if (!String(facts.get("전용면적 구간") ?? "").includes("897세대") || !String(facts.get("전용면적 구간") ?? "").includes("691세대")) {
      errors.push("complexes.sinheung-sk-view.facts: 공식 확인 전용면적 구간 897세대·691세대가 필요합니다.");
    }
    if (facts.get("난방") !== "개별난방") errors.push("complexes.sinheung-sk-view.facts: K-apt 공식 난방방식 개별난방이 필요합니다.");
    if (!String(facts.get("주차") ?? "").includes("지상 0대") || !String(facts.get("주차") ?? "").includes("지하 1,957대")) {
      errors.push("complexes.sinheung-sk-view.facts: K-apt 공식 주차대수 지상 0대·지하 1,957대가 필요합니다.");
    }
    if (facts.get("승강기") !== "34대") errors.push("complexes.sinheung-sk-view.facts: K-apt 공식 승강기 34대가 필요합니다.");

    const requiredSourceIds = ["kapt-sinheung-sk-view-basic", "kapt-sinheung-sk-view-management", "donggu-sinheung-3-status", "daejeon-2022-housing-move-in-plan"];
    const sourceIds = new Set(Array.isArray(sinheungSkView.sources) ? sinheungSkView.sources.map((source) => source?.id) : []);
    for (const sourceId of requiredSourceIds) {
      if (!sourceIds.has(sourceId)) errors.push(`complexes.sinheung-sk-view.sources: 공개 전 공식 출처 ${sourceId}가 필요합니다.`);
    }

    const permanentText = [
      sinheungSkView.summary,
      ...(Array.isArray(sinheungSkView.introduction) ? sinheungSkView.introduction : []),
      sinheungSkView.unitDataNote,
      sinheungSkView.seo?.title,
      sinheungSkView.seo?.description,
    ].filter((value) => typeof value === "string").join(" ");
    if (/(준비 중|안내할 예정|확보한 뒤 공개|확인한 뒤 공개)/u.test(permanentText)) {
      errors.push("complexes.sinheung-sk-view: 공개 문구에 준비 상태 표현이 남아 있습니다.");
    }
  }
  return errors;
}

export function validateComplexOverview(overview, complexes, externalLinks) {
  const errors = [];
  const registeredComplexes = Array.isArray(complexes)
    ? new Map(complexes.filter((complex) => isKebabCase(complex?.slug)).map((complex) => [complex.slug, complex]))
    : new Map();
  const validateSlugList = (value, key, { minimum = 1, publishedOnly = false } = {}) => {
    const path = `complexOverview.${key}`;
    if (!Array.isArray(value) || value.length < minimum) {
      errors.push(`${path}: ${minimum}개 이상의 단지 slug가 필요합니다.`);
      return [];
    }
    const seen = new Set();
    value.forEach((slug, index) => {
      const itemPath = `${path}[${index}]`;
      if (!isKebabCase(slug)) errors.push(`${itemPath}: 영문 kebab-case가 필요합니다.`);
      if (seen.has(slug)) errors.push(`${itemPath}: 중복 slug입니다.`);
      seen.add(slug);
      const complex = registeredComplexes.get(slug);
      if (!complex) errors.push(`${itemPath}: 등록되지 않은 단지 slug입니다.`);
      else if (publishedOnly && complex.status !== "published") errors.push(`${itemPath}: 공개 상태 단지만 비교할 수 있습니다.`);
    });
    return value.filter((slug) => isKebabCase(slug));
  };
  validateSlugList(overview?.featuredComplexSlugs, "featuredComplexSlugs");
  const comparisonSlugs = validateSlugList(overview?.comparisonComplexSlugs, "comparisonComplexSlugs", { minimum: 2, publishedOnly: true });
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
    const comparisonSlugSet = new Set(comparisonSlugs);
    overview.comparisonRows.forEach((row, index) => {
      if (!isNonEmptyString(row?.label) || !row?.values || typeof row.values !== "object") {
        errors.push(`complexOverview.comparisonRows[${index}]: 비교 항목과 블록별 값이 필요합니다.`);
        return;
      }
      for (const slug of Object.keys(row.values)) {
        if (!registeredComplexes.has(slug)) {
          errors.push(`complexOverview.comparisonRows[${index}].values.${slug}: 등록된 단지 slug만 허용합니다.`);
        } else if (!comparisonSlugSet.has(slug)) {
          errors.push(`complexOverview.comparisonRows[${index}].values.${slug}: 비교 대상 단지 값만 허용합니다.`);
        }
      }
      for (const slug of comparisonSlugs) {
        if (!isNonEmptyString(row.values[slug])) errors.push(`complexOverview.comparisonRows[${index}].values.${slug}: 비교값이 필요합니다.`);
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

export function validateFaq(faq) {
  if (!Array.isArray(faq)) return ["faq: 배열이어야 합니다."];
  const errors = [];
  const questions = new Set();
  faq.forEach((item, index) => {
    const path = `faq[${index}]`;
    if (!allowedFaqCategories.has(item?.category)) errors.push(`${path}.category: 허용된 FAQ 카테고리가 필요합니다.`);
    if (!isNonEmptyString(item?.question)) {
      errors.push(`${path}.question: 질문이 필요합니다.`);
    } else if (questions.has(item.question.trim())) {
      errors.push(`${path}.question: 중복 질문입니다.`);
    } else {
      questions.add(item.question.trim());
    }
    if (!isNonEmptyString(item?.answer)) errors.push(`${path}.answer: 답변이 필요합니다.`);
  });
  return errors;
}

export function validateReviews(reviews) {
  if (!Array.isArray(reviews)) return ["reviews: 배열이어야 합니다."];
  const errors = [];
  const ids = new Set();
  reviews.forEach((review, index) => {
    const path = `reviews[${index}]`;
    if (!isKebabCase(review?.id)) errors.push(`${path}.id: 영문 kebab-case가 필요합니다.`);
    if (ids.has(review?.id)) errors.push(`${path}.id: 중복 ID입니다.`);
    ids.add(review?.id);
    if (typeof review?.isPublished !== "boolean") errors.push(`${path}.isPublished: boolean 값이 필요합니다.`);
    if (review?.isPublished) {
      for (const key of ["displayName", "content", "source"]) {
        if (!isNonEmptyString(review?.[key])) errors.push(`${path}.${key}: 공개 후기 필수값입니다.`);
      }
      if (!isIsoDateOrNull(review?.confirmedAt) || review.confirmedAt === null) {
        errors.push(`${path}.confirmedAt: 오늘 이하의 실제 YYYY-MM-DD 확인일이 필요합니다.`);
      }
      if (review?.privacyReviewed !== true) errors.push(`${path}.privacyReviewed: 공개 전 개인정보 검수가 필요합니다.`);
      if (!isIsoDateOrNull(review?.privacyReviewedAt) || review.privacyReviewedAt === null) {
        errors.push(`${path}.privacyReviewedAt: 오늘 이하의 실제 YYYY-MM-DD 검수일이 필요합니다.`);
      }
    } else {
      if (!isIsoDateOrNull(review?.confirmedAt)) errors.push(`${path}.confirmedAt: 오늘 이하의 실제 YYYY-MM-DD 또는 null이어야 합니다.`);
      if (!isIsoDateOrNull(review?.privacyReviewedAt)) errors.push(`${path}.privacyReviewedAt: 오늘 이하의 실제 YYYY-MM-DD 또는 null이어야 합니다.`);
    }
    if (review?.archivedAt !== undefined && !isIsoDateOrNull(review.archivedAt)) {
      errors.push(`${path}.archivedAt: 오늘 이하의 실제 YYYY-MM-DD 또는 null이어야 합니다.`);
    }
    if (review?.updatedAt !== undefined && !isNonEmptyString(review.updatedAt)) {
      errors.push(`${path}.updatedAt: 비어 있지 않은 문자열이어야 합니다.`);
    }
  });
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
  errors.push(...validateFaq(faq));
  errors.push(...validateReviews(reviews));

  const content = { office, listings, naverListings, complexes, complexOverview, externalLinks, homeContent, faq, reviews };
  for (const [resource, value] of Object.entries(content)) {
    errors.push(...findUnexpectedKeys(resource, value));
  }
  errors.push(...findBannedKeys(content));
  errors.push(...findSensitiveStrings(content, { office }));
  return [...new Set(errors)];
}
