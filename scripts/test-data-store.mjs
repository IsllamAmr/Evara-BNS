import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../public/js/dataStore.js', import.meta.url), 'utf8');
const { createQueryCache, fetchAllRows } = await import(`data:text/javascript,${encodeURIComponent(source)}`);

const sourceRows = Array.from({ length: 1205 }, (_, id) => ({ id }));
const requestedRanges = [];
const rows = await fetchAllRows(() => ({
  async range(from, to) {
    requestedRanges.push([from, to]);
    return { data: sourceRows.slice(from, to + 1), error: null };
  },
}), { pageSize: 500 });
assert.equal(rows.length, 1205);
assert.deepEqual(requestedRanges, [[0, 499], [500, 999], [1000, 1499]]);

const cache = createQueryCache();
let finishFirst;
const first = cache.getCachedQuery('attendance:today', 1000, () => new Promise((resolve) => {
  finishFirst = resolve;
}));
await Promise.resolve();
cache.invalidateQueryCache('attendance:');
const second = cache.getCachedQuery('attendance:today', 1000, () => 'fresh');
finishFirst('stale');
assert.equal(await first, 'stale');
assert.equal(await second, 'fresh');
assert.equal(cache.getFreshCachedValue('attendance:today'), 'fresh');

console.log('Data pagination and cache invalidation checks passed');
