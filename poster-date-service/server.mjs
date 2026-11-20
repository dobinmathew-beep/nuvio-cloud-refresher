import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import posterHandler from './api/poster.mjs';
import healthHandler from './api/health.mjs';
import { resolveTmdbExternalImdbId } from './lib/tmdb-external-ids.mjs';
import { renderJustAddedBadge } from './lib/render-poster.mjs';

import { runImageKitMaintenance } from './lib/imagekit-storage.mjs';

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

async function sendTmdbPosterFallback(tmdbId, mediaType, req, res) {
  if (String(req.query?.badge || '').toLowerCase() !== 'just-added') {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.end('No IMDb external ID is available for this TMDB title.');
  }

  const sources = [];
  const apiKey = process.env.TMDB_API_KEY || '';
  const readToken = process.env.TMDB_API_READ_ACCESS_TOKEN || '';
  if (apiKey || readToken) {
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
  // Always replace any provider-supplied uppercase chip with our title-case artwork.
  const output = await renderJustAddedBadge(original.bytes);
  res.statusCode = 200;
  res.setHeader('Content-Type', original.type);
  res.setHeader('X-Poster-Source', original.source);
  res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=3600');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Poster-Date-Status', 'just-added-overlay');
  res.setHeader('X-Poster-Just-Added', 'true');
  res.setHeader('X-Poster-Date', 'none');
  res.setHeader('X-Poster-Date-Type', 'none');
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
    return posterHandler(adaptedReq, adaptedRes);
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
        return sendTmdbPosterFallback(tmdbPosterMatch[1], mediaType, adaptedReq, adaptedRes);
      }
      adaptedReq.query.id = imdbId;
      return posterHandler(adaptedReq, adaptedRes);
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
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end('TVmaze title has no IMDb external ID for release-date lookup.');
      }
      adaptedReq.query.id = imdbId;
      return posterHandler(adaptedReq, adaptedRes);
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
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
