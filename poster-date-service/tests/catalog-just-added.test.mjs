import test from 'node:test';
import assert from 'node:assert/strict';
import { isCatalogRecentlyAdded, resetCatalogAddedIndexForTest } from '../lib/catalog-just-added.mjs';

test('shared Just Added index applies to IMDb, TMDB and TVmaze IDs for 14 days', async () => {
  resetCatalogAddedIndexForTest();
  const now = new Date('2026-11-20T12:00:00.000Z');
  const index = {
    'dobins_ml_movie|tt1234567': '2026-11-10T12:00:00.000Z',
    'dobins_ta_series|tmdb:1819380': '2026-11-06T12:00:00.000Z',
    'dobins_te_series|tvmaze:123': '2026-11-20T11:00:00.000Z',
    'dobins_hi_movie|tt7654321': '2026-11-05T11:59:59.000Z'
  };
  const fetch = async () => new Response(JSON.stringify(index), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
  assert.equal(await isCatalogRecentlyAdded(['tt1234567'], { fetch, now }), true);
  assert.equal(await isCatalogRecentlyAdded(['tmdb:1819380'], { fetch, now }), true);
  assert.equal(await isCatalogRecentlyAdded(['tvmaze:123'], { fetch, now }), true);
  assert.equal(await isCatalogRecentlyAdded(['tt7654321'], { fetch, now }), false);
  assert.equal(await isCatalogRecentlyAdded(['tt0000000'], { fetch, now }), false);
  resetCatalogAddedIndexForTest();
});
