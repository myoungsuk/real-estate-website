import {
  getNaverListingPublicTextErrors,
  getUnexpectedNaverListingKeys,
} from "../src/lib/naver-listing-public-validation.mjs";
import { matchComplexByListingTitle, normalizeComplexText } from "../src/lib/complex-matching.mjs";
import { getBlogCategoryErrors, getBlogExcerptErrors } from "../src/lib/blog-excerpt.mjs";
import { DEAL_NEWS_KEYS } from "../src/lib/deal-news.mjs";
import { validateDealNews } from "../src/lib/admin-deal-news.mjs";

const allowedStatuses = new Set(["draft", "published", "contracted", "ended"]);
const allowedTradeTypes = new Set(["sale", "jeonse", "monthly-rent"]);
const allowedComplexStatuses = new Set(["preparing", "published"]);
const allowedComplexSourceKinds = new Set(["official", "public-data", "operator", "news"]);
const allowedComplexAmenityVerifications = new Set(["official", "operator-confirmed", "historical-plan", "check-required"]);
const allowedComplexLivingCategories = new Set(["transport", "education", "daily-life", "nature"]);
const complexSeoMaximumLengths = Object.freeze({ title: 70, description: 180 });
const allowedExternalContentTypes = new Set(["blog", "youtube", "instagram"]);
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
    instagramUrl: valueSchema,
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
    excerpt: valueSchema,
    category: valueSchema,
    url: valueSchema,
    publishedAt: valueSchema,
    thumbnail: imageSchema,
  })),
  homeContent: objectSchema({
    broker: objectSchema({
      eyebrow: valueSchema,
      headline: valueSchema,
      points: arraySchema(objectSchema({ icon: valueSchema, title: valueSchema, description: valueSchema })),
      portrait: imageSchema,
    }),
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
  // 거래 완료 소식: 칸 목록·꼴 검사는 src/lib/deal-news.mjs·admin-deal-news.mjs 한 곳(금액·동·층·호수·날짜·손님 칸은 만들 수 없음).
  dealNews: arraySchema(objectSchema(Object.fromEntries(DEAL_NEWS_KEYS.map((key) => [key, valueSchema])))),
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

  for (const key of ["naverPlaceUrl", "naverListingsUrl", "naverBlogUrl", "youtubeUrl", "instagramUrl", "kakaoUrl"]) {
    try {
      const url = new URL(office?.[key]);
      if (url.protocol !== "https:") errors.push(`office.${key}: HTTPS만 허용합니다.`);
    } catch {
      errors.push(`office.${key}: 올바른 공개 URL이 필요합니다.`);
    }
  }

  // 인스타그램 바로가기는 머리 메뉴·홈에서 새 창으로 열리므로 공식 인스타그램 주소(https://www.instagram.com/ 아래)만 허용한다.
  try {
    if (new URL(office?.instagramUrl).origin !== "https://www.instagram.com") {
      errors.push("office.instagramUrl: https://www.instagram.com/ 아래 주소만 허용합니다.");
    }
  } catch {
    // 주소 형식 오류는 바로 위 반복 검사가 알린다.
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

function isUnsoldHousingCount(value, match) {
  // 천 단위 표기와 바로 앞의 통계 문맥을 함께 확인하고, 다른 호수는 계속 검사한다.
  return /^\d{1,3}(?:,\d{3})+\s*호$/u.test(match[0])
    && /미분양\s+물량\s+(?:\d{4}년\s+\d{1,2}월\s+)?$/u.test(value.slice(0, match.index))
    && !value.startsWith("실", match.index + match[0].length);
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
  for (const match of value.matchAll(/(?<!\d)(?:\d{1,3}(?:,\d{3})+|\d{1,4})\s*호(?!선|점|기|차)/gu)) {
    if (isUnsoldHousingCount(value, match)) continue;
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
    if (!allowedExternalContentTypes.has(link.type)) errors.push(`${path}.type: blog·youtube·instagram만 허용합니다.`);
    if (link.type === "youtube" && !allowedYoutubeContentFormats.has(link.youtubeFormat)) {
      errors.push(`${path}.youtubeFormat: video 또는 short만 허용합니다.`);
    }
    if (link.type === "blog" && link.youtubeFormat !== undefined) {
      errors.push(`${path}.youtubeFormat: 블로그 콘텐츠에는 사용할 수 없습니다.`);
    }
    if (link.type === "instagram" && link.youtubeFormat !== undefined) {
      errors.push(`${path}.youtubeFormat: 인스타그램 콘텐츠에는 사용할 수 없습니다.`);
    }
    if (!allowedExternalContentStatuses.has(link.status)) errors.push(`${path}.status: draft 또는 published만 허용합니다.`);
    for (const key of ["title", "summary"]) {
      if (!isNonEmptyString(link[key])) errors.push(`${path}.${key}: 공개 문구가 필요합니다.`);
    }
    // 글 앞부분 요약(excerpt)·네이버 분류(category)는 블로그 글에만 두는 선택 칸이다(2026-11-25 사용자 승인).
    // 형식 규칙(1 ~ 300자·1 ~ 30자, 줄바꿈·앞뒤 공백·HTML·엔티티 없음)은 src/lib/blog-excerpt.mjs 한 곳에 둔다.
    for (const [key, getErrors] of [["excerpt", getBlogExcerptErrors], ["category", getBlogCategoryErrors]]) {
      if (link[key] === undefined) continue;
      if (link.type !== "blog") {
        errors.push(`${path}.${key}: 블로그 콘텐츠에만 사용할 수 있습니다.`);
        continue;
      }
      for (const message of getErrors(link[key])) errors.push(`${path}.${key}: ${message}`);
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
      // 인스타그램은 관리자가 직접 등록하는 게시물 한 건의 주소(/p/·/reel/)만 받는다.
      // 공유 주소 뒤의 ?igsh=… 같은 꼬리는 공유한 계정을 알려 주므로 물음표·# 뒤 꼬리가 있으면 받지 않는다(관리자 화면이 저장 전에 지운다).
      if (link.type === "instagram" && (
        !["https://www.instagram.com", "https://instagram.com"].includes(url.origin)
        || url.username !== ""
        || url.password !== ""
        || /[?#]/u.test(link.url)
        || !/^\/(?:p|reel)\/[A-Za-z0-9_-]+\/?$/u.test(url.pathname)
      )) {
        errors.push(`${path}.url: 인스타그램 게시물 주소(https://www.instagram.com/p/… 또는 /reel/…, 물음표 뒤 꼬리 없이)만 허용합니다.`);
      }
    } catch {
      errors.push(`${path}.url: 올바른 URL이 아닙니다.`);
    }
    if (!isIsoDateOrNull(link.publishedAt)) errors.push(`${path}.publishedAt: YYYY-MM-DD 또는 null이어야 합니다.`);
    // 인스타그램은 사진이 카드 본문이라 썸네일을 꼭 둔다(블로그·유튜브는 썸네일 없이 기호 칸으로 보일 수 있음).
    errors.push(...validateImage(link.thumbnail, `${path}.thumbnail`, { required: link.type === "instagram" }));
  });
  return errors;
}

// 홈 문구 칸별 최대 글자 수(JS .length, 관리자 입력 칸 maxlength와 같은 기준). 관리자 저장 전 검증·빌드·동기화 검증에서 같이 막는다.
// 2026-11-17 사용자 승인 17:53:04 "제안대로 막기"(지금 값의 약 1.5 ~ 2배). 사진 위에 올라가는 대표 작은 제목·대표 문장은
// 새 홈 배치(360px 4줄 안) 확인으로 30·50(날개-4 17:59).
export const HOME_CONTENT_MAX_LENGTHS = Object.freeze({
  "broker.eyebrow": 30,
  "broker.headline": 50,
  "office.eyebrow": 40,
  "office.title": 50,
  "office.description": 150,
  "areaGuide.eyebrow": 40,
  "areaGuide.title": 40,
  "areaGuide.description": 150,
  imageAlt: 50,
  badge: 24,
  cardTitle: 30,
  cardDescription: 120,
  // 대표 소개 항목(2026-11-27, broker.lead 200자 칸을 대신함): 그림 문자 한두 개·제목·설명. 항목은 1 ~ 6개.
  pointIcon: 8,
  pointTitle: 30,
  pointDescription: 120,
  pointsMax: 6,
});

function tooLong(value, max) {
  return typeof value === "string" && value.length > max;
}

function lengthError(path, max) {
  return `${path}: 최대 ${max}자까지 쓸 수 있습니다.`;
}

export function validateHomeContent(homeContent) {
  const errors = [];
  const requiredStrings = [
    ["broker.eyebrow", homeContent?.broker?.eyebrow],
    ["broker.headline", homeContent?.broker?.headline],
    ["office.eyebrow", homeContent?.office?.eyebrow],
    ["office.title", homeContent?.office?.title],
    ["office.description", homeContent?.office?.description],
    ["areaGuide.eyebrow", homeContent?.areaGuide?.eyebrow],
    ["areaGuide.title", homeContent?.areaGuide?.title],
    ["areaGuide.description", homeContent?.areaGuide?.description],
  ];
  requiredStrings.forEach(([path, value]) => {
    if (!isNonEmptyString(value)) errors.push(`homeContent.${path}: 공개 문구가 필요합니다.`);
    else if (tooLong(value, HOME_CONTENT_MAX_LENGTHS[path])) errors.push(lengthError(`homeContent.${path}`, HOME_CONTENT_MAX_LENGTHS[path]));
  });
  const points = homeContent?.broker?.points;
  if (!Array.isArray(points) || points.length === 0) {
    errors.push("homeContent.broker.points: 한 개 이상의 대표 소개 항목이 필요합니다.");
  } else {
    if (points.length > HOME_CONTENT_MAX_LENGTHS.pointsMax) errors.push(`homeContent.broker.points: 최대 ${HOME_CONTENT_MAX_LENGTHS.pointsMax}개까지 쓸 수 있습니다.`);
    points.forEach((point, index) => {
      const path = `homeContent.broker.points[${index}]`;
      if (!isNonEmptyString(point?.title) || !isNonEmptyString(point?.description)) errors.push(`${path}: 제목과 설명이 필요합니다.`);
      if (typeof point?.icon !== "string") errors.push(`${path}.icon: 그림 문자는 글자여야 합니다(없으면 빈 글자).`);
      if (tooLong(point?.icon, HOME_CONTENT_MAX_LENGTHS.pointIcon)) errors.push(lengthError(`${path}.icon`, HOME_CONTENT_MAX_LENGTHS.pointIcon));
      if (tooLong(point?.title, HOME_CONTENT_MAX_LENGTHS.pointTitle)) errors.push(lengthError(`${path}.title`, HOME_CONTENT_MAX_LENGTHS.pointTitle));
      if (tooLong(point?.description, HOME_CONTENT_MAX_LENGTHS.pointDescription)) errors.push(lengthError(`${path}.description`, HOME_CONTENT_MAX_LENGTHS.pointDescription));
    });
  }
  errors.push(...validateImage(homeContent?.broker?.portrait, "homeContent.broker.portrait", { required: true }));
  errors.push(...validateImage(homeContent?.office?.image, "homeContent.office.image", { required: true }));
  for (const [path, image] of [["broker.portrait", homeContent?.broker?.portrait], ["office.image", homeContent?.office?.image]]) {
    if (tooLong(image?.alt, HOME_CONTENT_MAX_LENGTHS.imageAlt)) errors.push(lengthError(`homeContent.${path}.alt`, HOME_CONTENT_MAX_LENGTHS.imageAlt));
  }
  if (!Array.isArray(homeContent?.office?.badges) || homeContent.office.badges.length === 0 || homeContent.office.badges.some((badge) => !isNonEmptyString(badge))) {
    errors.push("homeContent.office.badges: 한 개 이상의 표시 문구가 필요합니다.");
  } else {
    homeContent.office.badges.forEach((badge, index) => {
      if (tooLong(badge, HOME_CONTENT_MAX_LENGTHS.badge)) errors.push(lengthError(`homeContent.office.badges[${index}]`, HOME_CONTENT_MAX_LENGTHS.badge));
    });
  }
  if (!Array.isArray(homeContent?.areaGuide?.cards) || homeContent.areaGuide.cards.length === 0) {
    errors.push("homeContent.areaGuide.cards: 한 개 이상의 지역 안내 카드가 필요합니다.");
  } else {
    homeContent.areaGuide.cards.forEach((card, index) => {
      if (!isNonEmptyString(card.title) || !isNonEmptyString(card.description)) {
        errors.push(`homeContent.areaGuide.cards[${index}]: 제목과 설명이 필요합니다.`);
      }
      if (tooLong(card.title, HOME_CONTENT_MAX_LENGTHS.cardTitle)) errors.push(lengthError(`homeContent.areaGuide.cards[${index}].title`, HOME_CONTENT_MAX_LENGTHS.cardTitle));
      if (tooLong(card.description, HOME_CONTENT_MAX_LENGTHS.cardDescription)) errors.push(lengthError(`homeContent.areaGuide.cards[${index}].description`, HOME_CONTENT_MAX_LENGTHS.cardDescription));
    });
  }
  return errors;
}

// 확정 공개 정보 9가지(저장소 CLAUDE.md "확정 공개 정보" 표). 사칭에 민감해 관리자 저장·변경 이력 복원으로 바뀌지 않게 고정한다
// (2026-11-17 사용자 승인 17:53:04 "9가지 고정"). 바꿀 때는 개발 PR(사용자 승인)로 이 표와 CLAUDE.md를 함께 고친다.
// 영업시간·주차·소개 문장·네이버·유튜브·인스타그램 링크는 바뀔 수 있어 고정하지 않는다. validateOffice와 따로 두어 가짜 사무소 자료로 하는 형식 시험에는 걸지 않는다.
export const APPROVED_OFFICE_FACTS = Object.freeze({
  legalName: "리더스시티행복한공인중개사사무소",
  brandName: "리더스시티 행복한부동산",
  representative: "백진옥",
  mobile: "010-2790-8675",
  email: "packjinok123@gmail.com",
  address: "대전광역시 동구 안샘로14번길 7, 리더스시티5블록 근린생활시설 105호",
  registrationNumber: "30110-2023-00028",
  businessNumber: "805-05-02602",
  kakaoUrl: "https://pf.kakao.com/_nxmabn/chat",
});

export function validateApprovedOfficeFacts(office) {
  return Object.entries(APPROVED_OFFICE_FACTS)
    .filter(([key, value]) => office?.[key] !== value)
    .map(([key]) => `office.${key}: 확정 공개 정보와 다릅니다. 바꾸려면 개발 PR로 승인값을 함께 고쳐야 합니다.`);
}

// 매물 제목에 쓰이는 단지 표기(고정 목록). 단지 이름·별칭을 바꿔도 이 표기가 원래 단지에 연결돼야 저장된다(2026-11-17 사용자 승인).
// 운영 매물(naver-listings.json)이 아니라 이 고정 목록만 보므로 매일 동기화를 막지 않는다. 단지를 아예 지우면 그 단지 표기는 보지 않는다.
// 공개 여부와 상관없이 본다(준비 중으로 돌려도 이름·별칭은 남으므로).
export const KNOWN_LISTING_TITLES = Object.freeze([
  Object.freeze({ title: "리더스시티 4블록", slug: "leaders-city-4" }),
  Object.freeze({ title: "리더스시티 5블록", slug: "leaders-city-5" }),
  Object.freeze({ title: "신흥SK뷰", slug: "sinheung-sk-view" }),
  Object.freeze({ title: "리더스시티4블록 401동", slug: "leaders-city-4" }),
  Object.freeze({ title: "리더스시티5블록 501동", slug: "leaders-city-5" }),
  Object.freeze({ title: "신흥에스케이뷰 101동", slug: "sinheung-sk-view" }),
]);

export function validateKnownListingTitles(complexes) {
  if (!Array.isArray(complexes)) return [];
  const slugs = new Set(complexes.map((complex) => complex?.slug));
  return KNOWN_LISTING_TITLES
    .filter(({ title, slug }) => {
      if (!slugs.has(slug)) return false;
      try {
        return matchComplexByListingTitle(title, complexes)?.slug !== slug;
      } catch {
        return false; // 이름·별칭 모양이 틀린 자료는 validateComplexes가 따로 알린다.
      }
    })
    .map(({ title, slug }) => `complexes.${slug}: 매물 표기 "${title}"이(가) 이 단지에 연결되지 않습니다. 옛 이름을 별칭에 넣어 주세요.`);
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

export function validateContent({ office, listings, naverListings, complexes, complexOverview, externalLinks, homeContent, faq, reviews, dealNews }) {
  const errors = validateOffice(office);
  errors.push(...validateApprovedOfficeFacts(office));
  errors.push(...validateListings(listings));
  errors.push(...validateNaverListings(naverListings));
  errors.push(...validateComplexes(complexes, externalLinks));
  errors.push(...validateKnownListingTitles(complexes));
  errors.push(...validateComplexOverview(complexOverview, complexes, externalLinks));
  errors.push(...validateExternalLinks(externalLinks));
  errors.push(...validateHomeContent(homeContent));
  errors.push(...validateFaq(faq));
  errors.push(...validateReviews(reviews));
  errors.push(...validateDealNews(dealNews));

  const content = { office, listings, naverListings, complexes, complexOverview, externalLinks, homeContent, faq, reviews, dealNews };
  for (const [resource, value] of Object.entries(content)) {
    errors.push(...findUnexpectedKeys(resource, value));
  }
  errors.push(...findBannedKeys(content));
  errors.push(...findSensitiveStrings(content, { office }));
  return [...new Set(errors)];
}

// 업무 도구 단계 0 법령 데이터(src/data/work/legal-rules.json). 공개 법령 정보만 담는다.
const legalRuleSourceSchema = objectSchema({ title: valueSchema, version: valueSchema });
const legalRuleBracketSchema = objectSchema({
  minWon: valueSchema,
  maxWonExclusive: valueSchema,
  rateBp: valueSchema,
  capWon: valueSchema,
});
const legalRulesSchema = objectSchema({
  schemaVersion: valueSchema,
  checkedAt: valueSchema,
  brokerageFeeRules: arraySchema(objectSchema({
    id: valueSchema,
    appliesFrom: valueSchema,
    appliesTo: valueSchema,
    region: valueSchema,
    sources: arraySchema(legalRuleSourceSchema),
    housing: objectSchema({ sale: arraySchema(legalRuleBracketSchema), lease: arraySchema(legalRuleBracketSchema) }),
    officetel: objectSchema({ conditions: arraySchema(valueSchema), saleRateBp: valueSchema, leaseRateBp: valueSchema }),
    otherMaxRateBp: valueSchema,
    monthlyRentConversion: objectSchema({ multiplier: valueSchema, lowMultiplier: valueSchema, lowThresholdWon: valueSchema }),
  })),
  deadlineRules: arraySchema(objectSchema({
    id: valueSchema,
    kind: valueSchema,
    days: valueSchema,
    label: valueSchema,
    calendarTitle: valueSchema,
    legalText: valueSchema,
    sources: arraySchema(legalRuleSourceSchema),
  })),
  screeningRules: objectSchema({
    id: valueSchema,
    sources: arraySchema(legalRuleSourceSchema),
    fundingPlan: objectSchema({
      housingPriceAtLeastWon: valueSchema,
      landCapitalAreaAtLeastWon: valueSchema,
      landOtherAtLeastWon: valueSchema,
      landShareOtherAtLeastWon: valueSchema,
    }),
    leaseReport: objectSchema({ depositOverWon: valueSchema, monthlyRentOverWon: valueSchema }),
  }),
});
const requiredDeadlineKinds = Object.freeze(["transactionReport", "fundingPlanDelivery", "fundingPlanSeparate", "leaseReport"]);
const requiredOfficetelConditions = Object.freeze(["exclusiveAreaAtMost85", "kitchenToiletBath"]);
// 법령 판 표기만 허용한다. 예: "국토교통부령 제1611호, 2026. 8. 11., 시행 2026. 8. 28."
const legalVersionPattern = /^(?:법률|대통령령|국토교통부령|대전광역시조례) 제\d{1,6}호, \d{4}\. \d{1,2}\. \d{1,2}\.(?:, 시행 \d{4}\. \d{1,2}\. \d{1,2}\.)?$/u;

function isPositiveRateBp(value) {
  return Number.isSafeInteger(value) && value > 0 && value <= 10000;
}

function validateLegalRuleSources(sources, path) {
  if (!Array.isArray(sources) || sources.length === 0) return [`${path}: 한 개 이상의 법령 출처가 필요합니다.`];
  const errors = [];
  sources.forEach((source, index) => {
    if (!isNonEmptyString(source?.title)) errors.push(`${path}[${index}].title: 법령 이름과 조문이 필요합니다.`);
    if (typeof source?.version !== "string" || !legalVersionPattern.test(source.version)) {
      errors.push(`${path}[${index}].version: "국토교통부령 제1611호, 2026. 8. 11., 시행 2026. 8. 28." 형식의 법령 판 표기가 필요합니다.`);
    }
  });
  return errors;
}

function validateFeeBrackets(brackets, path) {
  if (!Array.isArray(brackets) || brackets.length === 0) return [`${path}: 요율 구간이 필요합니다.`];
  const errors = [];
  let expectedMin = 0;
  brackets.forEach((bracket, index) => {
    const bracketPath = `${path}[${index}]`;
    const isLast = index === brackets.length - 1;
    if (bracket?.minWon !== expectedMin) errors.push(`${bracketPath}.minWon: 앞 구간과 빈틈·겹침 없이 ${expectedMin}에서 시작해야 합니다.`);
    if (isLast) {
      if (bracket?.maxWonExclusive !== null) errors.push(`${bracketPath}.maxWonExclusive: 마지막 구간만 null이어야 합니다.`);
    } else if (!isPositiveSafeInteger(bracket?.maxWonExclusive) || bracket.maxWonExclusive <= bracket.minWon) {
      errors.push(`${bracketPath}.maxWonExclusive: minWon보다 큰 원 단위 정수여야 합니다.`);
    }
    if (!isPositiveRateBp(bracket?.rateBp)) errors.push(`${bracketPath}.rateBp: 1 ~ 10000 사이 정수(bp)여야 합니다.`);
    if (bracket?.capWon !== null && !isPositiveSafeInteger(bracket?.capWon)) errors.push(`${bracketPath}.capWon: null 또는 원 단위 양의 정수여야 합니다.`);
    expectedMin = bracket?.maxWonExclusive;
  });
  return errors;
}

function withoutLegalVersions(value) {
  if (Array.isArray(value)) return value.map(withoutLegalVersions);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => {
    if (key === "sources" && Array.isArray(child)) return [key, child.map((source) => ({ ...source, version: "" }))];
    return [key, withoutLegalVersions(child)];
  }));
}

export function validateLegalRules(legalRules) {
  const path = "legalRules";
  if (!legalRules || typeof legalRules !== "object" || Array.isArray(legalRules)) return [`${path}: 객체여야 합니다.`];
  const errors = [];
  if (legalRules.schemaVersion !== 1) errors.push(`${path}.schemaVersion: 1이어야 합니다.`);
  if (!isIsoDateOrNull(legalRules.checkedAt) || legalRules.checkedAt === null) {
    errors.push(`${path}.checkedAt: 오늘 이하의 실제 YYYY-MM-DD 확인일이 필요합니다.`);
  }

  const feeRules = legalRules.brokerageFeeRules;
  if (!Array.isArray(feeRules) || feeRules.length === 0) {
    errors.push(`${path}.brokerageFeeRules: 한 개 이상의 중개보수 규칙이 필요합니다.`);
  } else {
    const ids = new Set();
    const appliesFromDates = new Set();
    feeRules.forEach((rule, index) => {
      const rulePath = `${path}.brokerageFeeRules[${index}]`;
      if (!isKebabCase(rule?.id)) errors.push(`${rulePath}.id: 영문 kebab-case가 필요합니다.`);
      if (ids.has(rule?.id)) errors.push(`${rulePath}.id: 중복 규칙 ID입니다.`);
      ids.add(rule?.id);
      if (!isValidCalendarDate(rule?.appliesFrom)) errors.push(`${rulePath}.appliesFrom: 실제 YYYY-MM-DD 날짜가 필요합니다.`);
      if (appliesFromDates.has(rule?.appliesFrom)) errors.push(`${rulePath}.appliesFrom: 같은 시작일 규칙이 이미 있습니다.`);
      appliesFromDates.add(rule?.appliesFrom);
      if (rule?.appliesTo !== "contractDate") errors.push(`${rulePath}.appliesTo: contractDate여야 합니다.`);
      if (rule?.region !== "daejeon") errors.push(`${rulePath}.region: daejeon이어야 합니다.`);
      errors.push(...validateLegalRuleSources(rule?.sources, `${rulePath}.sources`));
      errors.push(...validateFeeBrackets(rule?.housing?.sale, `${rulePath}.housing.sale`));
      errors.push(...validateFeeBrackets(rule?.housing?.lease, `${rulePath}.housing.lease`));
      const conditions = rule?.officetel?.conditions;
      if (!Array.isArray(conditions) || conditions.length !== requiredOfficetelConditions.length
        || !requiredOfficetelConditions.every((condition) => conditions.includes(condition))) {
        errors.push(`${rulePath}.officetel.conditions: ${requiredOfficetelConditions.join(", ")} 두 조건이 필요합니다.`);
      }
      for (const key of ["saleRateBp", "leaseRateBp"]) {
        if (!isPositiveRateBp(rule?.officetel?.[key])) errors.push(`${rulePath}.officetel.${key}: 1 ~ 10000 사이 정수(bp)여야 합니다.`);
      }
      if (!isPositiveRateBp(rule?.otherMaxRateBp)) errors.push(`${rulePath}.otherMaxRateBp: 1 ~ 10000 사이 정수(bp)여야 합니다.`);
      const conversion = rule?.monthlyRentConversion;
      for (const key of ["multiplier", "lowMultiplier", "lowThresholdWon"]) {
        if (!isPositiveSafeInteger(conversion?.[key])) errors.push(`${rulePath}.monthlyRentConversion.${key}: 양의 정수여야 합니다.`);
      }
    });
  }

  const deadlineRules = legalRules.deadlineRules;
  if (!Array.isArray(deadlineRules)) {
    errors.push(`${path}.deadlineRules: 배열이어야 합니다.`);
  } else {
    const kinds = deadlineRules.map((rule) => rule?.kind);
    for (const kind of requiredDeadlineKinds) {
      if (kinds.filter((item) => item === kind).length !== 1) errors.push(`${path}.deadlineRules: ${kind} 규칙이 정확히 1개 필요합니다.`);
    }
    deadlineRules.forEach((rule, index) => {
      const rulePath = `${path}.deadlineRules[${index}]`;
      if (!isKebabCase(rule?.id)) errors.push(`${rulePath}.id: 영문 kebab-case가 필요합니다.`);
      if (!requiredDeadlineKinds.includes(rule?.kind)) errors.push(`${rulePath}.kind: 허용되지 않은 기한 종류입니다.`);
      if (!Number.isSafeInteger(rule?.days) || rule.days < 1 || rule.days > 365) errors.push(`${rulePath}.days: 1 ~ 365 사이 정수여야 합니다.`);
      for (const key of ["label", "calendarTitle", "legalText"]) {
        if (!isNonEmptyString(rule?.[key])) errors.push(`${rulePath}.${key}: 비어 있지 않은 문자열이어야 합니다.`);
      }
      errors.push(...validateLegalRuleSources(rule?.sources, `${rulePath}.sources`));
    });
  }

  const screening = legalRules.screeningRules;
  if (!screening || typeof screening !== "object") {
    errors.push(`${path}.screeningRules: 객체여야 합니다.`);
  } else {
    if (!isKebabCase(screening.id)) errors.push(`${path}.screeningRules.id: 영문 kebab-case가 필요합니다.`);
    errors.push(...validateLegalRuleSources(screening.sources, `${path}.screeningRules.sources`));
    for (const key of ["housingPriceAtLeastWon", "landCapitalAreaAtLeastWon", "landOtherAtLeastWon", "landShareOtherAtLeastWon"]) {
      if (!isPositiveSafeInteger(screening.fundingPlan?.[key])) errors.push(`${path}.screeningRules.fundingPlan.${key}: 원 단위 양의 정수여야 합니다.`);
    }
    for (const key of ["depositOverWon", "monthlyRentOverWon"]) {
      if (!isPositiveSafeInteger(screening.leaseReport?.[key])) errors.push(`${path}.screeningRules.leaseReport.${key}: 원 단위 양의 정수여야 합니다.`);
    }
  }

  errors.push(...findUnexpectedKeysWithSchema(legalRules, legalRulesSchema, path, []));
  errors.push(...findBannedKeys(legalRules, path));
  // 법령 판 표기("제1611호" 등)는 위 형식 검사로 따로 막으므로, 그 값만 빼고 민감 문자열 검사를 그대로 적용한다.
  errors.push(...findSensitiveStrings(withoutLegalVersions(legalRules), { path }));
  return [...new Set(errors)];
}

// 글 초안(P3) 매물 종류별 명시사항 규칙(src/data/work/ad-disclosure-rules.json). 공개 법령·고시 기준만 담는다.
// 화면·Worker가 이 표로 명시사항 빈 칸을 막으므로(DEC-WT-23) 칸 이름·분류가 틀리면 빌드 전에 멈춘다.
const AD_DISCLOSURE_FIELDS = ["location", "area", "price", "kind", "tradeType", "totalFloors", "moveIn", "rooms", "bathrooms", "approvalDate", "parking", "managementFee", "direction"];
const AD_DISCLOSURE_BASE_FIELDS = ["location", "area", "price", "kind", "tradeType"];
const AD_DISCLOSURE_OFFICE_FIELDS = ["name", "address", "phone", "registrationNumber", "representative"];
const AD_DISCLOSURE_CATEGORY_IDS = ["multi-family", "detached", "non-residential", "land"];
const isShortText = (value, max = 100) => typeof value === "string" && value.trim().length > 0 && value.length <= max;
const isTextList = (value, max = 40) => Array.isArray(value) && value.every((item) => isShortText(item, max)) && new Set(value).size === value.length;

export function validateAdDisclosureRules(rules) {
  const path = "adDisclosureRules";
  if (!rules || typeof rules !== "object" || Array.isArray(rules)) return [`${path}: 객체여야 합니다.`];
  const errors = [];
  if (rules.schemaVersion !== 1) errors.push(`${path}.schemaVersion: 1이어야 합니다.`);
  if (!isIsoDateOrNull(rules.checkedAt) || rules.checkedAt === null) errors.push(`${path}.checkedAt: 오늘 이하의 실제 YYYY-MM-DD 확인일이 필요합니다.`);
  if (!Array.isArray(rules.sources) || rules.sources.length === 0
    || !rules.sources.every((source) => isShortText(source?.title, 120) && isShortText(source?.version, 200))) {
    errors.push(`${path}.sources: 법령·고시 이름(title)과 판(version)이 있는 출처가 한 개 이상 필요합니다.`);
  }
  if (!Array.isArray(rules.officeFields) || rules.officeFields.join(",") !== AD_DISCLOSURE_OFFICE_FIELDS.join(",")) {
    errors.push(`${path}.officeFields: 사무소 5항목(${AD_DISCLOSURE_OFFICE_FIELDS.join(", ")})이어야 합니다.`);
  }
  const seenTypes = new Map();
  const categories = Array.isArray(rules.categories) ? rules.categories : [];
  if (categories.map((category) => category?.id).join(",") !== AD_DISCLOSURE_CATEGORY_IDS.join(",")) {
    errors.push(`${path}.categories: 분류는 ${AD_DISCLOSURE_CATEGORY_IDS.join(", ")} 순서여야 합니다.`);
  }
  categories.forEach((category, index) => {
    const categoryPath = `${path}.categories[${index}]`;
    if (!isShortText(category?.label, 60)) errors.push(`${categoryPath}.label: 이름이 필요합니다.`);
    if (!isTextList(category?.propertyTypes) || category.propertyTypes.length === 0) errors.push(`${categoryPath}.propertyTypes: 겹치지 않는 매물 종류가 한 개 이상 필요합니다.`);
    for (const type of Array.isArray(category?.propertyTypes) ? category.propertyTypes : []) {
      if (seenTypes.has(type)) errors.push(`${categoryPath}.propertyTypes: ${type}가 다른 분류에도 있습니다.`);
      seenTypes.set(type, category?.id);
    }
    if (!isTextList(category?.kindChoices, 30)) errors.push(`${categoryPath}.kindChoices: 글자 목록이어야 합니다.`);
    if (!isTextList(category?.directionBasisChoices, 20)) errors.push(`${categoryPath}.directionBasisChoices: 글자 목록이어야 합니다.`);
    if (typeof category?.floorBandAllowed !== "boolean") errors.push(`${categoryPath}.floorBandAllowed: true 또는 false여야 합니다.`);
    const required = Array.isArray(category?.required) ? category.required : null;
    const optional = Array.isArray(category?.optional) ? category.optional : null;
    if (!required || !optional) {
      errors.push(`${categoryPath}.required·optional: 칸 이름 목록이어야 합니다.`);
      return;
    }
    const all = [...required, ...optional];
    if (all.some((field) => !AD_DISCLOSURE_FIELDS.includes(field)) || new Set(all).size !== all.length) {
      errors.push(`${categoryPath}.required·optional: 정해진 칸 이름(${AD_DISCLOSURE_FIELDS.join(", ")})만 한 번씩 쓸 수 있습니다.`);
    }
    if (!AD_DISCLOSURE_BASE_FIELDS.every((field) => required.includes(field))) {
      errors.push(`${categoryPath}.required: 기본 5칸(${AD_DISCLOSURE_BASE_FIELDS.join(", ")})은 늘 필수입니다.`);
    }
    if (all.includes("direction") && !(category.directionBasisChoices?.length > 0)) {
      errors.push(`${categoryPath}.directionBasisChoices: 방향을 적는 분류는 방향 기준 고르기가 필요합니다.`);
    }
  });
  if (!Array.isArray(rules.blockedPropertyTypes)) {
    errors.push(`${path}.blockedPropertyTypes: 목록이어야 합니다.`);
  } else {
    rules.blockedPropertyTypes.forEach((entry, index) => {
      const entryPath = `${path}.blockedPropertyTypes[${index}]`;
      if (!isShortText(entry?.propertyType, 40)) errors.push(`${entryPath}.propertyType: 매물 종류가 필요합니다.`);
      if (!isShortText(entry?.reason, 200)) errors.push(`${entryPath}.reason: 고를 수 없는 이유가 필요합니다.`);
      if (seenTypes.has(entry?.propertyType)) errors.push(`${entryPath}.propertyType: 분류에도 있는 종류는 막을 수 없습니다.`);
    });
  }
  return errors;
}
