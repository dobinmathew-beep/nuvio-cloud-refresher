import test from 'node:test';
import assert from 'node:assert/strict';
import { isCatalogRecentlyAdded, resetCatalogAddedIndexForTest } from '../lib/catalog-just-added.mjs';

test('shared first-added index applies only to series IDs for 14 days', async () => {
  resetCatalogAddedIndexForTest();
  const now = new Date('2026-11-20T12:00:00.000Z');
  const index = {
    'dobins_ml_movie|tt1234567': '2026-11-10T12:00:00.000Z',
    'dobins_ta_series|tmdb:1819380': '2026-11-06T12:00:00.000Z',
    'dobins_te_series|tvmaze:123': '2026-11-20T11:00:00.000Z',
    'dobins_hi_movie|tt7654321': '2026-11-05T11:59:59.000Z'
  };
  const fetch = async url => new Response(JSON.stringify(String(url).includes('recent-release-audit')
    ? { items: [] }
    : index), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
  assert.equal(await isCatalogRecentlyAdded(['tt1234567'], { fetch, now }), false, 'movie first-seen timestamp must not grant Just Added');
  assert.equal(await isCatalogRecentlyAdded(['tmdb:1819380'], { fetch, now }), true);
  assert.equal(await isCatalogRecentlyAdded(['tvmaze:123'], { fetch, now }), true);
  assert.equal(await isCatalogRecentlyAdded(['tt7654321'], { fetch, now }), false);
  assert.equal(await isCatalogRecentlyAdded(['tt0000000'], { fetch, now }), false);
  resetCatalogAddedIndexForTest();
});

test('Race 2, Sholay and Vada Chennai cannot qualify from recent movie-index timestamps', async () => {
  resetCatalogAddedIndexForTest();
  const now = new Date('2026-11-23T08:00:00.000Z');
  const index = {
    'dobins_hi_movie|tt1375789': '2026-11-22T08:00:00.000Z',
    'dobins_hi_movie|tt0073707': '2026-11-22T08:00:00.000Z',
    'dobins_ta_movie|tt5959980': '2026-11-22T08:00:00.000Z',
    'dobins_ta_series|tmdb:1819380': '2026-11-22T08:00:00.000Z'
  };
  const fetch = async () => new Response(JSON.stringify(index), {
    status: 200, headers: { 'content-type': 'application/json' }
  });
  assert.equal(await isCatalogRecentlyAdded(['tt1375789'], { fetch, now }), false);
  assert.equal(await isCatalogRecentlyAdded(['tt0073707'], { fetch, now }), false);
  assert.equal(await isCatalogRecentlyAdded(['tt5959980'], { fetch, now }), false);
  assert.equal(await isCatalogRecentlyAdded(['tmdb:1819380'], { fetch, now }), true);
  resetCatalogAddedIndexForTest();
});

test('movies qualify only from a published digital release date within 14 days', async () => {
  resetCatalogAddedIndexForTest();
  const now = new Date('2026-11-23T08:00:00.000Z');
  const index = {};
  const audit = {
    items: [
      { id: 'tt1234567', type: 'movie', releaseDate: '2026-11-20', matchState: 'published' },
      { id: 'tt7654321', type: 'movie', releaseDate: '2026-11-01', matchState: 'published' },
      { id: 'tt9999999', type: 'movie', releaseDate: '2026-11-22', matchState: 'unmatched' },
      { id: 'tt8888888', type: 'series', releaseDate: '2026-11-22', matchState: 'published' }
    ]
  };
  const fetch = async url => new Response(JSON.stringify(String(url).includes('recent-release-audit') ? audit : index), {
    status: 200, headers: { 'content-type': 'application/json' }
  });
  assert.equal(await isCatalogRecentlyAdded(['tt1234567'], { fetch, now }), true);
  assert.equal(await isCatalogRecentlyAdded(['tt7654321'], { fetch, now }), false);
  assert.equal(await isCatalogRecentlyAdded(['tt9999999'], { fetch, now }), false);
  assert.equal(await isCatalogRecentlyAdded(['tt8888888'], { fetch, now }), false);
  resetCatalogAddedIndexForTest();
});
