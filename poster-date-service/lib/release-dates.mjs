const TMDB = 'https://api.themoviedb.org/3';
const memory = new Map();
const pending = new Map();
const CACHE_MS = 6 * 60 * 60 * 1000;
const NEGATIVE_CACHE_MS = 30 * 60 * 1000;

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
function chooseMovieDate(rows, today) {
  const all = digitalDates(rows);
  // Prefer India's digital date. If TMDB has no Indian digital listing at
  // all, a confirmed US/GB digital date may be used as a fallback.
  const india = all.filter(item => item.region === 'IN').sort((a, b) => a.date.localeCompare(b.date));
  const candidates = india.length ? india : all
    .filter(item => ['US', 'GB'].includes(item.region))
    .sort((a, b) => a.date.localeCompare(b.date));
  const future = candidates.find(item => isFuture(item.date, today));
  return future ? { ...future, source: 'tmdb-digital-release', kind: 'premiere' } : null;
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
async function resolveDate(imdbId, credential, today) {
  const found = await tmdbJson('/find/' + encodeURIComponent(imdbId), credential);
  const movie = found.movie_results?.[0];
  if (movie?.id) {
    const releaseData = await tmdbJson('/movie/' + movie.id + '/release_dates', credential);
    const selected = chooseMovieDate(releaseData.results || [], today);
    console.info('[release-date-resolution]', JSON.stringify({ imdbId, mediaType: 'movie', tmdbId: movie.id, selectedDate: selected?.date || null, selectedSource: selected?.source || null, region: selected?.region || null, dateInterpretation: 'TMDB calendar date; no timezone shift' }));
    return selected;
  }
  const show = found.tv_results?.[0];
  if (show?.id) {
    const details = await tmdbJson('/tv/' + show.id, credential);
    const selected = chooseTvDate(details, today);
    console.info('[release-date-resolution]', JSON.stringify({ imdbId, mediaType: 'tv', tmdbId: show.id, tmdbNextEpisodeAirDate: details.next_episode_to_air?.air_date || null, tmdbFirstAirDate: details.first_air_date || null, selectedDate: selected?.date || null, selectedSource: selected?.source || null, region: selected?.region || null, dateInterpretation: 'TMDB calendar date; no timezone shift' }));
    return selected;
  }
  return null;
}
export async function upcomingRelease(imdbId, options = {}) {
  if (!validImdbId(imdbId)) return null;
  const credential = { apiKey: options.apiKey || process.env.TMDB_API_KEY || '', readToken: process.env.TMDB_API_READ_ACCESS_TOKEN || '' };
  if (!credential.apiKey && !credential.readToken) return null;
  const today = options.today || new Date().toISOString().slice(0, 10);
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
export function chooseMovieDateForTest(rows, today) {
  return chooseMovieDate(rows, today);
}
export function chooseTvDateForTest(details, today) {
  return chooseTvDate(details, today);
}
