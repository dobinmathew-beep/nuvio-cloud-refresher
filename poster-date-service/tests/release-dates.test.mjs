import test from 'node:test';
import assert from 'node:assert/strict';
import { validImdbId, formatBadgeDate, chooseMovieDateForTest, chooseTvDateForTest, chooseTvScheduleDateForTest, verifiedTvScheduleOverride, getTodayInTimeZone, RELEASE_DATE_TIME_ZONE, hasPastDigitalReleaseForTest } from '../lib/release-dates.mjs';
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

test('the earliest worldwide future digital date wins regardless of territory', () => {
  const rows = [
    { iso_3166_1: 'IN', release_dates: [{ type: 4, release_date: '2026-11-28T00:00:00.000Z' }] },
    { iso_3166_1: 'GB', release_dates: [{ type: 4, release_date: '2026-11-20T00:00:00.000Z' }] },
    { iso_3166_1: 'AU', release_dates: [{ type: 4, release_date: '2026-11-24T00:00:00.000Z' }] }
  ];
  assert.deepEqual(chooseMovieDateForTest(rows, today), {
    date: '2026-11-20', region: 'GB', source: 'tmdb-digital-release', kind: 'premiere'
  });
});

test('a digital date in any territory is eligible', () => {
  const rows = [{ iso_3166_1: 'JP', release_dates: [
    { type: 4, release_date: '2026-11-20T00:00:00.000Z' }
  ] }];
  assert.deepEqual(chooseMovieDateForTest(rows, today), {
    date: '2026-11-20', region: 'JP', source: 'tmdb-digital-release', kind: 'premiere'
  });
});

test('uses another territory digital date when TMDB has no India, US or GB listing', () => {
  const rows = [{ iso_3166_1: 'AU', release_dates: [
    { type: 4, release_date: '2026-11-25T00:00:00.000Z' }
  ] }];
  assert.deepEqual(chooseMovieDateForTest(rows, today), {
    date: '2026-11-25', region: 'AU', source: 'tmdb-digital-release', kind: 'premiere'
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

test('a past digital release in any territory vetoes a later Indian catalogue date', () => {
  const rows = [
    { iso_3166_1: 'US', release_dates: [{ type: 4, release_date: '2026-10-06T00:00:00.000Z' }] },
    { iso_3166_1: 'IN', release_dates: [{ type: 4, release_date: '2026-12-04T00:00:00.000Z' }] }
  ];
  assert.equal(hasPastDigitalReleaseForTest(rows, '2026-11-21'), true);
  assert.equal(chooseMovieDateForTest(rows, '2026-11-21'), null);
});

test('a passed UK digital release also vetoes a future US or Indian date', () => {
  const rows = [
    { iso_3166_1: 'GB', release_dates: [{ type: 4, release_date: '2026-11-01T00:00:00.000Z' }] },
    { iso_3166_1: 'US', release_dates: [{ type: 4, release_date: '2026-12-08T00:00:00.000Z' }] }
  ];
  assert.equal(hasPastDigitalReleaseForTest(rows, '2026-11-21'), true);
  assert.equal(chooseMovieDateForTest(rows, '2026-11-21'), null);
});

test('a future digital date remains eligible when no territory has released digitally', () => {
  const rows = [
    { iso_3166_1: 'US', release_dates: [{ type: 4, release_date: '2026-12-08T00:00:00.000Z' }] },
    { iso_3166_1: 'IN', release_dates: [{ type: 4, release_date: '2026-12-12T00:00:00.000Z' }] }
  ];
  assert.equal(hasPastDigitalReleaseForTest(rows, '2026-11-21'), false);
  assert.equal(chooseMovieDateForTest(rows, '2026-11-21')?.date, '2026-12-08');
});

test('theatrical, premiere and physical releases do not count as digital availability', () => {
  const rows = [{ iso_3166_1: 'US', release_dates: [
    { type: 1, release_date: '2026-10-23T00:00:00.000Z' },
    { type: 2, release_date: '2026-10-23T00:00:00.000Z' },
    { type: 3, release_date: '2026-10-23T00:00:00.000Z' },
    { type: 5, release_date: '2026-10-23T00:00:00.000Z' }
  ] }];
  assert.equal(hasPastDigitalReleaseForTest(rows, '2026-11-21'), false);
  assert.equal(chooseMovieDateForTest(rows, '2026-11-21'), null);
});

test('digital release on the current Oman date is treated as released, not upcoming', () => {
  const rows = [{ iso_3166_1: 'US', release_dates: [
    { type: 4, release_date: '2026-11-21T00:00:00.000Z' }
  ] }];
  assert.equal(hasPastDigitalReleaseForTest(rows, '2026-11-21'), true);
  assert.equal(chooseMovieDateForTest(rows, '2026-11-21'), null);
});

test('wider November 2026 release sample suppresses released titles and preserves genuinely future dates', () => {
  const releasedSample = [
    ['Spider-Man: Brand New Day', 'US', '2026-10-06'],
    ['Insidious: Out of the Further', 'US', '2026-10-06'],
    ['Heart of the Beast', 'US', '2026-11-10'],
    ['The Odyssey', 'US', '2026-11-17'],
    ['The Beast', 'US', '2026-11-17'],
    ['A Talent for Murder', 'US', '2026-11-17']
  ];
  for (const [title, region, date] of releasedSample) {
    const rows = [{ iso_3166_1: region, release_dates: [{ type: 4, release_date: date + 'T00:00:00.000Z' }] }];
    assert.equal(chooseMovieDateForTest(rows, '2026-11-21'), null, title + ' must not show a Coming badge');
  }

  const futureSample = [
    ['Clayface', 'US', '2026-12-08'],
    ['The Social Reckoning', 'US', '2026-11-24']
  ];
  for (const [title, region, date] of futureSample) {
    const rows = [{ iso_3166_1: region, release_dates: [{ type: 4, release_date: date + 'T00:00:00.000Z' }] }];
    assert.equal(chooseMovieDateForTest(rows, '2026-11-21')?.date, date, title + ' should retain its future date');
  }
});
