import test from 'node:test';
import assert from 'node:assert/strict';
import { validImdbId, formatBadgeDate, chooseMovieDateForTest } from '../lib/release-dates.mjs';

test('accepts IMDb title IDs only', () => {
  assert.equal(validImdbId('tt1234567'), true);
  assert.equal(validImdbId('tt123456'), false);
  assert.equal(validImdbId('https://example.com'), false);
});
test('formats a confirmed date for a compact badge', () => {
  assert.equal(formatBadgeDate('2026-12-20'), 'DEC 20');
  assert.equal(formatBadgeDate('not-a-date'), null);
});
test('prefers the Indian future release date', () => {
  const rows = [
    { iso_3166_1: 'US', release_dates: [{ release_date: '2026-12-10T00:00:00.000Z' }] },
    { iso_3166_1: 'IN', release_dates: [{ release_date: '2026-12-20T00:00:00.000Z' }] }
  ];
  assert.deepEqual(chooseMovieDateForTest(rows, '2026-11-11'), {
    date: '2026-12-20', region: 'IN', source: 'tmdb-movie-release-dates'
  });
});
test('ignores past dates', () => {
  const rows = [{ iso_3166_1: 'IN', release_dates: [{ release_date: '2026-10-20T00:00:00.000Z' }] }];
  assert.equal(chooseMovieDateForTest(rows, '2026-11-11'), null);
});