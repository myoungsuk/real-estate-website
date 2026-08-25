export const ADMIN_LISTING_STATUSES = ["all", "draft", "published", "contracted", "ended"];

const adminListingStatusSet = new Set(ADMIN_LISTING_STATUSES);

export function normalizeAdminListingQuery(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("ko-KR");
}

export function normalizeAdminListingStatus(value) {
  const status = String(value ?? "").trim();
  return adminListingStatusSet.has(status) ? status : "all";
}

export function readAdminListingFilters(searchParams) {
  return {
    query: normalizeAdminListingQuery(searchParams?.get?.("q")),
    status: normalizeAdminListingStatus(searchParams?.get?.("status")),
  };
}

export function matchesAdminListing(record, filters = {}) {
  const query = normalizeAdminListingQuery(filters.query);
  const status = normalizeAdminListingStatus(filters.status);
  const statusMatches = status === "all" || record.status === status;
  const queryMatches = query === "" || normalizeAdminListingQuery(record.searchText).includes(query);
  return statusMatches && queryMatches;
}

export function filterAdminListings(records, filters = {}) {
  return records.filter((record) => matchesAdminListing(record, filters));
}
