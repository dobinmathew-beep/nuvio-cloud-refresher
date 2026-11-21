const TMDB = 'https://api.themoviedb.org/3';
const memory = new Map();
const pending = new Map();
const CACHE_MS = 30 * 60 * 1000;
const NEGATIVE_CACHE_MS = 30 * 60 * 1000;

// All date-only schedules remain source calendar dates. Only the definition of
// "today" (future/past comparison and override expiry) uses Oman's local day.
export const RELEASE_DATE_TIME_ZONE = 'Asia/Muscat';

export function getTodayInTimeZone(now = new Date(), timeZone = RELEASE_DATE_TIME_ZONE) {
  const instant = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(instant.getTime())) throw new RangeError('Invalid date supplied to getTodayInTimeZone');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(instant);
  const values = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return values.year + '-' + values.month + '-' + values.day;
}

// Verified provider schedule corrections for individual episodes where the
// general metadata feed conflicts with the streaming platform's published
// release calendar. Dates are calendar dates, not timezone-shifted timestamps.
const VERIFIED_TV_SCHEDULE_OVERRIDES = new Map([
  ['tt33043892|2|3', {
    date: '2026-11-13',
    source: 'paramount-plus-published-schedule',
    reference: 'https://www.paramountplus.com/sneak-peak/dexter-resurrection-season-2-everything-you-need-to-know'
  }]
]);

export function validImdbId(value) {
  return typeof value === 'string' && /^tt\d{7,10}$/.test(value);
}
export function formatBadgeDate(isoDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate || '')) return null;
  const date = new Date(isoDate + 'T00:00:00Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== isoDate) return null;
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date).toUpperCase();
}
function isFuture(date, today) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date || '') && date > today;
}

// TMDB release_type 4 is Digital. Theatrical, premiere, physical and TV
// broadcast dates must never be used as a movie's upcoming digital date.
function digitalDates(rows) {
  return rows.flatMap(row => (row.release_dates || [])
    .filter(item => item.type === 4)
    .map(item => ({ date: (item.release_date || '').slice(0, 10), region: row.iso_3166_1 })))
    .filter(item => /^\d{4}-\d{2}-\d{2}$/.test(item.date));
}
export function hasPastDigitalReleaseForTest(rows, today) {
  // The artwork is shared across regions. Once any territory has a confirmed
  // digital (buy/rent) release, a later territory date must not keep a global
  // "Coming" badge alive. Physical, theatrical and premiere dates are excluded.
  return digitalDates(rows).some(item => item.date <= today);
}
function chooseMovieDate(rows, today) {
  const all = digitalDates(rows);
  if (hasPastDigitalReleaseForTest(rows, today)) return null;
  // Prefer India's digital date. If TMDB has no Indian digital listing at
  // all, a confirmed US/GB digital date may be used as a fallback.
  const byDate = values => values.sort((a, b) => a.date.localeCompare(b.date));
  const india = byDate(all.filter(item => item.region === 'IN'));
  const futureIndia = india.find(item => isFuture(item.date, today));
  if (futureIndia) return { ...futureIndia, source: 'tmdb-digital-release', kind: 'premiere' };
  // If TMDB has an Indian digital listing, its passed date is authoritative;
  // do not resurrect the title with a later foreign release date.
  if (india.length) return null;

  const preferredForeign = byDate(all.filter(item => ['US', 'GB'].includes(item.region)));
  const futurePreferred = preferredForeign.find(item => isFuture(item.date, today));
  if (futurePreferred) return { ...futurePreferred, source: 'tmdb-digital-release', kind: 'premiere' };

  // Broaden coverage when TMDB has no IN/US/GB listing at all: use the
  // earliest confirmed future digital date from another territory.
  const otherTerritories = byDate(all.filter(item => item.region && !['IN', 'US', 'GB'].includes(item.region)));
  const futureOther = otherTerritories.find(item => isFuture(item.date, today));
  return futureOther ? { ...futureOther, source: 'tmdb-digital-release', kind: 'premiere' } : null;
}
function chooseTvDate(details, today) {
  // A next episode is a separate event from the series premiere.
  const next = details.next_episode_to_air?.air_date;
  if (isFuture(next, today)) {
    return { date: next, region: details.origin_country?.[0] || null, source: 'tmdb-next-episode', kind: 'episode' };
  }
  // Only an unreleased series can receive the premiere-style badge.
  const premiere = details.first_air_date;
  if (isFuture(premiere, today)) {
    return { date: premiere, region: details.origin_country?.[0] || null, source: 'tmdb-series-premiere', kind: 'premiere' };
  }
  return null;
}
async function tmdbJson(path, credential) {
  const url = new URL(TMDB + path);
  if (path.startsWith('/find/')) url.searchParams.set('external_source', 'imdb_id');
  const headers = { accept: 'application/json' };
  if (credential.readToken) headers.authorization = 'Bearer ' + credential.readToken;
  else url.searchParams.set('api_key', credential.apiKey);
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(9000) });
  if (!response.ok) throw new Error('TMDB lookup failed: ' + response.status);
  return response.json();
}

export function verifiedTvScheduleOverride(imdbId, season, episode, today = getTodayInTimeZone()) {
  const override = VERIFIED_TV_SCHEDULE_OVERRIDES.get(imdbId + '|' + season + '|' + episode);
  if (!override || !isFuture(override.date, today)) return null;
  return { date: override.date, region: 'US', source: override.source, kind: 'episode', season, episode };
}

function chooseTvScheduleDate(tmdbDetails, tvmazeEpisodes, today) {
  const next = tmdbDetails.next_episode_to_air;
  const hasTmdbEpisode = Number.isInteger(next?.season_number) &&
    Number.isInteger(next?.episode_number);

  // TVmaze must corroborate the exact episode identified by TMDB. Never
  // borrow the date of a different future episode just because it appears
  // earlier in TVmaze's list.
  if (hasTmdbEpisode) {
    const matchingEpisode = (tvmazeEpisodes || []).find(episode =>
      episode.season === next.season_number &&
      episode.number === next.episode_number
    );

    if (matchingEpisode) {
      // If the matching episode has already aired (or airs today), do not
      // resurrect it with a conflicting future date from TMDB.
      if (!isFuture(matchingEpisode.airdate, today)) return null;

      return {
        date: matchingEpisode.airdate,
        region: tmdbDetails.origin_country?.[0] || null,
        source: 'tvmaze-episode-airdate',
        kind: 'episode',
        season: matchingEpisode.season,
        episode: matchingEpisode.number
      };
    }

    // TVmaze has no record of this exact episode; keep TMDB's own date
    // rather than substituting an unrelated TVmaze episode.
    return chooseTvDate(tmdbDetails, today);
  }

  // If TMDB has not identified a next episode, TVmaze may supply the earliest
  // future episode as a fallback.
  const futureEpisode = (tvmazeEpisodes || [])
    .filter(episode =>
      Number.isInteger(episode.season) &&
      Number.isInteger(episode.number) &&
      isFuture(episode.airdate, today)
    )
    .sort((a, b) =>
      a.airdate.localeCompare(b.airdate) ||
      a.season - b.season ||
      a.number - b.number
    )[0];

  if (futureEpisode) {
    return {
      date: futureEpisode.airdate,
      region: tmdbDetails.origin_country?.[0] || null,
      source: 'tvmaze-next-future-episode',
      kind: 'episode',
      season: futureEpisode.season,
      episode: futureEpisode.number
    };
  }

  return chooseTvDate(tmdbDetails, today);
}
async function getTvmazeEpisodes(imdbId) {
  const lookupUrl = new URL('https://api.tvmaze.com/lookup/shows');
  lookupUrl.searchParams.set('imdb', imdbId);
  const lookupResponse = await fetch(lookupUrl, { signal: AbortSignal.timeout(5000) });
  if (!lookupResponse.ok) throw new Error('TVmaze show lookup failed: ' + lookupResponse.status);
  const show = await lookupResponse.json();
  if (!Number.isInteger(show?.id)) return null;
  const episodesUrl = new URL('https://api.tvmaze.com/shows/' + show.id + '/episodes');
  episodesUrl.searchParams.set('specials', '0');
  const episodesResponse = await fetch(episodesUrl, { signal: AbortSignal.timeout(5000) });
  if (!episodesResponse.ok) throw new Error('TVmaze episode lookup failed: ' + episodesResponse.status);
  return episodesResponse.json();
}
async function resolveDate(imdbId, credential, today) {
  const found = await tmdbJson('/find/' + encodeURIComponent(imdbId), credential);
  const movie = found.movie_results?.[0];
  if (movie?.id) {
    const releaseData = await tmdbJson('/movie/' + movie.id + '/release_dates', credential);
    const selected = chooseMovieDate(releaseData.results || [], today);
    console.info('[release-date-resolution]', JSON.stringify({ imdbId, mediaType: 'movie', tmdbId: movie.id, selectedDate: selected?.date || null, selectedSource: selected?.source || null, region: selected?.region || null, dateInterpretation: 'TMDB calendar date; no timezone shift', comparisonTimeZone: RELEASE_DATE_TIME_ZONE, evaluationDate: today }));
    return selected;
  }
  const show = found.tv_results?.[0];
  if (show?.id) {
    // TMDB details and TVmaze corroboration are independent once the
    // IMDb-to-TMDB match is known. Run both concurrently to avoid serial
    // network wait while preserving the exact-episode matching rules below.
    let tvmazeEpisodes = null;
    let tvmazeError = null;
    const [detailsResult, tvmazeResult] = await Promise.allSettled([
      tmdbJson('/tv/' + show.id, credential),
      getTvmazeEpisodes(imdbId)
    ]);
    if (detailsResult.status === 'rejected') throw detailsResult.reason;
    const details = detailsResult.value;
    if (tvmazeResult.status === 'fulfilled') tvmazeEpisodes = tvmazeResult.value;
    else tvmazeError = tvmazeResult.reason?.message || 'unknown error';
    const selected = chooseTvScheduleDate(details, tvmazeEpisodes, today);
    const matchingTvmazeEpisode = (tvmazeEpisodes || []).find(episode =>
      episode.season === details.next_episode_to_air?.season_number &&
      episode.number === details.next_episode_to_air?.episode_number
    );
    console.info('[release-date-resolution]', JSON.stringify({
      imdbId, mediaType: 'tv', tmdbId: show.id,
      tmdbSeason: details.next_episode_to_air?.season_number || null,
      tmdbEpisode: details.next_episode_to_air?.episode_number || null,
      tmdbNextEpisodeAirDate: details.next_episode_to_air?.air_date || null,
      tvmazeEpisodeAirDate: matchingTvmazeEpisode?.airdate || null,
      selectedDate: selected?.date || null,
      selectedSource: selected?.source || null,
      tvmazeError,
      dateInterpretation: 'episode calendar date; no timezone shift',
      comparisonTimeZone: RELEASE_DATE_TIME_ZONE,
      evaluationDate: today
    }));
    return selected;
  }
  return null;
}
const pastDigitalReleaseCache = new Map();
export async function hasPastDigitalRelease(imdbId, options = {}) {
  if (!validImdbId(imdbId)) return null;
  const today = options.today || getTodayInTimeZone(options.now || new Date());
  const credential = { apiKey: options.apiKey || process.env.TMDB_API_KEY || '', readToken: process.env.TMDB_API_READ_ACCESS_TOKEN || '' };
  if (!credential.apiKey && !credential.readToken) return null;
  const key = imdbId + '|digital-released|' + today;
  const cached = pastDigitalReleaseCache.get(key);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  try {
    const found = await tmdbJson('/find/' + encodeURIComponent(imdbId), credential);
    const movie = found.movie_results?.[0];
    if (!movie?.id) return false;
    const releaseData = await tmdbJson('/movie/' + movie.id + '/release_dates', credential);
    const released = hasPastDigitalReleaseForTest(releaseData.results || [], today);
    pastDigitalReleaseCache.set(key, { value: released, at: Date.now() });
    while (pastDigitalReleaseCache.size > 1200) pastDigitalReleaseCache.delete(pastDigitalReleaseCache.keys().next().value);
    console.info('[digital-release-status]', JSON.stringify({ imdbId, tmdbId: movie.id, digitalReleased: released, evaluationDate: today, policy: 'any-confirmed-territory-vetoes-global-coming-badge' }));
    return released;
  } catch (error) {
    console.warn('[digital-release-status-lookup-failed]', JSON.stringify({ imdbId, error: error?.message || 'unknown error' }));
    return null;
  }
}

export async function hasPastDigitalReleaseByTmdbId(tmdbId, options = {}) {
  const id = String(tmdbId || '');
  if (!/^\d{1,12}$/.test(id)) return null;
  const today = options.today || getTodayInTimeZone(options.now || new Date());
  const credential = { apiKey: options.apiKey || process.env.TMDB_API_KEY || '', readToken: process.env.TMDB_API_READ_ACCESS_TOKEN || '' };
  if (!credential.apiKey && !credential.readToken) return null;
  const key = 'tmdb:' + id + '|digital-released|' + today;
  const cached = pastDigitalReleaseCache.get(key);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  try {
    const releaseData = await tmdbJson('/movie/' + id + '/release_dates', credential);
    const released = hasPastDigitalReleaseForTest(releaseData.results || [], today);
    pastDigitalReleaseCache.set(key, { value: released, at: Date.now() });
    return released;
  } catch (error) {
    console.warn('[digital-release-status-lookup-failed]', JSON.stringify({ tmdbId: id, error: error?.message || 'unknown error' }));
    return null;
  }
}

export async function upcomingRelease(imdbId, options = {}) {
  if (!validImdbId(imdbId)) return null;
  const today = options.today || getTodayInTimeZone(options.now || new Date());
  // Apply a verified episode-specific correction before requiring third-party
  // metadata credentials. This prevents a known conflicting TMDB date from
  // reintroducing an incorrect badge for this published episode schedule.
  const verifiedOverride = verifiedTvScheduleOverride(imdbId, 2, 3, today);
  if (verifiedOverride) return verifiedOverride;
  const credential = { apiKey: options.apiKey || process.env.TMDB_API_KEY || '', readToken: process.env.TMDB_API_READ_ACCESS_TOKEN || '' };
  if (!credential.apiKey && !credential.readToken) return null;
  const cacheKey = imdbId + '|' + today;
  const cached = memory.get(cacheKey);
  if (cached && Date.now() - cached.at < (cached.value ? CACHE_MS : NEGATIVE_CACHE_MS)) return cached.value;
  if (pending.has(cacheKey)) return pending.get(cacheKey);
  const job = (async () => {
    try {
      const value = await resolveDate(imdbId, credential, today);
      memory.set(cacheKey, { value, at: Date.now() });
      while (memory.size > 1200) memory.delete(memory.keys().next().value);
      return value;
    } catch (error) {
      console.warn('[release-date-lookup-failed]', JSON.stringify({ imdbId, error: error?.message || 'unknown error' }));
      return null;
    } finally {
      pending.delete(cacheKey);
    }
  })();
  pending.set(cacheKey, job);
  return job;
}
export async function upcomingReleaseByTmdbId(tmdbId, mediaType = 'tv', options = {}) {
  const id = String(tmdbId || '');
  if (!/^\d{1,12}$/.test(id) || !['movie', 'tv'].includes(mediaType)) return null;
  const today = options.today || getTodayInTimeZone(options.now || new Date());
  const credential = { apiKey: options.apiKey || process.env.TMDB_API_KEY || '', readToken: process.env.TMDB_API_READ_ACCESS_TOKEN || '' };
  if (!credential.apiKey && !credential.readToken) return null;
  const cacheKey = 'tmdb:' + mediaType + ':' + id + '|' + today;
  const cached = memory.get(cacheKey);
  if (cached && Date.now() - cached.at < (cached.value ? CACHE_MS : NEGATIVE_CACHE_MS)) return cached.value;
  if (pending.has(cacheKey)) return pending.get(cacheKey);
  const job = (async () => {
    try {
      let selected = null;
      if (mediaType === 'movie') {
        const releaseData = await tmdbJson('/movie/' + id + '/release_dates', credential);
        selected = chooseMovieDate(releaseData.results || [], today);
      } else {
        const details = await tmdbJson('/tv/' + id, credential);
        selected = chooseTvDate(details, today);
      }
      console.info('[release-date-resolution]', JSON.stringify({
        tmdbId: id,
        mediaType,
        selectedDate: selected?.date || null,
        selectedSource: selected?.source || null,
        region: selected?.region || null,
        dateInterpretation: 'TMDB calendar date; no timezone shift',
        comparisonTimeZone: RELEASE_DATE_TIME_ZONE,
        evaluationDate: today
      }));
      memory.set(cacheKey, { value: selected, at: Date.now() });
      while (memory.size > 1200) memory.delete(memory.keys().next().value);
      return selected;
    } catch (error) {
      console.warn('[release-date-lookup-failed]', JSON.stringify({ tmdbId: id, mediaType, error: error?.message || 'unknown error' }));
      return null;
    } finally {
      pending.delete(cacheKey);
    }
  })();
  pending.set(cacheKey, job);
  return job;
}

export function chooseMovieDateForTest(rows, today) {
  return chooseMovieDate(rows, today);
}
export function chooseTvDateForTest(details, today) {
  return chooseTvDate(details, today);
}
export function chooseTvScheduleDateForTest(details, episodes, today) {
  return chooseTvScheduleDate(details, episodes, today);
}
