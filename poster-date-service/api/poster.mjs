import { upcomingRelease, hasPastDigitalRelease, validImdbId } from '../lib/release-dates.mjs';
import { renderUpcomingBadge, renderJustAddedBadge, removeExistingDateBadge } from '../lib/render-poster.mjs';
import { hasExistingComingDateTag, hasExistingJustAddedTag } from '../lib/coming-tag.mjs';
import { isCatalogRecentlyAdded } from '../lib/catalog-just-added.mjs';
import { upcomingReleaseFromCatalog } from '../lib/catalog-upcoming.mjs';
import { imageKitConfig, uploadPosterToImageKit, canStoreImageKitPoster, getImageKitStorageSnapshot, initializeImageKitStorageSnapshot, readPosterValidationMetadata, savePosterValidationMetadata } from '../lib/imagekit-storage.mjs';

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
const RESULT_CACHE_MS = 2 * 60 * 1000;
const resultCache = new Map();
const pendingResults = new Map();

export function sourceUrl(imdbId) {
  return BETTERPOSTERS + encodeURIComponent(imdbId) + '.jpg?rs=' + BETTERPOSTERS_RATING_SOURCE;
}

const IMAGEKIT_REFRESH_MS = 6 * 60 * 60 * 1000;
const pendingImageKitUploads = new Map();

function imageKitAssetUrl(config, imdbId) {
  return config.endpoint + '/posters/' + encodeURIComponent(imdbId) + '.jpg';
}

async function findFreshImageKitAsset(imdbId, releaseInfo, expectedJustAdded) {
  const config = imageKitConfig();
  if (!config) return null;
  const assetUrl = imageKitAssetUrl(config, imdbId);
  const checkUrl = new URL(assetUrl);
  checkUrl.searchParams.set('poster-cache-check', String(Math.floor(Date.now() / IMAGEKIT_REFRESH_MS)));
  try {
    const response = await fetch(checkUrl, {
      method: 'HEAD',
      cache: 'no-store',
      signal: AbortSignal.timeout(3000)
    });
    if (!response.ok) return null;
    const lastModified = Date.parse(response.headers.get('last-modified') || '');
    if (!Number.isFinite(lastModified)) return null;

    const expectedDate = releaseInfo?.date || null;
    const expectedKind = releaseInfo?.kind || 'premiere';

    // Treat a matching sidecar as durable validation, not a six-hour cache.
    // The sidecar is tied to this exact ImageKit asset by its upload timestamp
    // and current badge state. This is what prevents every daily refresh from
    // re-downloading and OCR-scanning thousands of already-correct posters.
    const metadata = await readPosterValidationMetadata(imdbId);
    const metadataTime = Date.parse(metadata?.uploadedAt || '');
    const metadataBelongsToAsset = metadata?.version === 2 &&
      metadata?.imdbId === imdbId &&
      Number.isFinite(metadataTime) &&
      Math.abs(metadataTime - lastModified) <= 5 * 60 * 1000;
    const metadataMatches = metadataBelongsToAsset &&
      (metadata.releaseDate || null) === expectedDate &&
      (!expectedDate || metadata.releaseKind === expectedKind) &&
      metadata.justAdded === Boolean(expectedJustAdded);
    if (metadataMatches) return assetUrl;
    if (metadataBelongsToAsset) {
      console.info('[poster-validation-sidecar-mismatch]', JSON.stringify({
        imdbId, expectedDate, cachedDate: metadata.releaseDate || null,
        expectedJustAdded: Boolean(expectedJustAdded), cachedJustAdded: metadata.justAdded,
        action: 'rebuild-poster'
      }));
      return null;
    }

    // Legacy assets without a sidecar are verified once using OCR regardless
    // of age, then receive a durable sidecar for future fast-path reuse.
    const imageResponse = await fetch(assetUrl, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000)
    });
    if (!imageResponse.ok) return null;
    const imageBytes = Buffer.from(await imageResponse.arrayBuffer());

    const hasDateBadge = expectedDate
      ? await hasExistingComingDateTag(imageBytes, expectedKind, expectedDate)
      : await hasExistingComingDateTag(imageBytes, 'any', null);
    const dateMatches = expectedDate ? hasDateBadge : !hasDateBadge;
    if (!dateMatches) {
      console.info('[poster-date-cache-mismatch]', JSON.stringify({
        imdbId, tmdbDate: expectedDate, cachedPoster: 'ImageKit',
        action: 'rebuild-from-BetterPosters'
      }));
      return null;
    }

    const hasJustAddedBadge = await hasExistingJustAddedTag(imageBytes);
    if (hasJustAddedBadge !== Boolean(expectedJustAdded)) {
      console.info('[poster-just-added-cache-mismatch]', JSON.stringify({
        imdbId, expectedJustAdded: Boolean(expectedJustAdded), cachedJustAdded: hasJustAddedBadge,
        action: 'rebuild-from-BetterPosters'
      }));
      return null;
    }

    await savePosterValidationMetadata(imdbId, {
      version: 1,
      imdbId,
      releaseDate: expectedDate,
      releaseKind: expectedDate ? expectedKind : null,
      justAdded: hasJustAddedBadge,
      digitalReleasedWorldwide: metadata?.digitalReleasedWorldwide === true,
      uploadedAt: new Date(lastModified).toISOString()
    }).catch(error => console.warn('[poster-validation-sidecar-save-failed]', JSON.stringify({
      imdbId, error: error?.message || 'unknown error'
    })));
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

function redirectToImageKit(res, assetUrl, releaseInfo, justAdded) {
  res.statusCode = 302;
  res.setHeader('Location', assetUrl);
  res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=300');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('X-Poster-Date-Status', 'imagekit-cache-hit');
  res.setHeader('X-Poster-Just-Added', justAdded ? 'true' : 'false');
  res.setHeader('X-Poster-Date', releaseInfo?.date || 'none');
  res.setHeader('X-Poster-Date-Type', releaseInfo?.kind || 'none');
  if (justAdded) res.setHeader('X-Poster-Badge', 'Just Added');
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

async function buildPoster(id, knownRelease = undefined, badge = '', fallbackUrl = '', digitalReleasedWorldwide = false) {
  const original = await getOriginal(id, fallbackUrl);

  // BetterPosters may already mark a title as Just Added. Normalize that tag
  // for every client using this shared URL. Catalogs can additionally force
  // the badge for titles they know were newly added.
  let shouldRenderJustAdded = badge === 'just-added';
  let justAddedSource = shouldRenderJustAdded ? 'catalog-flag' : null;
  if (!shouldRenderJustAdded) {
    try {
      const catalogResult = await isCatalogRecentlyAdded([id]);
      if (catalogResult === null) {
        // Only run OCR when the authoritative catalogue index is unavailable.
        // This preserves BetterPosters' baked-in Just Added tag without adding
        // an OCR pass to the normal, indexed bulk-refresh path.
        shouldRenderJustAdded = await hasExistingJustAddedTag(original.bytes);
        if (shouldRenderJustAdded) justAddedSource = 'betterposters-tag-fallback';
      } else {
        shouldRenderJustAdded = catalogResult;
        if (shouldRenderJustAdded) justAddedSource = 'catalog-index';
      }
    } catch (error) {
      console.warn('[catalog-just-added-lookup-failed]', JSON.stringify({ imdbId: id, error: error?.message || 'unknown error' }));
    }
  }
  // The catalogue's recent-add index is authoritative for whether to add
  // our Just Added overlay. Do not OCR every BetterPosters source when the
  // catalogue says false: any badge already baked into the source bytes remains
  // visible, while this avoids a costly Tesseract pass for nearly every title.

  const release = knownRelease === undefined ? await upcomingRelease(id) : knownRelease;
  // A Coming/New Episode date owns the badge slot. Any source or catalog
  // Just Added label is suppressed; renderUpcomingBadge replaces that same
  // top-tag area rather than stacking a second badge beneath it.
  if (release?.date) {
    if (shouldRenderJustAdded) console.info('[poster-badge-precedence]', JSON.stringify({ imdbId: id, source: justAddedSource, selected: 'coming-date' }));
    shouldRenderJustAdded = false;
    justAddedSource = null;
  }
  let output = original.bytes;
  let dateStatus = 'no-upcoming-release';
  let justAddedStatus = false;

  // Coming/New Episode takes precedence over Just Added. The date chip
  // replaces the source tag area, and no Just Added overlay is rendered.
  if (release?.date) {
    try {
      output = await renderUpcomingBadge(output, release.date, release.kind, 0.105);
      dateStatus = 'upcoming-date-overlay';
    } catch (error) {
      dateStatus = 'overlay-failed-original-preserved';
      console.warn('[poster-date-overlay-failed]', JSON.stringify({ imdbId: id, date: release.date, error: error?.message || 'unknown error' }));
    }
  } else {
    // If no confirmed future date remains, remove an obsolete Coming/New
    // Episode chip baked into provider artwork instead of preserving it.
    const staleDateBadge = await hasExistingComingDateTag(original.bytes, 'any', null);
    if (staleDateBadge) {
      const sourceJustAdded = await hasExistingJustAddedTag(original.bytes);
      output = await removeExistingDateBadge(output, 0.105);
      if (sourceJustAdded && !shouldRenderJustAdded) {
        shouldRenderJustAdded = true;
        justAddedSource = 'source-tag-preserved-after-stale-date-removal';
      }
      dateStatus = 'stale-source-date-removed';
      console.info('[poster-stale-date-badge-removed]', JSON.stringify({ imdbId: id, justAddedPreserved: shouldRenderJustAdded }));
    }
  }

  // Never stack a Just Added chip on a Coming/New Episode chip.
  if (shouldRenderJustAdded && !release?.date) {
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
    releaseKind: dateRendered ? (release.kind || 'none') : 'none',
    digitalReleasedWorldwide: digitalReleasedWorldwide === true
  };
}

async function getBuiltPoster(id, knownRelease = undefined, badge = '', version = '', fallbackUrl = '', digitalReleasedWorldwide = false) {
  const today = new Date().toISOString().slice(0, 10);
  const cacheKey = id + '|' + today + '|' + badge + '|' + version + '|' + fallbackUrl + '|released=' + (digitalReleasedWorldwide ? '1' : '0');
  const cached = resultCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (pendingResults.has(cacheKey)) return pendingResults.get(cacheKey);

  const pending = buildPoster(id, knownRelease, badge, fallbackUrl, digitalReleasedWorldwide).then(value => {
    resultCache.set(cacheKey, { value, expiresAt: Date.now() + RESULT_CACHE_MS });
    while (resultCache.size > 80) resultCache.delete(resultCache.keys().next().value);
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
    const catalogRelease = await upcomingReleaseFromCatalog([id]);
    // A durable per-title marker prevents later regional dates from reviving
    // Coming after a confirmed worldwide digital release, even if a provider
    // later removes or revises its historical release-date record.
    const validationMetadata = await readPosterValidationMetadata(id);
    const digitalAlreadyReleased = validationMetadata?.digitalReleasedWorldwide === true
      ? true : await hasPastDigitalRelease(id);
    if (digitalAlreadyReleased === true && validationMetadata?.digitalReleasedWorldwide !== true) {
      await savePosterValidationMetadata(id, {
        releaseDate: validationMetadata?.releaseDate || null,
        releaseKind: validationMetadata?.releaseKind || null,
        justAdded: validationMetadata?.justAdded === true,
        digitalReleasedWorldwide: true,
        uploadedAt: new Date().toISOString()
      }).catch(error => console.warn('[worldwide-digital-release-marker-save-failed]', JSON.stringify({ imdbId: id, error: error?.message || 'unknown error' })));
    }
    // The earliest confirmed digital date in any territory wins. Once one
    // territory has released it, skip all later TMDB/catalogue dates.
    const tmdbRelease = digitalAlreadyReleased === true ? null : await upcomingRelease(id);
    const releaseInfo = digitalAlreadyReleased === true ? null : tmdbRelease || catalogRelease;
    const version = String(req.query?.v || '');
    const fallbackUrl = String(req.query?.fallback || '');
    // Coming/New Episode always takes precedence over Just Added.
    let expectedJustAdded = !releaseInfo?.date && badge === 'just-added';
    if (!releaseInfo?.date && !expectedJustAdded) {
      try { expectedJustAdded = await isCatalogRecentlyAdded([id]); }
      catch (error) {
        console.warn('[catalog-just-added-lookup-failed]', JSON.stringify({ imdbId: id, error: error?.message || 'unknown error' }));
      }
    }

    // Reuse a recent ImageKit poster when its visible date badge is still
    // correct. This avoids repeatedly downloading, OCR-checking and uploading
    // every catalogue poster on each scheduled refresh or after a restart.
    const cachedAsset = await findFreshImageKitAsset(id, releaseInfo, expectedJustAdded);
    if (cachedAsset) return redirectToImageKit(res, cachedAsset, releaseInfo, expectedJustAdded);

    const poster = await getBuiltPoster(id, releaseInfo, badge, version, fallbackUrl, digitalAlreadyReleased === true);
    // Never make a user's poster response wait for an ImageKit account-wide
    // inventory scan. Restore the storage snapshot in the background; if it is
    // unavailable, serve the rendered poster and simply skip caching this hit.
    if (!getImageKitStorageSnapshot().known) {
      void initializeImageKitStorageSnapshot().catch(error =>
        console.warn('[imagekit-initial-snapshot-failed]', error?.message || 'unknown error')
      );
    }
    // Cache every successfully rendered poster, including Just Added and
    // unbadged BetterPosters originals, so a newly requested title is warmed.
    const canStore = canStoreImageKitPoster(id, poster.bytes.length);
    if (canStore) scheduleImageKitUpload(id, poster);
    setImageHeaders(res, poster.type, poster.status, poster.releaseDate, poster.releaseKind);
    res.setHeader('X-Poster-Source', poster.source || 'BetterPosters');
    res.setHeader('X-ImageKit-Storage', canStore ? 'pending' : 'not-stored');
    return res.end(poster.bytes);
  } catch (error) {
    // Preserve the client-side source fallback, but retain the actual failure
    // reason in service logs and response headers so the catalogue scanner can
    // distinguish provider outages from missing artwork during recovery.
    const reason = String(error?.message || 'poster processing failed').slice(0, 240);
    console.warn('[poster-source-fallback]', JSON.stringify({ imdbId: id, reason }));
    res.statusCode = 302;
    res.setHeader('Location', sourceUrl(id));
    res.setHeader('X-Poster-Fallback-Reason', reason);
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.end();
  }
}
