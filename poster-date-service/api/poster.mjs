import { upcomingRelease, validImdbId } from '../lib/release-dates.mjs';
import { renderUpcomingBadge } from '../lib/render-poster.mjs';
import { hasExistingComingDateTag } from '../lib/coming-tag.mjs';

// Use the user's BetterPosters URL (without the quality-badge variant or rs parameter).
const BETTERPOSTERS = 'https://btttr.cc/poster/imdb/poster-default/';
const MAX_BYTES = 15 * 1024 * 1024;

async function getOriginal(imdbId) {
  const response = await fetch(BETTERPOSTERS + encodeURIComponent(imdbId) + '.jpg', {
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
    const original = await getOriginal(id);
    let output = original.bytes;
    let status = 'unchanged';
    let releaseDate = 'none';

    // Never stack our badge on top of BetterPosters' own "Coming [date]" label.
    // If OCR is unavailable or inconclusive due to an error, fail closed and preserve the source.
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

    res.statusCode = 200;
    res.setHeader('Content-Type', original.type);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Poster-Date-Status', status);
    res.setHeader('X-Poster-Date', releaseDate);
    res.setHeader('Cache-Control', 'public, max-age=900, stale-while-revalidate=1800');
    return res.end(req.method === 'HEAD' ? undefined : output);
  } catch {
    res.statusCode = 502;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.end('The original BetterPosters image could not be fetched. Please retry.');
  }
}
