import test from 'node:test';
import assert from 'node:assert/strict';
import { upcomingReleaseFromCatalog, resetCatalogUpcomingIndexForTest } from '../lib/catalog-upcoming.mjs';
import { isCatalogRecentlyAdded, resetCatalogAddedIndexForTest } from '../lib/catalog-just-added.mjs';

function jsonResponse(value) {
  return { ok: true, json: async () => value };
}

test('upcoming catalogue alias index returns the earliest future release for any supplied alias', async () => {
  resetCatalogUpcomingIndexForTest();
  const calls = [];
  const fetch = async url => {
    calls.push(String(url));
    return jsonResponse({ items: [
      { id: 'tt1111111', aliases: ['tmdb:11'], releaseDate: '2026-12-08', type: 'movie' },
      { id: 'tt2222222', aliases: ['tmdb:22'], releaseDate: '2026-12-02', type: 'series', kind: 'episode' },
      { id: 'tt3333333', releaseDate: '2026-11-20', type: 'movie' }
    ] });
  };
  const result = await upcomingReleaseFromCatalog(['tmdb:11', 'tmdb:22'], { fetch, today: '2026-11-21' });
  assert.equal(result.date, '2026-12-02');
  assert.equal(result.kind, 'episode');
  assert.equal(calls.length, 1);
});

test('upcoming catalogue index cache is reused across ID lookups', async () => {
  resetCatalogUpcomingIndexForTest();
  let calls = 0;
  const fetch = async () => {
    calls++;
    return jsonResponse({ items: [{ id: 'tt4444444', aliases: ['tmdb:44'], releaseDate: '2026-12-10' }] });
  };
  await upcomingReleaseFromCatalog('tt4444444', { fetch, today: '2026-11-21' });
  await upcomingReleaseFromCatalog('tmdb:44', { fetch, today: '2026-11-21' });
  assert.equal(calls, 1);
});

test('just-added index uses its ID map and retains the 14-day eligibility window', async () => {
  resetCatalogAddedIndexForTest();
  let calls = 0;
  const fetch = async () => {
    calls++;
    return jsonResponse({
      'manifest|tt5555555': '2026-11-15T00:00:00.000Z',
      'manifest|tt6666666': '2026-10-01T00:00:00.000Z'
    });
  };
  const now = Date.parse('2026-11-21T00:00:00.000Z');
  assert.equal(await isCatalogRecentlyAdded('tt5555555', { fetch, now }), true);
  assert.equal(await isCatalogRecentlyAdded('tt6666666', { fetch, now }), false);
  assert.equal(calls, 1);
});
