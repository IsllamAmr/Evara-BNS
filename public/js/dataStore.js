// Shared data access helpers for browser pages. Keep pagination and cache
// behavior here so each page receives a complete, consistent result set.
export async function fetchAllRows(buildQuery, { pageSize = 500 } = {}) {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await buildQuery().range(offset, offset + pageSize - 1);
    if (error) throw error;
    const page = data || [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

function stableSerialize(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${key}:${stableSerialize(value[key])}`).join('|')}}`;
  }
  return String(value);
}

export function createQueryCache() {
  const entries = new Map();

  function buildCacheKey(namespace, params = {}) {
    return `${namespace}:${stableSerialize(params)}`;
  }

  function getFreshCachedValue(key) {
    const entry = entries.get(key);
    return entry?.data !== undefined && entry.expiresAt > Date.now() ? entry.data : null;
  }

  function getCachedQuery(key, ttlMs, loader, { force = false } = {}) {
    const existing = entries.get(key);
    if (!force && existing?.data !== undefined && existing.expiresAt > Date.now()) return Promise.resolve(existing.data);
    if (!force && existing?.promise) return existing.promise;

    const entry = { data: existing?.data, expiresAt: existing?.expiresAt || 0, promise: null };
    const promise = Promise.resolve().then(loader).then((data) => {
      // An invalidated or superseded request must never refill the cache.
      if (entries.get(key) === entry) {
        entry.data = data;
        entry.expiresAt = Date.now() + ttlMs;
        entry.promise = null;
      }
      return data;
    }).catch((error) => {
      if (entries.get(key) === entry) entries.delete(key);
      throw error;
    });
    entry.promise = promise;
    entries.set(key, entry);
    return promise;
  }

  function invalidateQueryCache(prefixes = []) {
    const list = Array.isArray(prefixes) ? prefixes : [prefixes];
    if (!list.length) {
      entries.clear();
      return;
    }
    for (const key of entries.keys()) {
      if (list.some((prefix) => key.startsWith(prefix))) entries.delete(key);
    }
  }

  return { buildCacheKey, getFreshCachedValue, getCachedQuery, invalidateQueryCache };
}
