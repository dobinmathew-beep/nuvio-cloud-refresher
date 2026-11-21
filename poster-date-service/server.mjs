import { createServer } from 'node:http';
import { timingSafeEqual, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import posterHandler from './api/poster.mjs';
import { validCatalogPosterFallback } from './lib/catalog-poster-fallback.mjs';
import healthHandler from './api/health.mjs';
import { resolveTmdbExternalImdbId } from './lib/tmdb-external-ids.mjs';
import { renderJustAddedBadge, renderUpcomingBadge, removeExistingDateBadge } from './lib/render-poster.mjs';
import { upcomingReleaseByTmdbId, hasPastDigitalReleaseByTmdbId, getTodayInTimeZone } from './lib/release-dates.mjs';
import { isCatalogRecentlyAdded } from './lib/catalog-just-added.mjs';
import { upcomingReleaseFromCatalog } from './lib/catalog-upcoming.mjs';

import { imageKitConfig, canStoreImageKitPoster, getImageKitStorageSnapshot, uploadPosterToImageKit, runImageKitMaintenance, initializeImageKitStorageSnapshot } from './lib/imagekit-storage.mjs';
import { runManifestCatalogRefresh, resumeIncompleteManifestCatalogRefresh, getManifestCatalogRefreshProgress, getManifestCatalogRefreshDiagnostics } from './lib/catalog-manifest-refresh.mjs';
import { getRefreshLease, getRefreshProgress } from './lib/refresh-coordination.mjs';
import { hasExistingComingDateTag, hasExistingJustAddedTag } from './lib/coming-tag.mjs';

let catalogRefreshJob = null;
let catalogRefreshReport = null;
let catalogRefreshError = null;
let catalogRefreshTask = null;
let shuttingDown = false;

function authorizedCatalogRequest(req) {
  const expected = String(process.env.POSTER_CATALOG_SCAN_TOKEN || '');
  const supplied = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

const port = Number(process.env.PORT || 10000);
const publicIndex = resolve(process.cwd(), 'public/index.html');

function responseAdapter(res) {
  return {
    get statusCode() { return res.statusCode; },
    set statusCode(value) { res.statusCode = value; },
    setHeader(name, value) { res.setHeader(name, value); },
    end(body) { res.end(body); }
  };
}

function fallbackImageKitId(prefix, id) {
  return prefix + '-' + String(id);
}

async function redirectCachedFallback(storageId, req, res, releaseInfo, justAdded) {
  const config = imageKitConfig();
  if (!config) return false;
  const assetUrl = config.endpoint + '/posters/' + encodeURIComponent(storageId) + '.jpg';
  try {
    const response = await fetch(assetUrl, { method: 'HEAD', cache: 'no-store', signal: AbortSignal.timeout(3000) });
    if (!response.ok) return false;
    const updatedAt = Date.parse(response.headers.get('last-modified') || '');
    if (!Number.isFinite(updatedAt) || Date.now() - updatedAt > 6 * 60 * 60 * 1000) return false;

    const imageResponse = await fetch(assetUrl, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    if (!imageResponse.ok) return false;
    const bytes = Buffer.from(await imageResponse.arrayBuffer());
    const hasDateBadge = releaseInfo?.date
      ? await hasExistingComingDateTag(bytes, releaseInfo.kind || 'premiere', releaseInfo.date)
      : await hasExistingComingDateTag(bytes, 'any', null);
    const dateMatches = releaseInfo?.date ? hasDateBadge : !hasDateBadge;
    const justAddedMatches = (await hasExistingJustAddedTag(bytes)) === Boolean(justAdded);
    if (!dateMatches || !justAddedMatches) return false;

    res.statusCode = 302;
    res.setHeader('Location', assetUrl);
    res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=300');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Poster-Date-Status', 'imagekit-cache-hit');
    res.setHeader('X-Poster-Just-Added', justAdded ? 'true' : 'false');
    res.setHeader('X-Poster-Date', releaseInfo?.date || 'none');
    res.setHeader('X-Poster-Date-Type', releaseInfo?.kind || 'none');
    res.setHeader('X-ImageKit-Storage', 'hit');
    if (justAdded) res.setHeader('X-Poster-Badge', 'Just Added');
    return res.end();
  } catch {
    return false;
  }
}

async function cacheFallbackPoster(storageId, bytes, type) {
  try {
    if (!getImageKitStorageSnapshot().known) {
      // Do not delay fallback artwork while ImageKit is unavailable.
      void initializeImageKitStorageSnapshot().catch(error =>
        console.warn('[imagekit-fallback-storage-unavailable]', error?.message || 'unknown error')
      );
      return false;
    }
    if (!canStoreImageKitPoster(storageId, bytes.length)) return false;
    void uploadPosterToImageKit(storageId, { bytes, type })
      .catch(error => console.warn('[imagekit-fallback-upload-failed]', JSON.stringify({ storageId, error: error?.message || 'unknown error' })));
    return true;
  } catch (error) {
    console.warn('[imagekit-fallback-storage-unavailable]', JSON.stringify({ storageId, error: error?.message || 'unknown error' }));
    return false;
  }
}

async function sendTmdbPosterFallback(tmdbId, mediaType, req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    return res.end();
  }

  const sources = [];
  // TMDB-only catalogues often already provide a title-specific poster URL.
  // The IMDb handler honours this fallback, so the TMDB-ID handler must too.
  const catalogFallbackUrl = String(req.query?.fallback || '');
  if (validCatalogPosterFallback(catalogFallbackUrl)) {
    try {
      const imageResponse = await fetch(catalogFallbackUrl, {
        headers: { accept: 'image/avif,image/webp,image/jpeg,image/png,*/*' },
        redirect: 'follow',
        signal: AbortSignal.timeout(5000)
      });
      const type = (imageResponse.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      const contentLength = Number(imageResponse.headers.get('content-length') || 0);
      if (!imageResponse.ok || !['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(type) ||
          contentLength > 15 * 1024 * 1024) {
        await imageResponse.body?.cancel().catch(() => {});
        throw new Error('Catalog artwork HTTP ' + imageResponse.status + ' (' + type + ')');
      }
      const bytes = Buffer.from(await imageResponse.arrayBuffer());
      if (!bytes.length || bytes.length > 15 * 1024 * 1024) throw new Error('Catalog artwork exceeds size limit');
      sources.push({ source: 'CatalogArtwork', bytes, type });
    } catch (error) {
      console.warn('[tmdb-poster-source-fallback]', JSON.stringify({
        tmdbId, failedSource: 'CatalogArtwork', error: error?.message || 'unknown error'
      }));
    }
  }

  const apiKey = process.env.TMDB_API_KEY || '';
  const readToken = process.env.TMDB_API_READ_ACCESS_TOKEN || '';
  if (!sources.length && (apiKey || readToken)) {
    try {
      const detailsUrl = new URL('https://api.themoviedb.org/3/' + mediaType + '/' + encodeURIComponent(tmdbId));
      const headers = { accept: 'application/json' };
      if (readToken) headers.authorization = 'Bearer ' + readToken;
      else detailsUrl.searchParams.set('api_key', apiKey);
      const detailsResponse = await fetch(detailsUrl, { headers, signal: AbortSignal.timeout(9000) });
      if (!detailsResponse.ok) throw new Error('TMDB details HTTP ' + detailsResponse.status);
      const details = await detailsResponse.json();
      if (!details.poster_path) throw new Error('TMDB title has no poster image');
      const imageResponse = await fetch('https://image.tmdb.org/t/p/w780' + details.poster_path, {
        headers: { accept: 'image/avif,image/webp,image/jpeg,image/png,*/*' },
        signal: AbortSignal.timeout(10000)
      });
      const type = (imageResponse.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!imageResponse.ok || !['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(type)) {
        throw new Error('TMDB image HTTP ' + imageResponse.status);
      }
      const bytes = Buffer.from(await imageResponse.arrayBuffer());
      if (!bytes.length || bytes.length > 15 * 1024 * 1024) throw new Error('TMDB poster exceeds size limit');
      sources.push({ source: 'TMDB', bytes, type });
    } catch (error) {
      console.warn('[tmdb-poster-source-fallback]', JSON.stringify({ tmdbId, failedSource: 'TMDB', error: error?.message || 'unknown error' }));
    }
  }

  if (!sources.length) {
    try {
      const response = await fetch('https://api.ratingposterdb.com/t0-free-rpdb/tmdb/poster-default/' + encodeURIComponent(tmdbId) + '.jpg', {
        headers: { accept: 'image/avif,image/webp,image/jpeg,image/png,*/*' },
        signal: AbortSignal.timeout(8000)
      });
      const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!response.ok || !['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(type)) {
        throw new Error('RPDB TMDB poster HTTP ' + response.status);
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length || bytes.length > 15 * 1024 * 1024) throw new Error('RPDB poster exceeds size limit');
      sources.push({ source: 'RPDB', bytes, type });
    } catch (error) {
      console.warn('[tmdb-poster-source-fallback]', JSON.stringify({ tmdbId, failedSource: 'RPDB', error: error?.message || 'unknown error' }));
    }
  }

  if (!sources.length) throw new Error('No poster source available for TMDB ID ' + tmdbId);
  const original = sources[0];
  const catalogRelease = await upcomingReleaseFromCatalog(['tmdb:' + tmdbId]);
  const digitalAlreadyReleased = mediaType === 'movie'
    ? await hasPastDigitalReleaseByTmdbId(tmdbId)
    : false;
  const tmdbRelease = await upcomingReleaseByTmdbId(tmdbId, mediaType);
  const release = digitalAlreadyReleased === true
    ? null
    : mediaType === 'movie' ? tmdbRelease || catalogRelease : catalogRelease || tmdbRelease;
  let output = original.bytes;
  let dateRendered = false;
  let justAdded = !release?.date && String(req.query?.badge || '').toLowerCase() === 'just-added';
  if (!release?.date && !justAdded) {
    try { justAdded = await isCatalogRecentlyAdded(['tmdb:' + tmdbId]); }
    catch (error) { console.warn('[catalog-just-added-lookup-failed]', JSON.stringify({ tmdbId, error: error?.message || 'unknown error' })); }
  }
  // TMDB/RPDB artwork cannot carry a BetterPosters tag; use catalog eligibility only.
  const storageId = fallbackImageKitId('tmdb', tmdbId);
  if (await redirectCachedFallback(storageId, req, res, release, justAdded)) return;

  if (release?.date) {
    try {
      output = await renderUpcomingBadge(output, release.date, release.kind, 0.105);
      dateRendered = true;
    } catch (error) {
      console.warn('[poster-date-overlay-failed]', JSON.stringify({ tmdbId, date: release.date, error: error?.message || 'unknown error' }));
    }
  } else if (await hasExistingComingDateTag(original.bytes, 'any', null)) {
    output = await removeExistingDateBadge(output, 0.105);
    console.info('[poster-stale-date-badge-removed]', JSON.stringify({ tmdbId, source: 'fallback-artwork' }));
  }
  if (justAdded && !release?.date) {
    try { output = await renderJustAddedBadge(output, 0.105); }
    catch (error) {
      console.warn('[poster-just-added-overlay-failed]', JSON.stringify({ tmdbId, error: error?.message || 'unknown error' }));
      justAdded = false;
    }
  }

  const status = dateRendered && justAdded ? 'upcoming-date+just-added-overlay'
    : dateRendered ? 'upcoming-date-overlay'
    : justAdded ? 'just-added-overlay'
    : 'no-upcoming-release';
  res.statusCode = 200;
  res.setHeader('Content-Type', original.type);
  res.setHeader('X-Poster-Source', original.source);
  res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=300');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Poster-Date-Status', status);
  res.setHeader('X-Poster-Just-Added', justAdded ? 'true' : 'false');
  res.setHeader('X-Poster-Date', dateRendered ? release.date : 'none');
  res.setHeader('X-Poster-Date-Type', dateRendered ? (release.kind || 'none') : 'none');
  if (justAdded) res.setHeader('X-Poster-Badge', 'Just Added');
  const stored = req.method === 'HEAD' ? false : await cacheFallbackPoster(storageId, output, original.type);
  res.setHeader('X-ImageKit-Storage', stored ? 'pending' : 'not-stored');
  return res.end(req.method === 'HEAD' ? undefined : output);
}

async function sendTvmazePosterFallback(tvmazeId, req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    return res.end();
  }
  const showResponse = await fetch('https://api.tvmaze.com/shows/' + encodeURIComponent(tvmazeId) + '?embed=episodes', {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(8000)
  });
  if (!showResponse.ok) throw new Error('TVmaze show HTTP ' + showResponse.status);
  const show = await showResponse.json();
  const imageUrl = show?.image?.original || show?.image?.medium;
  if (!imageUrl) throw new Error('TVmaze show has no poster image');
  const imageResponse = await fetch(imageUrl, {
    headers: { accept: 'image/avif,image/webp,image/jpeg,image/png,*/*' },
    signal: AbortSignal.timeout(10000)
  });
  const type = (imageResponse.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!imageResponse.ok || !['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(type)) {
    throw new Error('TVmaze poster HTTP ' + imageResponse.status);
  }
  const original = Buffer.from(await imageResponse.arrayBuffer());
  if (!original.length || original.length > 15 * 1024 * 1024) throw new Error('TVmaze poster exceeds size limit');

  const today = getTodayInTimeZone();
  const episodes = show?._embedded?.episodes || [];
  const nextEpisode = episodes
    .filter(episode => /^\d{4}-\d{2}-\d{2}$/.test(String(episode?.airdate || '')) && episode.airdate > today)
    .sort((a, b) => a.airdate.localeCompare(b.airdate))[0];
  const premiere = /^\d{4}-\d{2}-\d{2}$/.test(String(show?.premiered || '')) && show.premiered > today
    ? show.premiered : null;
  const release = await upcomingReleaseFromCatalog(['tvmaze:' + tvmazeId]) || (nextEpisode
    ? { date: nextEpisode.airdate, kind: 'episode', source: 'tvmaze-next-episode' }
    : premiere ? { date: premiere, kind: 'premiere', source: 'tvmaze-series-premiere' } : null);

  let output = original;
  let dateRendered = false;
  let justAdded = !release?.date && String(req.query?.badge || '').toLowerCase() === 'just-added';
  if (!release?.date && !justAdded) {
    try { justAdded = await isCatalogRecentlyAdded(['tvmaze:' + tvmazeId]); }
    catch (error) { console.warn('[catalog-just-added-lookup-failed]', JSON.stringify({ tvmazeId, error: error?.message || 'unknown error' })); }
  }
  // TVmaze artwork cannot carry a BetterPosters tag; use catalog eligibility only.
  const storageId = fallbackImageKitId('tvmaze', tvmazeId);
  if (await redirectCachedFallback(storageId, req, res, release, justAdded)) return;
  if (release?.date) {
    try {
      output = await renderUpcomingBadge(output, release.date, release.kind, 0.105);
      dateRendered = true;
    } catch (error) {
      console.warn('[poster-date-overlay-failed]', JSON.stringify({ tvmazeId, date: release.date, error: error?.message || 'unknown error' }));
    }
  }
  else if (await hasExistingComingDateTag(original, 'any', null)) {
    output = await removeExistingDateBadge(output, 0.105);
    console.info('[poster-stale-date-badge-removed]', JSON.stringify({ tvmazeId, source: 'fallback-artwork' }));
  }
  if (justAdded && !release?.date) {
    try { output = await renderJustAddedBadge(output, 0.105); }
    catch (error) {
      console.warn('[poster-just-added-overlay-failed]', JSON.stringify({ tvmazeId, error: error?.message || 'unknown error' }));
      justAdded = false;
    }
  }
  const status = dateRendered && justAdded ? 'upcoming-date+just-added-overlay'
    : dateRendered ? 'upcoming-date-overlay'
    : justAdded ? 'just-added-overlay'
    : 'no-upcoming-release';
  res.statusCode = 200;
  res.setHeader('Content-Type', type);
  res.setHeader('X-Poster-Source', 'TVmaze');
  res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=300');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Poster-Date-Status', status);
  res.setHeader('X-Poster-Just-Added', justAdded ? 'true' : 'false');
  res.setHeader('X-Poster-Date', dateRendered ? release.date : 'none');
  res.setHeader('X-Poster-Date-Type', dateRendered ? release.kind : 'none');
  if (justAdded) res.setHeader('X-Poster-Badge', 'Just Added');
  const stored = req.method === 'HEAD' ? false : await cacheFallbackPoster(storageId, output, type);
  res.setHeader('X-ImageKit-Storage', stored ? 'pending' : 'not-stored');
  return res.end(req.method === 'HEAD' ? undefined : output);
}


const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  const adaptedReq = { method: req.method, url: req.url, query: Object.fromEntries(url.searchParams) };
  const adaptedRes = responseAdapter(res);

  if (url.pathname === '/' && req.method === 'GET') {
    try {
      const html = await readFile(publicIndex);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      return res.end(html);
    } catch {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Service homepage unavailable');
    }
  }

  if (url.pathname === '/health') return healthHandler(adaptedReq, adaptedRes);

  // Authenticated manifest refresh. The request starts a background job so
  // large catalogues do not exceed the web request timeout.
  if (url.pathname === '/catalog-refresh' || url.pathname === '/catalog-refresh/status' || url.pathname === '/catalog-refresh/diagnostics') {
    if (!authorizedCatalogRequest(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ error: 'Unauthorized' }));
    }
    if (url.pathname === '/catalog-refresh/diagnostics') {
      if (req.method !== 'GET') {
        res.writeHead(405, { 'Allow': 'GET', 'Cache-Control': 'no-store' });
        return res.end('Method not allowed');
      }
      try {
        const [diagnostics, lease] = await Promise.all([getManifestCatalogRefreshDiagnostics(), getRefreshLease()]);
        const progress = lease ? await getRefreshProgress(lease.jobId) : getManifestCatalogRefreshProgress();
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify({
          ...diagnostics,
          lease: lease ? { active: true, jobId: lease.jobId, startedAt: lease.startedAt || null } : { active: false },
          progress
        }));
      } catch (error) {
        res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify({ error: error?.message || 'Could not read catalogue diagnostics' }));
      }
    }
    if (url.pathname === '/catalog-refresh/status') {
      // Operator pause is authoritative: report a terminal state so the
      // external GitHub waiter exits instead of re-POSTing and restarting work.
      if (process.env.CATALOG_REFRESH_AUTOSTART === 'false') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify({ status: 'failed', error: 'Catalogue refresh paused by operator; saved checkpoints are preserved.' }));
      }
      let sharedLease;
      try {
        sharedLease = await getRefreshLease();
      } catch (error) {
        res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify({ status: 'coordination-unavailable', error: error?.message || 'Redis unavailable' }));
      }
      const localProgress = getManifestCatalogRefreshProgress();
      const progress = sharedLease
        ? await getRefreshProgress(sharedLease.jobId) ||
          (localProgress?.jobId === sharedLease.jobId ? localProgress : null)
        : localProgress;
      const response = sharedLease
        ? { status: 'running', jobId: sharedLease.jobId, coordinated: true, progress, progressState: progress ? 'available' : 'waiting-for-owner-progress' }
        : catalogRefreshJob && catalogRefreshReport?.status !== 'already-running'
          ? { status: 'running', jobId: catalogRefreshJob, progress }
          : catalogRefreshError
            ? { status: 'failed', error: catalogRefreshError, progress }
            : catalogRefreshReport && catalogRefreshReport.status !== 'already-running'
              ? { status: 'completed', report: catalogRefreshReport, progress }
              : { status: 'idle', progress };
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(response));
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Allow': 'POST', 'Cache-Control': 'no-store' });
      return res.end('Method not allowed');
    }
    if (shuttingDown) {
      res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ status: 'shutting-down', error: 'Service is draining; retry after restart.' }));
    }
    // Do not allow scheduled GitHub waiters to restart a refresh while the
    // operator pause flag is active.
    if (process.env.CATALOG_REFRESH_AUTOSTART === 'false') {
      res.writeHead(423, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ status: 'paused', error: 'Catalogue refresh is paused; checkpoints are preserved.' }));
    }
    let sharedLease;
    try {
      sharedLease = await getRefreshLease();
    } catch (error) {
      res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ status: 'coordination-unavailable', error: error?.message || 'Redis unavailable' }));
    }
    if (catalogRefreshJob || sharedLease) {
      res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ status: 'already-running', jobId: sharedLease?.jobId || catalogRefreshJob }));
    }
    const jobId = randomUUID();
    catalogRefreshJob = jobId;
    catalogRefreshError = null;
    catalogRefreshReport = null;
    res.writeHead(202, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ status: 'accepted', jobId }));
    const manualTask = (async () => {
      try {
        // Storage accounting is best-effort. Never prevent the catalogue job
        // from starting because ImageKit's snapshot endpoint is temporarily slow.
        void initializeImageKitStorageSnapshot().catch(error =>
          console.warn('[imagekit-refresh-snapshot-unavailable]', error?.message || 'unknown error')
        );
        catalogRefreshReport = await runManifestCatalogRefresh({
          forceReprocess: url.searchParams.get('force') === '1'
        });
        console.log('[catalog-refresh-job-complete]', JSON.stringify({ jobId, status: 'completed' }));
      } catch (error) {
        catalogRefreshError = error?.message || 'Catalogue refresh failed';
        console.error('[catalog-refresh-job-failed]', JSON.stringify({ jobId, error: catalogRefreshError }));
      } finally {
        catalogRefreshJob = null;
      }
    })();
    catalogRefreshTask = manualTask;
    void manualTask.finally(() => {
      if (catalogRefreshTask === manualTask) catalogRefreshTask = null;
    });
    return;
  }

  // Safe, fixed maintenance action: no user-supplied IDs or paths are accepted.
  // A six-hour in-process cooldown prevents repeated public triggering.
  if (url.pathname === '/maintenance') {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Allow': 'POST', 'Cache-Control': 'no-store' });
      return res.end('Method not allowed');
    }
    try {
      const report = await runImageKitMaintenance();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(report));
    } catch (error) {
      console.error('ImageKit maintenance failed:', error.message);
      res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ status: 'maintenance-failed', error: error.message }));
    }
  }

  // Xperience may probe the literal template before substituting an IMDb ID.
  // Serve a real, stable BetterPosters sample image for that one validation request.
  const templateProbe = /^\/poster\/(?:\{imdb_id\}|%7Bimdb_id%7D)\.jpg$/i.test(url.pathname);
  const posterMatch = url.pathname.match(/^\/poster\/(tt\d{7,10})\.jpg$/i);
  if (templateProbe || posterMatch) {
    adaptedReq.query.id = templateProbe ? 'tt0111161' : posterMatch[1];
    adaptedReq.probe = templateProbe;
    return await posterHandler(adaptedReq, adaptedRes);
  }

  // TMDB-only movie and series records can use /poster/tmdb/{tmdb_id}.jpg.
  // Resolve the matching IMDb external ID, then reuse the BetterPosters pipeline.
  const tmdbPosterMatch = url.pathname.match(/^\/poster\/tmdb(?:\/|:|%3A)(\d{1,12})\.jpg$/i);
  if (tmdbPosterMatch) {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      res.writeHead(405, { 'Allow': 'GET, HEAD, OPTIONS', 'Cache-Control': 'no-store' });
      return res.end('Method not allowed');
    }
    try {
      const mediaType = String(url.searchParams.get('type') || 'tv').toLowerCase() === 'movie' ? 'movie' : 'tv';
      const imdbId = await resolveTmdbExternalImdbId(tmdbPosterMatch[1], mediaType);
      if (!imdbId) {
        return await sendTmdbPosterFallback(tmdbPosterMatch[1], mediaType, adaptedReq, adaptedRes);
      }
      adaptedReq.query.id = imdbId;
      return await posterHandler(adaptedReq, adaptedRes);
    } catch (error) {
      console.warn('[tmdb-poster-id-resolution-failed]', JSON.stringify({ tmdbId: tmdbPosterMatch[1], mediaType: String(url.searchParams.get('type') || 'tv'), error: error?.message || 'unknown error' }));
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end('Could not resolve the TMDB series to an IMDb ID.');
    }
  }

  // TVmaze-only catalog IDs are resolved to their IMDb external ID so
  // they can use the exact same release-date and poster rendering pipeline.
  const tvmazePosterMatch = url.pathname.match(/^\/poster\/tvmaze\/(\d{1,12})\.jpg$/i);
  if (tvmazePosterMatch) {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      res.writeHead(405, { 'Allow': 'GET, HEAD, OPTIONS', 'Cache-Control': 'no-store' });
      return res.end('Method not allowed');
    }
    try {
      const showResponse = await fetch('https://api.tvmaze.com/shows/' + encodeURIComponent(tvmazePosterMatch[1]), {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(7000)
      });
      if (!showResponse.ok) throw new Error('TVmaze show HTTP ' + showResponse.status);
      const show = await showResponse.json();
      const imdbId = String(show?.externals?.imdb || '');
      if (!/^tt\d{7,10}$/.test(imdbId)) {
        return await sendTvmazePosterFallback(tvmazePosterMatch[1], req, res);
      }
      adaptedReq.query.id = imdbId;
      return await posterHandler(adaptedReq, adaptedRes);
    } catch (error) {
      console.warn('[tvmaze-poster-id-resolution-failed]', JSON.stringify({ tvmazeId: tvmazePosterMatch[1], error: error?.message || 'unknown error' }));
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end('Could not resolve the TVmaze series to an IMDb ID.');
    }
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end('Not found');
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Great Indian Upcoming Poster Service listening on port ${port}`);
  // Resume only an interrupted checkpoint after a deploy/restart.
  // Never force a full revalidation from startup: it defeats the durable ledger fast path.
  if (process.env.CATALOG_REFRESH_AUTOSTART !== 'false') {
    const jobId = randomUUID();
    catalogRefreshJob = jobId;
    catalogRefreshError = null;
    catalogRefreshReport = null;
    setImmediate(() => {
      if (shuttingDown) return;
      const startupRefresh = (async () => {
        let report;
        // A rolling deploy can start the new process before the previous
        // process's Redis lease expires. Do not mistake "already-running" for
        // a completed refresh: wait for the stale lease TTL, then resume from
        // the durable ImageKit checkpoint.
        const maxAttempts = 50;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          // Poll Redis first: do not repeatedly download the ImageKit checkpoint
          // while the previous instance still owns the refresh lease.
          const existingLease = await getRefreshLease();
          if (existingLease) {
            if (attempt === 1 || attempt % 5 === 0) {
              console.warn('[catalog-refresh-autoresume-waiting-for-lease]', JSON.stringify({
                jobId, attempt, retryAfterMs: 3000, existingJobId: existingLease.jobId || null
              }));
            }
            await new Promise(resolve => setTimeout(resolve, 3000));
            continue;
          }
          report = await resumeIncompleteManifestCatalogRefresh();
          if (report?.status !== 'already-running') return report;
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
        console.error('[catalog-refresh-autoresume-lease-timeout]', JSON.stringify({ jobId, maxAttempts }));
        return report;
      })();
      catalogRefreshTask = startupRefresh;
      void startupRefresh
        .then(report => {
          catalogRefreshReport = report;
          console.log('[catalog-refresh-autoresume-complete]', JSON.stringify({ jobId, status: report?.status || 'completed' }));
        })
        .catch(error => {
          catalogRefreshError = error?.message || 'Catalogue refresh autoresume failed';
          console.error('[catalog-refresh-autoresume-failed]', JSON.stringify({ jobId, error: catalogRefreshError }));
        })
        .finally(() => {
          catalogRefreshJob = null;
          if (catalogRefreshTask === startupRefresh) catalogRefreshTask = null;
        });
    });
  }
});

let shutdownPromise = null;
async function gracefulShutdown(signal) {
  if (shutdownPromise) return shutdownPromise;
  shuttingDown = true;
  console.warn('[graceful-shutdown-started]', JSON.stringify({ signal, refreshActive: Boolean(catalogRefreshTask) }));
  const serverClosed = new Promise(resolve => server.close(resolve));
  shutdownPromise = (async () => {
    const task = catalogRefreshTask
      ? catalogRefreshTask.catch(error => console.warn('[graceful-shutdown-refresh-ended]', error?.message || 'refresh task failed'))
      : Promise.resolve();
    let timer;
    await Promise.race([
      Promise.all([serverClosed, task]),
      new Promise(resolve => { timer = setTimeout(resolve, 25000); })
    ]);
    if (timer) clearTimeout(timer);
    console.warn('[graceful-shutdown-finished]', JSON.stringify({ signal, refreshStillRunning: Boolean(catalogRefreshTask) }));
    process.exit(0);
  })();
  return shutdownPromise;
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => { void gracefulShutdown(signal); });
}
