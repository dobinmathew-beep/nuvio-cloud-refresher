import { upcomingRelease, validImdbId } from '../lib/release-dates.mjs';
import { renderUpcomingBadge } from '../lib/render-poster.mjs';
import { hasExistingComingDateTag } from '../lib/coming-tag.mjs';

const BETTERPOSTERS = 'https://btttr.cc/poster-q/imdb/poster-default/';
const BETTERPOSTERS_RS = 'IM';
const MAX_BYTES = 15 * 1024 * 1024;
const RESULT_CACHE_MS = 6 * 60 * 60 * 1000;
const resultCache = new Map();
const pendingResults = new Map();

function sourceUrl(imdbId) {
  return BETTERPOSTERS + encodeURIComponent(imdbId) + '.jpg?rs=' + BETTERPOSTERS_RS;
}

const IMAGEKIT_UPLOAD_URL = 'https://upload.imagekit.io/api/v1/files/upload';
const IMAGEKIT_REFRESH_MS = 6 * 60 * 60 * 1000;
const pendingImageKitUploads = new Map();

function imageKitConfig() {
  let endpoint = String(process.env.IMAGEKIT_URL_ENDPOINT || '').trim();
  const privateKey = process.env.IMAGEKIT_PRIVATE_KEY || '';
  while (endpoint.endsWith('/')) endpoint = endpoint.slice(0, -1);
  if (!endpoint || !privateKey) return null;
  try {
    const parsed = new URL(endpoint);
    const accountId = parsed.pathname.split('/').filter(Boolean);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'ik.imagekit.io' ||
        accountId.length !== 1 || !/^[A-Za-z0-9_-]+$/.test(accountId[0]) ||
        parsed.search || parsed.hash) return null;
    return { endpoint: parsed.origin + '/' + accountId[0], privateKey };
  } catch {
    return null;
  }
}

function imageKitAssetUrl(config, imdbId) {
  return config.endpoint + '/posters/' + encodeURIComponent(imdbId) + '.jpg';
}

async function findFreshImageKitAsset(imdbId) {
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
    if (Number.isFinite(lastModified) && Date.now() - lastModified > IMAGEKIT_REFRESH_MS) return null;
    return assetUrl;
  } catch {
    return null;
  }
}

async function uploadPosterToImageKit(imdbId, poster) {
  const config = imageKitConfig();
  if (!config) return;
  const form = new FormData();
  form.set('file', new Blob([poster.bytes], { type: poster.type }), imdbId + '.jpg');
  form.set('fileName', imdbId + '.jpg');
  form.set('folder', '/posters');
  form.set('useUniqueFileName', 'false');
  form.set('overwriteFile', 'true');
  form.set('isPrivateFile', 'false');

  const response = await fetch(IMAGEKIT_UPLOAD_URL, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(config.privateKey + ':').toString('base64')
    },
    body: form,
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error('ImageKit upload failed (' + response.status + '): ' + detail);
  }
  const result = await response.json();
  if (!result.url) throw new Error('ImageKit upload response did not include a URL');
  console.log('ImageKit poster cached:', imdbId);
}

function scheduleImageKitUpload(imdbId, poster) {
  if (!imageKitConfig() || pendingImageKitUploads.has(imdbId)) return;
  const job = uploadPosterToImageKit(imdbId, poster)
    .catch(error => console.warn('ImageKit cache upload skipped for', imdbId, error.message))
    .finally(() => pendingImageKitUploads.delete(imdbId));
  pendingImageKitUploads.set(imdbId, job);
}

function redirectToImageKit(res, assetUrl) {
  res.statusCode = 302;
  res.setHeader('Location', assetUrl);
  res.setHeader('Cache-Control', 'public, max-age=21600, stale-while-revalidate=86400');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('X-Poster-Date-Status', 'imagekit-cache-hit');
  return res.end();
}

async function getOriginal(imdbId) {
  const response = await fetch(sourceUrl(imdbId), {
    headers: { accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8' },
    redirect: 'follow',
    signal: AbortSignal.timeout(10000)
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
    status = 'coming-tag-check-unavailable-original-preserved';
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
        status = 'overlay-failed-original-preserved';
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
    while (resultCache.size > 500) resultCache.delete(resultCache.keys().next().value);
    return value;
  }).finally(() => pendingResults.delete(id));

  pendingResults.set(id, pending);
  return pending;
}

function setImageHeaders(res, type, status, releaseDate) {
  res.statusCode = 200;
  res.setHeader('Content-Type', type);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Poster-Date-Status', status);
  res.setHeader('X-Poster-Date', releaseDate);
  // Let Xperience/CDNs reuse the processed result; the in-process cache
  // remains a secondary optimisation, not the only cache.
  res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
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
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.end(req.method === 'HEAD' ? undefined : original.bytes);
    }

    // Completed posters are served from ImageKit's CDN on later requests.
    // The service refreshes the persistent copy after six hours when ImageKit
    // exposes a Last-Modified timestamp; otherwise it safely trusts the asset.
    const imageKitAsset = await findFreshImageKitAsset(id);
    if (imageKitAsset) return redirectToImageKit(res, imageKitAsset);

    const poster = await getBuiltPoster(id);
    // Upload in the background so the first poster response is not delayed by
    // the storage API. If ImageKit is unavailable, the processed image still
    // reaches Xperience directly and the BetterPosters fail-open path is intact.
    scheduleImageKitUpload(id, poster);
    setImageHeaders(res, poster.type, poster.status, poster.releaseDate);
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
