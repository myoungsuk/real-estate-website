const RESOURCE_LABELS = Object.freeze({
  "naver-listings": "네이버 매물",
  "home-content": "첫 화면 콘텐츠",
  "external-links": "외부 콘텐츠",
  complexes: "지역·단지",
  "complexes-overview": "리더스시티 전체 안내",
  listings: "매물",
  office: "사무소",
  faq: "자주 묻는 질문",
  reviews: "후기",
});

const FIELD_LABELS = Object.freeze({
  checkedAt: "매물 목록 업데이트일",
  id: "매물번호",
  title: "제목",
  propertyType: "매물유형",
  tradeType: "거래유형",
  priceLabel: "가격",
  areaLabel: "면적",
  floorLabel: "층",
  direction: "방향",
  summary: "요약",
  registeredAt: "등록일",
  eyebrow: "작은 제목",
  headline: "대표 문장",
  lead: "소개 설명",
  description: "설명",
  badges: "특징 표시",
  alt: "사진 설명",
  src: "공개 이미지",
  cards: "설명 카드",
  status: "공개 상태",
  url: "원문 링크",
  publishedAt: "공개일",
  confirmedAt: "확인일",
  name: "이름",
  slug: "주소 식별자",
  sources: "공개 출처",
  relatedContentIds: "연결 콘텐츠",
  question: "질문",
  answer: "답변",
});

const EXACT_LABELS = Object.freeze({
  "home-content:broker.eyebrow": "대표 영역 작은 제목",
  "home-content:broker.headline": "대표 문장",
  "home-content:broker.lead": "대표 소개 설명",
  "home-content:broker.portrait.src": "대표 사진",
  "home-content:broker.portrait.alt": "대표 사진 설명",
  "home-content:office.eyebrow": "현장 사진 작은 제목",
  "home-content:office.title": "현장 사진 큰 제목",
  "home-content:office.description": "지역 설명",
  "home-content:office.image.src": "단지 사진",
  "home-content:office.image.alt": "단지 사진 설명",
  "home-content:office.badges": "특징 표시",
  "home-content:areaGuide.eyebrow": "지역 안내 작은 제목",
  "home-content:areaGuide.title": "지역 안내 큰 제목",
  "home-content:areaGuide.description": "지역 안내 도입 설명",
  "naver-listings:items": "네이버 공개 매물",
});

const SENSITIVE_KEY_PATTERN = /(?:password|passwd|secret|token|authorization|cookie|accessjwt|privatekey|privateNote|internalNote|customer(?:Name|Phone|Email)?)/iu;
const DATA_URL_PATTERN = /^data:/iu;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu;
const MOBILE_PATTERN = /01[016789][ -]?\d{3,4}[ -]?\d{4}/gu;
const LONG_SECRET_PATTERN = /\b[A-Za-z0-9_-]{32,}\b/gu;
const MAX_DISPLAY_LENGTH = 1200;

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function canonicalString(value) {
  return JSON.stringify(canonicalize(value));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function redactText(value) {
  if (DATA_URL_PATTERN.test(value)) return "[이미지 데이터는 표시하지 않음]";
  return value
    .replace(EMAIL_PATTERN, "[이메일 가림]")
    .replace(MOBILE_PATTERN, "[휴대전화번호 가림]")
    .replace(LONG_SECRET_PATTERN, "[민감 문자열 가림]")
    .slice(0, MAX_DISPLAY_LENGTH);
}

function summarizeObject(value) {
  const identifiers = [value?.title, value?.name, value?.id, value?.slug].filter((item) => typeof item === "string" && item.trim());
  return identifiers.length > 0 ? redactText(identifiers.slice(0, 2).join(" · ")) : "공개 항목";
}

export function formatAdminDiffValue(value) {
  if (value === null || value === undefined || value === "") return "없음";
  if (typeof value === "string") return redactText(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return redactText(value.map((item) => isPlainObject(item) ? summarizeObject(item) : String(item)).join(" · ")) || "없음";
  }
  if (isPlainObject(value)) return summarizeObject(value);
  return redactText(String(value));
}

function cleanPath(path) {
  return path.replace(/\[[^\]]+\]/gu, "[]");
}

export function getAdminFieldLabel(resource, path) {
  const exact = EXACT_LABELS[`${resource}:${cleanPath(path)}`] ?? EXACT_LABELS[`${resource}:${path}`];
  if (exact) return exact;
  const lastSegment = path.split(".").at(-1)?.replace(/\[[^\]]+\]/gu, "") ?? path;
  const fieldLabel = FIELD_LABELS[lastSegment] ?? lastSegment;
  return `${RESOURCE_LABELS[resource] ?? "공개 콘텐츠"} · ${fieldLabel}`;
}

function arrayIdentityKey(value) {
  if (!Array.isArray(value) || value.length === 0 || !value.every(isPlainObject)) return null;
  for (const key of ["id", "slug"]) {
    if (value.every((item) => typeof item[key] === "string" && item[key].length > 0)) return key;
  }
  return null;
}

function pushDiff(diffs, resource, path, kind, before, after) {
  const lastSegment = path.split(".").at(-1) ?? "";
  if (SENSITIVE_KEY_PATTERN.test(lastSegment)) return;
  diffs.push({
    resource,
    path,
    label: getAdminFieldLabel(resource, path),
    kind,
    before: formatAdminDiffValue(before),
    after: formatAdminDiffValue(after),
  });
}

function diffArrays(diffs, resource, path, before, after) {
  const identityKey = arrayIdentityKey([...before, ...after]);
  if (identityKey) {
    const beforeMap = new Map(before.map((item) => [item[identityKey], item]));
    const afterMap = new Map(after.map((item) => [item[identityKey], item]));
    for (const [identity, value] of beforeMap) {
      if (!afterMap.has(identity)) pushDiff(diffs, resource, `${path}[${identity}]`, "removed", value, null);
    }
    for (const [identity, value] of afterMap) {
      if (!beforeMap.has(identity)) pushDiff(diffs, resource, `${path}[${identity}]`, "added", null, value);
      else diffValues(diffs, resource, `${path}[${identity}]`, beforeMap.get(identity), value);
    }
    const beforeOrder = before.map((item) => item[identityKey]);
    const afterOrder = after.map((item) => item[identityKey]);
    if (beforeOrder.length === afterOrder.length
      && beforeOrder.every((identity) => afterMap.has(identity))
      && canonicalString(beforeOrder) !== canonicalString(afterOrder)) {
      pushDiff(diffs, resource, path, "reordered", beforeOrder, afterOrder);
    }
    return;
  }

  const beforeSorted = [...before].map(canonicalString).sort();
  const afterSorted = [...after].map(canonicalString).sort();
  if (canonicalString(beforeSorted) === canonicalString(afterSorted)) {
    pushDiff(diffs, resource, path, "reordered", before, after);
    return;
  }
  pushDiff(diffs, resource, path, before.length === 0 ? "added" : after.length === 0 ? "removed" : "changed", before, after);
}

function diffValues(diffs, resource, path, before, after) {
  if (canonicalString(before) === canonicalString(after)) return;
  if (Array.isArray(before) && Array.isArray(after)) return diffArrays(diffs, resource, path, before, after);
  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of [...keys].sort()) {
      if (SENSITIVE_KEY_PATTERN.test(key)) continue;
      const nextPath = path ? `${path}.${key}` : key;
      if (!Object.hasOwn(before, key)) pushDiff(diffs, resource, nextPath, "added", null, after[key]);
      else if (!Object.hasOwn(after, key)) pushDiff(diffs, resource, nextPath, "removed", before[key], null);
      else diffValues(diffs, resource, nextPath, before[key], after[key]);
    }
    return;
  }
  pushDiff(diffs, resource, path, before === undefined ? "added" : after === undefined ? "removed" : "changed", before, after);
}

export function createAdminContentDiff(resource, before, after) {
  const diffs = [];
  diffValues(diffs, resource, Array.isArray(before) && Array.isArray(after) ? "items" : "", before, after);
  return diffs.filter((diff) => diff.path);
}

export function isAdminContentEqual(before, after) {
  return canonicalString(before) === canonicalString(after);
}
