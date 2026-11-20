import { upcomingRelease, validImdbId } from '../lib/release-dates.mjs';
import { renderUpcomingBadge, renderJustAddedBadge } from '../lib/render-poster.mjs';
import { hasExistingComingDateTag, hasExistingJustAddedTag } from '../lib/coming-tag.mjs';
import { isCatalogRecentlyAdded } from '../lib/catalog-just-added.mjs';
import { upcomingReleaseFromCatalog } from '../lib/catalog-upcoming.mjs';
import { imageKitConfig, uploadPosterToImageKit, canStoreImageKitPoster } from '../lib/imagekit-storage.mjs';

const BETTERPOSTERS = 'https://btttr.cc/poster/imdb/poster-default/';
const BETTERPOSTERS_RATING_SOURCE = 'IM';
const RPDB = 'https://api.ratingposterdb.com/t0-free-rpdb/imdb/poster-default/';
const METAHUB = 'https://live.metahub.space/poster/small/';
const MAX_BYTES = 15 * 1024 * 1024;
const CATALOG_POSTER_FALLBACK_HOSTS = new Set([
  'cinebuds.com', 'www.cinebuds.com', 'image.tmdb.org',
  'images.metahub.space', 'live.metahub.space', 'm.media-amazon.com',
  'assets.fanart.tv', 'static.tvmaze.com'
]);
function validCatalogPosterFallback(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      CATALOG_POSTER_FALLBACK_HOSTS.has(url.hostname) &&
      /\.(?:jpe?g|png|webp|avif)$/i.test(url.pathname);
  } catch {
    return false;
  }
}
const RESULT_CACHE_MS = 5 * 60 * 1000;
const resultCache = new Map();
const pendingResults = new Map();

export function sourceUrl(imdbId) {
  return BETTERPOSTERS + encodeURIComponent(imdbId) + '.jpg?rs=' + BETTERPOSTERS_RATING_SOURCE;
}

const IMAGEKIT_REFRESH_MS = 6 * 60 * 60 * 1000;
// Do not serve pre-change ImageKit files: they may contain the old generic or theatrical-date badge.
const IMAGEKIT_COMPATIBLE_AFTER = Date.now();
const pendingImageKitUploads = new Map();

function imageKitAssetUrl(config, imdbId) {
  return config.endpoint + '/posters/' + encodeURIComponent(imdbId) + '.jpg';
}

async function findFreshImageKitAsset(imdbId, releaseInfo) {
  const config = imageKitConfig();
  if (!config) return null;
  const assetUrl = imageKitAssetUrl(config, imdbId);
  const checkUrl = new URL(assetUrl);
  // A changing check key avoids trusting a stale edge-cached HEAD response.
  checkUrl.searchParams.set('poster-cache-check', String(Math.floor(Date.now() / IMAGEKIT_REFRESH_MS)));
  try {
    const response = await fetch(checkUrl, {
      method: 'HEAD',
      cache: 'no-store',
      signal: AbortSignal.timeout(3000)
    });
    if (!response.ok) return null;
    const lastModified = Date.parse(response.headers.get('last-modified') || '');
    if (!Number.isFinite(lastModified) || lastModified < IMAGEKIT_COMPATIBLE_AFTER) return null;
    if (Date.now() - lastModified > IMAGEKIT_REFRESH_MS) return null;
    // Verify the cached image's visible badge against the current TMDB date.
    // A fresh upload can still contain a stale date if TMDB rescheduled an episode.
    const imageResponse = await fetch(assetUrl, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    if (!imageResponse.ok) return null;
    const imageBytes = Buffer.from(await imageResponse.arrayBuffer());
    const matchesCurrentDate = await hasExistingComingDateTag(imageBytes, releaseInfo.kind, releaseInfo.date);
    if (!matchesCurrentDate) {
      console.info('[poster-date-cache-mismatch]', JSON.stringify({ imdbId, tmdbDate: releaseInfo.date, cachedPoster: 'ImageKit', action: 'rebuild-from-BetterPosters' }));
      return null;
    }
    return assetUrl;
  } catch {
    return null;
  }
}

function scheduleImageKitUpload(imdbId, poster) {
  if (!imageKitConfig()) return;
  if (pendingImageKitUploads.has(imdbId)) return;
  const job = uploadPosterToImageKit(imdbId, poster)
    .catch(error => console.warn('ImageKit poster upload skipped for', imdbId, error.message))
    .finally(() => pendingImageKitUploads.delete(imdbId));
  pendingImageKitUploads.set(imdbId, job);
}

function redirectToImageKit(res, assetUrl) {
  res.statusCode = 302;
  res.setHeader('Location', assetUrl);
  res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=300');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('X-Poster-Date-Status', 'imagekit-cache-hit');
  return res.end();
}

async function fetchPosterCandidate(imdbId, candidate) {
  const response = await fetch(candidate.url, {
    headers: { accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8' },
    redirect: 'follow',
    signal: AbortSignal.timeout(candidate.timeout)
  });
  const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!response.ok || !['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(type)) {
    throw new Error('HTTP ' + response.status + ' (' + type + ')');
  }
  if (Number(response.headers.get('content-length') || 0) > MAX_BYTES) throw new Error('Poster exceeds size limit');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_BYTES) throw new Error('Poster exceeds size limit');
  if (candidate.source !== 'BetterPosters') {
    console.warn('[poster-source-fallback]', JSON.stringify({ imdbId, source: candidate.source, primary: 'BetterPosters' }));
  }
  return { bytes, type, source: candidate.source };
}

async function getOriginal(imdbId, fallbackUrl = '') {
  const failures = [];
  const primary = { source: 'BetterPosters', url: sourceUrl(imdbId), timeout: 8000 };
  try {
    return await fetchPosterCandidate(imdbId, primary);
  } catch (error) {
    failures.push(primary.source + ': ' + (error?.message || 'request failed'));
  }

  // Prefer the catalog's own poster as the first fallback. It is already
  // known to be associated with this title and avoids slow provider chains.
  if (validCatalogPosterFallback(fallbackUrl)) {
    const catalog = { source: 'CatalogArtwork', url: fallbackUrl, timeout: 5000 };
    try {
      return await fetchPosterCandidate(imdbId, catalog);
    } catch (error) {
      failures.push(catalog.source + ': ' + (error?.message || 'request failed'));
    }
  }

  // RPDB and Metahub are independent fallbacks. Try them concurrently so a
  // slow/unavailable provider cannot add another full timeout to the request.
  const fallbacks = [
    { source: 'RPDB', url: RPDB + encodeURIComponent(imdbId) + '.jpg', timeout: 6000 },
    { source: 'Metahub', url: METAHUB + encodeURIComponent(imdbId) + '/img', timeout: 6000 }
  ];
  try {
    return await Promise.any(fallbacks.map(async candidate => {
      try {
        return await fetchPosterCandidate(imdbId, candidate);
      } catch (error) {
        failures.push(candidate.source + ': ' + (error?.message || 'request failed'));
        throw error;
      }
    }));
  } catch {
    throw new Error('No poster provider returned a usable image for ' + imdbId + ' (' + failures.join('; ') + ')');
  }
}

async function buildPoster(id, knownRelease = undefined, badge = '', fallbackUrl = '') {
  const original = await getOriginal(id, fallbackUrl);

  // BetterPosters may already mark a title as Just Added. Normalize that tag
  // for every client using this shared URL. Catalogs can additionally force
  // the badge for titles they know were newly added.
  let shouldRenderJustAdded = badge === 'just-added';
  let justAddedSource = shouldRenderJustAdded ? 'catalog-flag' : null;
  if (!shouldRenderJustAdded) {
    try {
      shouldRenderJustAdded = await isCatalogRecentlyAdded([id]);
      if (shouldRenderJustAdded) justAddedSource = 'catalog-index';
    } catch (error) {
      console.warn('[catalog-just-added-lookup-failed]', JSON.stringify({ imdbId: id, error: error?.message || 'unknown error' }));
    }
  }
  // Only BetterPosters artwork can contain a BetterPosters badge. Avoid
  // running OCR on RPDB, Metahub or catalog fallback artwork.
  if (!shouldRenderJustAdded && /betterposters/i.test(original.source || '')) {
    try {
      shouldRenderJustAdded = await hasExistingJustAddedTag(original.bytes);
      if (shouldRenderJustAdded) justAddedSource = 'betterposters-tag';
    } catch (error) {
      console.warn('[poster-just-added-detection-failed]', JSON.stringify({
        imdbId: id,
        error: error?.message || 'unknown error',
        action: 'continue-with-release-date-check'
      }));
    }
  }

  const release = knownRelease === undefined ? await upcomingRelease(id) : knownRelease;
  let output = original.bytes;
  let dateStatus = 'no-upcoming-release';
  let justAddedStatus = false;

  // Both labels can apply to one title. Stack them vertically so neither
  // overwrites the other: release date first, Just Added immediately below.
  if (release?.date) {
    try {
      output = await renderUpcomingBadge(output, release.date, release.kind, 0.105);
      dateStatus = 'upcoming-date-overlay';
    } catch (error) {
      dateStatus = 'overlay-failed-original-preserved';
      console.warn('[poster-date-overlay-failed]', JSON.stringify({ imdbId: id, date: release.date, error: error?.message || 'unknown error' }));
    }
  }

  if (shouldRenderJustAdded) {
    try {
      output = await renderJustAddedBadge(output, release?.date ? 0.255 : 0.105);
      justAddedStatus = true;
    } catch (error) {
      console.warn('[poster-just-added-overlay-failed]', JSON.stringify({ imdbId: id, error: error?.message || 'unknown error' }));
    }
  }

  const dateRendered = dateStatus === 'upcoming-date-overlay';
  const status = justAddedStatus && dateRendered
    ? 'upcoming-date+just-added-overlay'
    : justAddedStatus
      ? 'just-added-overlay'
      : dateRendered
        ? 'upcoming-date-overlay'
        : dateStatus;

  console.info('[poster-render-result]', JSON.stringify({
    imdbId: id,
    releaseDate: release?.date || null,
    releaseSource: release?.source || null,
    releaseKind: release?.kind || null,
    justAdded: justAddedStatus,
    justAddedSource: justAddedStatus ? justAddedSource : null,
    result: status
  }));

  return {
    bytes: output,
    type: original.type,
    source: original.source,
    status,
    releaseDate: dateRendered ? release.date : 'none',
    releaseKind: dateRendered ? (release.kind || 'none') : 'none'
  };
}

async function getBuiltPoster(id, knownRelease = undefined, badge = '', version = '', fallbackUrl = '') {
  const today = new Date().toISOString().slice(0, 10);
  const cacheKey = id + '|' + today + '|' + badge + '|' + version + '|' + fallbackUrl;
  const cached = resultCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (pendingResults.has(cacheKey)) return pendingResults.get(cacheKey);

  const pending = buildPoster(id, knownRelease, badge, fallbackUrl).then(value => {
    resultCache.set(cacheKey, { value, expiresAt: Date.now() + RESULT_CACHE_MS });
    while (resultCache.size > 500) resultCache.delete(resultCache.keys().next().value);
    return value;
  }).finally(() => pendingResults.delete(cacheKey));

  pendingResults.set(cacheKey, pending);
  return pending;
}

function setImageHeaders(res, type, status, releaseDate, releaseKind = 'none') {
  res.statusCode = 200;
  res.setHeader('Content-Type', type);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Poster-Date-Status', status);
  const justAddedRendered = status === 'just-added-overlay' || status === 'upcoming-date+just-added-overlay';
  res.setHeader('X-Poster-Just-Added', justAddedRendered ? 'true' : 'false');
  res.setHeader('X-Poster-Date', releaseDate);
  res.setHeader('X-Poster-Date-Type', releaseKind);
  if (justAddedRendered) res.setHeader('X-Poster-Badge', 'Just Added');
  // Let Xperience/CDNs reuse the processed result; the in-process cache
  // remains a secondary optimisation, not the only cache.
  res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=300');
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    return res.end();
  }
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, HEAD, OPTIONS');
    return res.end('Method not allowed');
  }
  const id = String(req.query?.id || new URL(req.url, 'https://service.invalid').searchParams.get('id') || '');
  if (!validImdbId(id)) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.end('A valid IMDb ID is required.');
  }

  try {
    if (req.probe || req.method === 'HEAD') {
      const original = await getOriginal(id);
      setImageHeaders(res, original.type, req.probe ? 'template-probe' : 'head-check', 'none');
      res.setHeader('X-Poster-Source', original.source || 'BetterPosters');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.end(req.method === 'HEAD' ? undefined : original.bytes);
    }

    // An ImageKit copy is valid only while TMDB still confirms a future release.
    // This prevents a cached date badge from surviving its release day.
    const badge = String(req.query?.badge || '').toLowerCase() === 'just-added' ? 'just-added' : '';
    const releaseInfo = await upcomingReleaseFromCatalog([id]) || await upcomingRelease(id);
    // Always render through this service; cached ImageKit copies can omit a
    // provider-supplied Just Added label and therefore bypass normalization.

    const version = String(req.query?.v || '');
    const fallbackUrl = String(req.query?.fallback || '');
    const poster = await getBuiltPoster(id, releaseInfo, badge, version, fallbackUrl);
    // Cache every successfully rendered poster, including Just Added and
    // unbadged BetterPosters originals, so a newly requested title is warmed.
    const canStore = canStoreImageKitPoster(id, poster.bytes.length);
    if (canStore) scheduleImageKitUpload(id, poster);
    setImageHeaders(res, poster.type, poster.status, poster.releaseDate, poster.releaseKind);
    res.setHeader('X-Poster-Source', poster.source || 'BetterPosters');
    res.setHeader('X-ImageKit-Storage', canStore ? 'pending' : 'not-stored');
    return res.end(poster.bytes);
  } catch {
    // Never replace a working BetterPosters poster with a text/JSON error page.
    // If our proxy cannot retrieve/process the image, let the client fetch the
    // original provider URL directly. The date badge is skipped for this request.
    res.statusCode = 302;
    res.setHeader('Location', sourceUrl(id));
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.end();
  }
}
