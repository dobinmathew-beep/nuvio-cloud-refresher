import { upcomingRelease, validImdbId } from '../lib/release-dates.mjs';
import { renderUpcomingBadge } from '../lib/render-poster.mjs';
import { hasExistingComingDateTag } from '../lib/coming-tag.mjs';

// Preserve the exact BetterPosters quality-badge route used by the user's addon manifest.
// This route carries BetterPosters' artwork, ratings and existing tags.
const BETTERPOSTERS = 'https://btttr.cc/poster-q/imdb/poster-default/';
const BETTERPOSTERS_RS = 'IM';
const MAX_BYTES = 15 * 1024 * 1024;
const RESULT_CACHE_MS = 6 * 60 * 60 * 1000;
const resultCache = new Map();
const pendingResults = new Map();

async function getOriginal(imdbId) {
  const url = BETTERPOSTERS + encodeURIComponent(imdbId) + '.jpg?rs=' + BETTERPOSTERS_RS;
  const response = await fetch(url, {
    headers: { accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8' },
    redirect: 'follow',
    signal: AbortSignal.timeout(14000)
  });
  const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!response.ok || !['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(type)) {
    throw new Error('BetterPosters did not return a supported image');
  }
  if (Number(response.headers.get('content-length') || 0) > MAX_BYTES) throw new Error('Poster exceeds size limit');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_BYTES) throw new Error('Poster exceeds size limit');
  return { bytes, type };
}

async function buildPoster(id) {
  const original = await getOriginal(id);
  let output = original.bytes;
  let status = 'unchanged';
  let releaseDate = 'none';

  let hasComingTag;
  try {
    hasComingTag = await hasExistingComingDateTag(original.bytes);
  } catch {
    hasComingTag = null;
  }

  if (hasComingTag === null) {
    status = 'coming-tag-check-unavailable';
  } else if (hasComingTag) {
    status = 'betterposters-coming-tag';
  } else {
    const release = await upcomingRelease(id);
    releaseDate = release?.date || 'none';
    if (release?.date) {
      try {
        output = await renderUpcomingBadge(original.bytes, release.date);
        status = 'upcoming-date-overlay';
      } catch {
        output = original.bytes;
      }
    }
  }
  return { bytes: output, type: original.type, status, releaseDate };
}

async function getBuiltPoster(id) {
  const cached = resultCache.get(id);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (pendingResults.has(id)) return pendingResults.get(id);

  const pending = buildPoster(id).then(value => {
    resultCache.set(id, { value, expiresAt: Date.now() + RESULT_CACHE_MS });
    if (resultCache.size > 500) {
      const oldest = resultCache.keys().next().value;
      if (oldest) resultCache.delete(oldest);
    }
    return value;
  }).finally(() => pendingResults.delete(id));

  pendingResults.set(id, pending);
  return pending;
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
    // Xperience's template probe returns the exact BetterPosters source artwork quickly.
    // HEAD requests also avoid OCR/TMDB work.
    if (req.probe || req.method === 'HEAD') {
      const original = await getOriginal(id);
      res.statusCode = 200;
      res.setHeader('Content-Type', original.type);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Poster-Date-Status', req.probe ? 'template-probe' : 'head-check');
      res.setHeader('Cache-Control', 'public, max-age=300');
      return res.end(req.method === 'HEAD' ? undefined : original.bytes);
    }

    const poster = await getBuiltPoster(id);
    res.statusCode = 200;
    res.setHeader('Content-Type', poster.type);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Poster-Date-Status', poster.status);
    res.setHeader('X-Poster-Date', poster.releaseDate);
    res.setHeader('Cache-Control', 'public, max-age=21600, stale-while-revalidate=86400');
    return res.end(poster.bytes);
  } catch {
    res.statusCode = 502;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.end('The original BetterPosters image could not be fetched. Please retry.');
  }
}
