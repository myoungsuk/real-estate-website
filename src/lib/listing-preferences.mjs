export const LISTING_PREFERENCES_STORAGE_KEY = "leaderscityhappy:listing-preferences:v1";
export const LISTING_PREFERENCES_VERSION = 1;
export const MAX_FAVORITE_LISTINGS = 30;

export function normalizeFavoriteIds(value, validIds, maximum = MAX_FAVORITE_LISTINGS) {
  const allowed = validIds instanceof Set ? validIds : new Set(validIds ?? []);
  const normalized = [];
  const seen = new Set();
  for (const id of Array.isArray(value) ? value : []) {
    if (typeof id !== "string" || !/^\d+$/u.test(id) || !allowed.has(id) || seen.has(id)) continue;
    normalized.push(id);
    seen.add(id);
    if (normalized.length === maximum) break;
  }
  return normalized;
}

export function parseListingPreferences(raw, validIds) {
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!value || value.version !== LISTING_PREFERENCES_VERSION) return [];
    return normalizeFavoriteIds(value.favoriteIds, validIds);
  } catch {
    return [];
  }
}

export function createListingPreferencesStore({ storage, validIds, now = () => new Date().toISOString() }) {
  const allowed = validIds instanceof Set ? validIds : new Set(validIds ?? []);
  let persistent = Boolean(storage);
  let favoriteIds = [];
  let repairStoredState = false;

  if (persistent) {
    try {
      const raw = storage.getItem(LISTING_PREFERENCES_STORAGE_KEY);
      favoriteIds = parseListingPreferences(raw, allowed);
      if (raw !== null) {
        try {
          const value = JSON.parse(raw);
          repairStoredState = value?.version !== LISTING_PREFERENCES_VERSION
            || JSON.stringify(value?.favoriteIds) !== JSON.stringify(favoriteIds);
        } catch {
          repairStoredState = true;
        }
      }
    } catch {
      persistent = false;
    }
  }

  const persist = () => {
    if (!persistent) return false;
    try {
      storage.setItem(LISTING_PREFERENCES_STORAGE_KEY, JSON.stringify({
        version: LISTING_PREFERENCES_VERSION,
        favoriteIds,
        updatedAt: now(),
      }));
      return true;
    } catch {
      persistent = false;
      return false;
    }
  };

  const snapshot = () => ({ favoriteIds: [...favoriteIds], persistent });
  if (repairStoredState) persist();

  return {
    getState: snapshot,
    has(id) {
      return favoriteIds.includes(id);
    },
    toggle(id) {
      if (!allowed.has(id)) return { ok: false, reason: "invalid", ...snapshot() };
      if (favoriteIds.includes(id)) {
        favoriteIds = favoriteIds.filter((favoriteId) => favoriteId !== id);
      } else {
        if (favoriteIds.length >= MAX_FAVORITE_LISTINGS) return { ok: false, reason: "limit", ...snapshot() };
        favoriteIds = [...favoriteIds, id];
      }
      persist();
      return { ok: true, reason: null, ...snapshot() };
    },
    clear() {
      favoriteIds = [];
      persist();
      return snapshot();
    },
    sync(raw) {
      favoriteIds = parseListingPreferences(raw, allowed);
      return snapshot();
    },
  };
}
