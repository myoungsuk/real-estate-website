const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const NAVER_ID_PATTERN = /^\d+$/u;
const MAX_WARNING_DAYS = 3_650;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isIsoDate(value) {
  if (!DATE_PATTERN.test(value ?? "")) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function assertExactKeys(value, expected, label) {
  const keys = isPlainObject(value) ? Object.keys(value).sort() : [];
  if (keys.join(",") !== [...expected].sort().join(",")) throw new Error(`${label} 형식이 올바르지 않습니다.`);
}

function validateWarningDays(value, label) {
  if (value === null) return;
  if (!Number.isInteger(value) || value < 1 || value > MAX_WARNING_DAYS) {
    throw new Error(`${label}은 1일부터 ${MAX_WARNING_DAYS}일까지 또는 null이어야 합니다.`);
  }
}

export function validateListingReviewPolicy(policy) {
  assertExactKeys(policy, ["schemaVersion", "bankWarningDays", "manualWarningDays"], "매물 재확인 정책");
  if (policy.schemaVersion !== 1) throw new Error("매물 재확인 정책 버전이 올바르지 않습니다.");
  validateWarningDays(policy.bankWarningDays, "Bank 경고 일수");
  validateWarningDays(policy.manualWarningDays, "직접 등록 경고 일수");
  return policy;
}

export function validateListingReviewState(state, { listingIds = null, bankIds = null } = {}) {
  assertExactKeys(state, ["schemaVersion", "updatedAt", "items"], "매물 재확인 상태");
  if (state.schemaVersion !== 1 || !isIsoDate(state.updatedAt) || !isPlainObject(state.items)) {
    throw new Error("매물 재확인 상태의 버전·날짜·items가 올바르지 않습니다.");
  }
  const expectedListingIds = listingIds ? new Set(listingIds) : null;
  const expectedBankIds = bankIds ? new Set(bankIds) : null;
  const seenIds = new Set();
  for (const [id, item] of Object.entries(state.items)) {
    if (!NAVER_ID_PATTERN.test(id) || seenIds.has(id)) throw new Error("매물 재확인 상태의 네이버 ID가 올바르지 않습니다.");
    assertExactKeys(item, ["source", "lastSeenAt", "lastReviewedAt"], `매물 재확인 상태 ${id}`);
    if (!["bank", "manual"].includes(item.source)) throw new Error(`${id}: 매물 재확인 출처가 올바르지 않습니다.`);
    if (item.lastSeenAt !== null && !isIsoDate(item.lastSeenAt)) throw new Error(`${id}: 마지막 자동 확인일이 올바르지 않습니다.`);
    if (item.lastReviewedAt !== null && !isIsoDate(item.lastReviewedAt)) throw new Error(`${id}: 마지막 직접 확인일이 올바르지 않습니다.`);
    if (item.source === "bank" && (item.lastSeenAt === null || item.lastReviewedAt !== null)) {
      throw new Error(`${id}: Bank 매물의 확인일 구성이 올바르지 않습니다.`);
    }
    if (item.source === "manual" && item.lastSeenAt !== null) {
      throw new Error(`${id}: 직접 등록 매물에는 자동 확인일을 기록할 수 없습니다.`);
    }
    if ((item.lastSeenAt ?? item.lastReviewedAt) > state.updatedAt) {
      throw new Error(`${id}: 매물 확인일은 상태 갱신일보다 늦을 수 없습니다.`);
    }
    if (expectedBankIds && expectedBankIds.has(id) !== (item.source === "bank")) {
      throw new Error(`${id}: Bank 동기화 출처와 재확인 출처가 일치하지 않습니다.`);
    }
    seenIds.add(id);
  }
  if (expectedListingIds && (expectedListingIds.size !== seenIds.size || [...expectedListingIds].some((id) => !seenIds.has(id)))) {
    throw new Error("현재 공개 매물 ID와 재확인 상태 ID가 일치하지 않습니다.");
  }
  return state;
}

export function reconcileListingReviewState({ listings, bankState, currentState, checkedAt }) {
  if (!Array.isArray(listings) || !Array.isArray(bankState?.items) || !isIsoDate(checkedAt)) {
    throw new Error("매물 재확인 상태를 갱신할 입력이 올바르지 않습니다.");
  }
  const listingIds = new Set(listings.map((listing) => listing.id));
  if (listingIds.size !== listings.length || [...listingIds].some((id) => !NAVER_ID_PATTERN.test(id ?? ""))) {
    throw new Error("공개 매물 ID가 올바르지 않거나 중복됩니다.");
  }
  const bankIds = new Set(bankState.items.map((item) => item.naverId));
  if (bankIds.size !== bankState.items.length || [...bankIds].some((id) => !NAVER_ID_PATTERN.test(id ?? ""))) {
    throw new Error("Bank 상태의 네이버 ID가 올바르지 않거나 중복됩니다.");
  }
  if ([...bankIds].some((id) => !listingIds.has(id))) {
    throw new Error("Bank 상태에 현재 공개 목록에 없는 네이버 ID가 있습니다.");
  }
  const previousItems = isPlainObject(currentState?.items) ? currentState.items : {};
  const items = Object.fromEntries([...listingIds].sort().map((id) => {
    const isBank = bankIds.has(id);
    const previous = previousItems[id];
    return [id, isBank
      ? { source: "bank", lastSeenAt: checkedAt, lastReviewedAt: null }
      : {
          source: "manual",
          lastSeenAt: null,
          lastReviewedAt: previous?.source === "manual" && isIsoDate(previous.lastReviewedAt)
            ? previous.lastReviewedAt
            : null,
        }];
  }));
  const next = { schemaVersion: 1, updatedAt: checkedAt, items };
  validateListingReviewState(next, { listingIds, bankIds });
  return next;
}

/**
 * @param {{
 *   listings: Array<{id: string}>,
 *   currentState: {updatedAt?: string, items?: Record<string, {source: "bank" | "manual", lastSeenAt: string | null, lastReviewedAt: string | null}>},
 *   updatedAt: string,
 *   bankIds?: Iterable<string> | null,
 *   reviewedManualIds?: Iterable<string>,
 * }} input
 */
export function updateListingReviewStateForAdmin({
  listings,
  currentState,
  updatedAt,
  bankIds = null,
  reviewedManualIds = [],
}) {
  if (!isIsoDate(updatedAt)) throw new Error("관리자 재확인 날짜가 올바르지 않습니다.");
  const nextListings = Array.isArray(listings) ? listings : [];
  const approvedBankIds = bankIds === null ? null : new Set(bankIds);
  const reviewedIds = new Set(reviewedManualIds);
  const items = Object.fromEntries(nextListings.map((listing) => {
    const id = listing?.id;
    if (typeof id !== "string" || !NAVER_ID_PATTERN.test(id)) throw new Error("관리자 재확인 목록의 Naver ID가 올바르지 않습니다.");
    const current = currentState?.items?.[id] ?? null;
    if (approvedBankIds?.has(id)) {
      return [id, { source: "bank", lastSeenAt: updatedAt, lastReviewedAt: null }];
    }
    if (current) {
      return [id, current.source === "manual" && reviewedIds.has(id)
        ? { ...current, lastReviewedAt: updatedAt }
        : { ...current }];
    }
    return [id, {
      source: "manual",
      lastSeenAt: null,
      lastReviewedAt: reviewedIds.has(id) ? updatedAt : null,
    }];
  }));
  return {
    schemaVersion: 1,
    updatedAt: [currentState?.updatedAt, updatedAt].filter(isIsoDate).sort().at(-1) ?? updatedAt,
    items,
  };
}

function calendarDaysBetween(date, asOf) {
  const start = Date.parse(`${date}T00:00:00Z`);
  const end = Date.parse(`${asOf}T00:00:00Z`);
  return Math.max(0, Math.floor((end - start) / 86_400_000));
}

export function buildListingReviewQueue(listings, state, policy, asOf) {
  validateListingReviewPolicy(policy);
  const listingIds = new Set(listings.map((listing) => listing.id));
  validateListingReviewState(state, { listingIds });
  if (!isIsoDate(asOf)) throw new Error("매물 재확인 기준일이 올바르지 않습니다.");

  const items = listings.map((listing) => {
    const review = state.items[listing.id];
    const warningDays = review.source === "bank" ? policy.bankWarningDays : policy.manualWarningDays;
    const referenceDate = review.source === "bank" ? review.lastSeenAt : review.lastReviewedAt;
    const ageDays = referenceDate ? calendarDaysBetween(referenceDate, asOf) : null;
    const needsReview = warningDays === null
      ? false
      : referenceDate === null || ageDays >= warningDays;
    return {
      ...listing,
      reviewSource: review.source,
      lastSeenAt: review.lastSeenAt,
      lastReviewedAt: review.lastReviewedAt,
      referenceDate,
      ageDays,
      warningDays,
      needsReview,
    };
  });
  return {
    enabled: policy.bankWarningDays !== null || policy.manualWarningDays !== null,
    total: items.length,
    needsReview: items.filter((item) => item.needsReview).length,
    bank: items.filter((item) => item.reviewSource === "bank").length,
    manual: items.filter((item) => item.reviewSource === "manual").length,
    items,
  };
}
