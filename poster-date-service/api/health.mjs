export default function handler(_req, res) {
  const configured = Boolean(process.env.TMDB_API_KEY || process.env.TMDB_API_READ_ACCESS_TOKEN);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.statusCode = configured ? 200 : 503;
  res.end(JSON.stringify({
    service: 'Great Indian Upcoming Poster Service',
    status: configured ? 'ready' : 'waiting-for-tmdb-api-key',
    posterSource: 'BetterPosters',
    releaseDateSource: 'TMDB',
    tmdbConfigured: configured,
    acceptedCredentials: ['TMDB_API_KEY', 'TMDB_API_READ_ACCESS_TOKEN'],
    badge: 'REL: MON DD',
    failSafe: 'If no confirmed future date is found, the original BetterPosters image is returned unchanged.'
  }));
}
