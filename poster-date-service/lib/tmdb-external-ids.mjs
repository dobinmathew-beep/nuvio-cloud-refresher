const TMDB = 'https://api.themoviedb.org/3';
const cache = new Map();
const CACHE_MS = 6 * 60 * 60 * 1000;

// TMDB splits Top Boy into the original Summerhouse run and the Netflix
// continuation, but IMDb keeps the complete 2011–2023 run under one title.
const KNOWN_TV_IMDB_IDS = new Map([
  ['93544', 'tt1830379']
]);

function credentials() {
  return {
    apiKey: process.env.TMDB_API_KEY || '',
    readToken: process.env.TMDB_API_READ_ACCESS_TOKEN || ''
  };
}

export async function resolveTmdbTvImdbId(tmdbId, options = {}) {
  const id = String(tmdbId || '');
  if (!/^\d{1,12}$/.test(id)) throw new TypeError('A numeric TMDB TV ID is required.');

  // Use verified mappings before making any external request. This also
  // keeps known titles working when TMDB credentials or its API are unavailable.
  if (KNOWN_TV_IMDB_IDS.has(id)) return KNOWN_TV_IMDB_IDS.get(id);

  const cached = cache.get(id);
  if (!options.noCache && cached && cached.expiresAt > Date.now()) return cached.imdbId;

  const auth = options.credentials || credentials();
  if (!auth.apiKey && !auth.readToken) throw new Error('TMDB credentials are not configured.');

  const url = new URL(TMDB + '/tv/' + encodeURIComponent(id) + '/external_ids');
  const headers = { accept: 'application/json' };
  if (auth.readToken) headers.authorization = 'Bearer ' + auth.readToken;
  else url.searchParams.set('api_key', auth.apiKey);

  const response = await (options.fetch || fetch)(url, {
    headers,
    signal: AbortSignal.timeout(9000)
  });
  if (!response.ok) throw new Error('TMDB external ID lookup failed: ' + response.status);

  const data = await response.json();
  const imdbId = typeof data?.imdb_id === 'string' && /^tt\d{7,10}$/.test(data.imdb_id)
    ? data.imdb_id
    : null;

  cache.set(id, { imdbId, expiresAt: Date.now() + CACHE_MS });
  while (cache.size > 1000) cache.delete(cache.keys().next().value);
  return imdbId;
}
