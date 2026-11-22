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
  const fetch = async url => new Response(JSON.stringify(String(url).includes('recent-release-audit')
    ? { items: [] }
    : index), {
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
      { id: 'tt1234567', type: 'movie', releaseDate: '2026-11-20', releaseDateBasis: 'first-verified-digital-arrival', matchState: 'published' },
      { id: 'tt7654321', type: 'movie', releaseDate: '2026-11-01', releaseDateBasis: 'first-verified-digital-arrival', matchState: 'published' },
      { id: 'tt9999999', type: 'movie', releaseDate: '2026-11-22', releaseDateBasis: 'first-verified-digital-arrival', matchState: 'unmatched' },
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

test('earliest published digital date wins when a title has multiple platform arrivals', async () => {
  resetCatalogAddedIndexForTest();
  const now = new Date('2026-11-23T08:00:00.000Z');
  const index = {
    'dobins_hi_movie|tt1375789': '2026-11-22T08:00:00.000Z',
    'dobins_hi_movie|tt0073707': '2026-11-22T08:00:00.000Z',
    'dobins_ta_movie|tt5959980': '2026-11-22T08:00:00.000Z'
  };
  const audit = {
    items: [
      { id: 'tt1375789', type: 'movie', releaseDate: '2019-01-01', releaseDateBasis: 'first-verified-digital-arrival', matchState: 'published' },
      { id: 'tt1375789', type: 'movie', releaseDate: '2026-11-20', releaseDateBasis: 'first-verified-digital-arrival', matchState: 'published' },
      { id: 'tt0073707', type: 'movie', releaseDate: '2020-01-01', releaseDateBasis: 'first-verified-digital-arrival', matchState: 'published' },
      { id: 'tt0073707', type: 'movie', releaseDate: '2026-11-19', releaseDateBasis: 'first-verified-digital-arrival', matchState: 'published' },
      { id: 'tt5959980', type: 'movie', releaseDate: '2018-01-01', releaseDateBasis: 'first-verified-digital-arrival', matchState: 'published' },
      { id: 'tt5959980', type: 'movie', releaseDate: '2026-11-18', releaseDateBasis: 'first-verified-digital-arrival', matchState: 'published' }
    ]
  };
  const fetch = async url => new Response(JSON.stringify(String(url).includes('recent-release-audit') ? audit : index), {
    status: 200, headers: { 'content-type': 'application/json' }
  });
  for (const id of ['tt1375789', 'tt0073707', 'tt5959980']) {
    assert.equal(await isCatalogRecentlyAdded([id], { fetch, now }), false, id + ' must use its earliest digital arrival');
    resetCatalogAddedIndexForTest();
  }
});

test('catalog badge query cannot override an authoritative negative decision', async () => {
  const { resolveJustAddedDecision } = await import('../lib/catalog-just-added.mjs');
  assert.equal(resolveJustAddedDecision(false, 'just-added'), false);
  assert.equal(resolveJustAddedDecision(true, ''), true);
  assert.equal(resolveJustAddedDecision(null, 'just-added'), null, 'index outage preserves the existing source-artwork fallback path');
});

test('theatrical-only published movie entries cannot grant a Just Added badge', async () => {
  resetCatalogAddedIndexForTest();
  const now = new Date('2026-11-23T08:00:00.000Z');
  const index = {};
  const audit = {
    items: [
      { id: 'tt1111111', type: 'movie', releaseDate: '2026-11-22', releaseDateBasis: 'theatrical-release', matchState: 'published' },
      { id: 'tt2222222', type: 'movie', releaseDate: '2026-11-22', matchState: 'published' },
      { id: 'tt3333333', type: 'movie', releaseDate: '2026-11-22', releaseDateBasis: 'first-verified-digital-arrival', matchState: 'published' }
    ]
  };
  const fetch = async url => new Response(JSON.stringify(String(url).includes('recent-release-audit') ? audit : index), {
    status: 200, headers: { 'content-type': 'application/json' }
  });
  assert.equal(await isCatalogRecentlyAdded(['tt1111111'], { fetch, now }), false, 'theatrical date is not a digital arrival');
  resetCatalogAddedIndexForTest();
  assert.equal(await isCatalogRecentlyAdded(['tt2222222'], { fetch, now }), false, 'missing date basis must fail closed');
  resetCatalogAddedIndexForTest();
  assert.equal(await isCatalogRecentlyAdded(['tt3333333'], { fetch, now }), true, 'explicit digital evidence qualifies');
  resetCatalogAddedIndexForTest();
});
