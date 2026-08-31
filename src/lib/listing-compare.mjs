export const MAX_COMPARE_LISTINGS = 3;

export function normalizeCompareIds(value, validIds, maximum = MAX_COMPARE_LISTINGS) {
  const allowed = validIds instanceof Set ? validIds : new Set(validIds ?? []);
  const source = Array.isArray(value) ? value : String(value ?? "").split(",");
  const normalized = [];
  const seen = new Set();
  for (const candidate of source) {
    const id = String(candidate).trim();
    if (!/^\d+$/u.test(id) || !allowed.has(id) || seen.has(id)) continue;
    normalized.push(id);
    seen.add(id);
    if (normalized.length === maximum) break;
  }
  return normalized;
}

export function toggleCompareId(currentIds, id, validIds) {
  const normalized = normalizeCompareIds(currentIds, validIds);
  if (!validIds.has(id)) return { ok: false, reason: "invalid", ids: normalized };
  if (normalized.includes(id)) return { ok: true, reason: null, ids: normalized.filter((currentId) => currentId !== id) };
  if (normalized.length >= MAX_COMPARE_LISTINGS) return { ok: false, reason: "limit", ids: normalized };
  return { ok: true, reason: null, ids: [...normalized, id] };
}

export function buildCompareHref(ids, validIds) {
  const normalized = normalizeCompareIds(ids, validIds);
  return normalized.length > 0
    ? `/properties/compare/?ids=${encodeURIComponent(normalized.join(","))}`
    : "/properties/compare/";
}
