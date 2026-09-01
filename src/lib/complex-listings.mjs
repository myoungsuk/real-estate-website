export function selectComplexListings(listings, complexSlug, matchComplex) {
  if (!Array.isArray(listings) || typeof complexSlug !== "string" || !complexSlug || typeof matchComplex !== "function") return [];
  return listings.filter((listing) => (
    typeof listing?.title === "string"
    && matchComplex(listing.title)?.slug === complexSlug
  ));
}

export function createComplexListingPreview(listings, limit = 3) {
  const safeListings = Array.isArray(listings) ? listings : [];
  const safeLimit = Number.isSafeInteger(limit) && limit > 0 ? limit : 3;
  return {
    items: safeListings.slice(0, safeLimit),
    total: safeListings.length,
    hasMore: safeListings.length > safeLimit,
  };
}
