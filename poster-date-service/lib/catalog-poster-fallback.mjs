const CATALOG_POSTER_FALLBACK_HOSTS = new Set([
  'cinebuds.com', 'www.cinebuds.com', 'image.tmdb.org',
  'images.metahub.space', 'live.metahub.space', 'm.media-amazon.com',
  'assets.fanart.tv', 'static.tvmaze.com'
]);

export function validCatalogPosterFallback(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      CATALOG_POSTER_FALLBACK_HOSTS.has(url.hostname) &&
      /\.(?:jpe?g|png|webp|avif)$/i.test(url.pathname);
  } catch {
    return false;
  }
}
