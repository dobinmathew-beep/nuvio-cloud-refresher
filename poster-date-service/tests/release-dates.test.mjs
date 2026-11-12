import test from 'node:test';
import assert from 'node:assert/strict';
import { validImdbId, formatBadgeDate, chooseMovieDateForTest, chooseTvDateForTest, chooseTvScheduleDateForTest, verifiedTvScheduleOverride, getTodayInTimeZone, RELEASE_DATE_TIME_ZONE } from '../lib/release-dates.mjs';
import { hasExpectedDateBadgeText } from '../lib/coming-tag.mjs';

const today = '2026-11-12';

test('accepts IMDb title IDs only', () => {
  assert.equal(validImdbId('tt1234567'), true);
  assert.equal(validImdbId('tt123456'), false);
  assert.equal(validImdbId('https://example.com'), false);
});

test('formats a confirmed date for a compact badge', () => {
  assert.equal(formatBadgeDate('2026-12-20'), 'DEC 20');
  assert.equal(formatBadgeDate('not-a-date'), null);
});


test('today is evaluated using the Oman calendar day, including its midnight boundary', () => {
  assert.equal(RELEASE_DATE_TIME_ZONE, 'Asia/Muscat');
  assert.equal(getTodayInTimeZone(new Date('2026-11-12T19:59:59.999Z')), '2026-11-12');
  assert.equal(getTodayInTimeZone(new Date('2026-11-12T20:00:00.000Z')), '2026-11-13');
  assert.equal(getTodayInTimeZone(new Date('2026-11-12T00:00:00.000Z')), '2026-11-12');
});

test('date-only provider schedule values are not shifted when formatted for badges', () => {
  assert.equal(formatBadgeDate('2026-11-13'), 'NOV 13');
});

test('verified schedule override expires at Oman midnight, not UTC midnight', () => {
  const beforeOmanMidnight = getTodayInTimeZone(new Date('2026-11-12T19:59:59.999Z'));
  const atOmanMidnight = getTodayInTimeZone(new Date('2026-11-12T20:00:00.000Z'));
  assert.equal(verifiedTvScheduleOverride('tt33043892', 2, 3, beforeOmanMidnight)?.date, '2026-11-13');
  assert.equal(verifiedTvScheduleOverride('tt33043892', 2, 3, atOmanMidnight), null);
});

test('movie theatrical dates never create a coming badge', () => {
  const rows = [{ iso_3166_1: 'IN', release_dates: [
    { type: 3, release_date: '2026-11-20T00:00:00.000Z' },
    { type: 2, release_date: '2026-11-21T00:00:00.000Z' }
  ] }];
  assert.equal(chooseMovieDateForTest(rows, today), null);
});

test('movie digital release date creates a premiere badge', () => {
  const rows = [{ iso_3166_1: 'IN', release_dates: [
    { type: 3, release_date: '2026-11-05T00:00:00.000Z' },
    { type: 4, release_date: '2026-11-28T00:00:00.000Z' }
  ] }];
  assert.deepEqual(chooseMovieDateForTest(rows, today), {
    date: '2026-11-28', region: 'IN', source: 'tmdb-digital-release', kind: 'premiere'
  });
});

test('an already-passed Indian digital date does not fall through to a later foreign date', () => {
  const rows = [
    { iso_3166_1: 'IN', release_dates: [{ type: 4, release_date: '2026-11-10T00:00:00.000Z' }] },
    { iso_3166_1: 'GB', release_dates: [{ type: 4, release_date: '2026-11-20T00:00:00.000Z' }] }
  ];
  assert.equal(chooseMovieDateForTest(rows, today), null);
});

test('foreign digital date is a fallback only when India has no digital listing', () => {
  const rows = [{ iso_3166_1: 'GB', release_dates: [
    { type: 4, release_date: '2026-11-20T00:00:00.000Z' }
  ] }];
  assert.deepEqual(chooseMovieDateForTest(rows, today), {
    date: '2026-11-20', region: 'GB', source: 'tmdb-digital-release', kind: 'premiere'
  });
});

test('ongoing series gets a separate upcoming episode badge', () => {
  assert.deepEqual(chooseTvDateForTest({
    first_air_date: '2026-09-04',
    next_episode_to_air: { air_date: '2026-11-13' },
    origin_country: ['IN']
  }, today), {
    date: '2026-11-13', region: 'IN', source: 'tmdb-next-episode', kind: 'episode'
  });
});

test('unreleased series gets a premiere badge', () => {
  assert.deepEqual(chooseTvDateForTest({
    first_air_date: '2026-11-25',
    next_episode_to_air: null,
    origin_country: ['IN']
  }, today), {
    date: '2026-11-25', region: 'IN', source: 'tmdb-series-premiere', kind: 'premiere'
  });
});

test('released series without an upcoming episode gets no badge', () => {
  assert.equal(chooseTvDateForTest({
    first_air_date: '2026-09-04',
    next_episode_to_air: null,
    origin_country: ['IN']
  }, today), null);
});

test('premiere and episode badges are distinguished when preserving existing artwork', () => {
  assert.equal(hasExpectedDateBadgeText('Coming 13 Nov', 'premiere'), true);
  assert.equal(hasExpectedDateBadgeText('New Episode 13 Nov', 'episode'), true);
  assert.equal(hasExpectedDateBadgeText('Coming 13 Nov', 'episode'), false);
  assert.equal(hasExpectedDateBadgeText('New Episode 13 Nov', 'premiere'), false);
});


test('a poster badge is preserved only when its date exactly matches TMDB', () => {
  assert.equal(hasExpectedDateBadgeText('New Episode 13 Nov', 'episode', '2026-11-13'), true);
  assert.equal(hasExpectedDateBadgeText('New Episode 15 Nov', 'episode', '2026-11-13'), false);
  assert.equal(hasExpectedDateBadgeText('Coming 13 Nov', 'premiere', '2026-11-13'), true);
  assert.equal(hasExpectedDateBadgeText('Coming 16 Nov', 'premiere', '2026-11-13'), false);
});


test('TVmaze same-episode streaming air date overrides a conflicting TMDB date', () => {
  const details = { next_episode_to_air: { air_date: '2026-11-15', season_number: 2, episode_number: 3 }, origin_country: ['US'] };
  const episodes = [{ season: 2, number: 3, airdate: '2026-11-13' }];
  assert.deepEqual(chooseTvScheduleDateForTest(details, episodes, today), {
    date: '2026-11-13', region: 'US', source: 'tvmaze-episode-airdate', kind: 'episode', season: 2, episode: 3
  });
});

test('TVmaze date is never borrowed from a different episode', () => {
  const details = { next_episode_to_air: { air_date: '2026-11-15', season_number: 2, episode_number: 3 }, origin_country: ['US'] };
  const episodes = [{ season: 2, number: 4, airdate: '2026-11-13' }];
  assert.equal(chooseTvScheduleDateForTest(details, episodes, today).date, '2026-11-15');
});

test('matching TVmaze episode already aired prevents a later conflicting upcoming badge', () => {
  const details = { next_episode_to_air: { air_date: '2026-11-15', season_number: 2, episode_number: 3 }, origin_country: ['US'] };
  const episodes = [{ season: 2, number: 3, airdate: '2026-11-10' }];
  assert.equal(chooseTvScheduleDateForTest(details, episodes, today), null);
});

test('verified Paramount+ schedule correction overrides conflicting metadata only until release day', () => {
  assert.deepEqual(verifiedTvScheduleOverride('tt33043892', 2, 3, '2026-11-12'), {
    date: '2026-11-13', region: 'US', source: 'paramount-plus-published-schedule',
    kind: 'episode', season: 2, episode: 3
  });
  assert.equal(verifiedTvScheduleOverride('tt33043892', 2, 3, '2026-11-13'), null);
  assert.equal(verifiedTvScheduleOverride('tt33043892', 2, 4, '2026-11-12'), null);
});
