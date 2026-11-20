import test from 'node:test';
import assert from 'node:assert/strict';
import { upcomingReleaseFromCatalog, resetCatalogUpcomingIndexForTest } from '../lib/catalog-upcoming.mjs';

test('central upcoming index serves dates through IMDb aliases and TMDB/TVmaze IDs', async () => {
  resetCatalogUpcomingIndexForTest();
  const payload = {
    items: [
      { id: 'tmdb:123', aliases: ['tmdb:123', 'tt1234567'], type: 'movie', releaseDate: '2026-11-26', kind: 'premiere', region: 'IN' },
      { id: 'tvmaze:42', aliases: ['tvmaze:42', 'tt7654321'], type: 'series', releaseDate: '2026-11-25', kind: 'episode', region: 'IN' },
      { id: 'tt0000001', aliases: ['tt0000001'], type: 'movie', releaseDate: '2026-11-19', kind: 'premiere' }
    ]
  };
  const fetch = async () => new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
  const now = new Date('2026-11-20T12:00:00.000Z');
  assert.deepEqual(await upcomingReleaseFromCatalog(['tt1234567'], { fetch, now }), {
    date: '2026-11-26', region: 'IN', source: 'great-indian-catalog-upcoming-index', kind: 'premiere', catalog: null
  });
  assert.equal((await upcomingReleaseFromCatalog(['tvmaze:42'], { fetch, now }))?.kind, 'episode');
  assert.equal((await upcomingReleaseFromCatalog(['tt7654321'], { fetch, now }))?.date, '2026-11-25');
  assert.equal(await upcomingReleaseFromCatalog(['tt0000001'], { fetch, now }), null);
  resetCatalogUpcomingIndexForTest();
});
