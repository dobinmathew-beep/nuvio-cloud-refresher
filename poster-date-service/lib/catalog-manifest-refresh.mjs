import { Buffer } from 'node:buffer';

const MANIFEST_KEYS = [
  'CATALOG_MANIFEST_ELFHOSTED_URL',
  'CATALOG_MANIFEST_MIDNIGHTIGNITE_URL',
  'CATALOG_MANIFEST_XPERIENCE_URL'
];
const PAGE_SIZE = 100;
const MAX_PAGES = Math.max(1, Math.min(500, Number(process.env.CATALOG_SCAN_MAX_PAGES || 500)));
const CONCURRENCY = Math.max(1, Math.min(4, Number(process.env.CATALOG_SCAN_CONCURRENCY || 2)));
const STATE_PATH = '/catalog-state/manifest-scan-state.json';
const INDEX_PATH = '/catalog-state/catalog-added.json';
const INDEX_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function imageKitConfig() {
  const endpoint = String(process.env.IMAGEKIT_URL_ENDPOINT || '').replace(/\/+$/, '');
  const privateKey = process.env.IMAGEKIT_PRIVATE_KEY || '';
  if (!endpoint || !privateKey) throw new Error('ImageKit credentials are required for persistent catalogue state');
  return { endpoint, privateKey };
}
function auth(config) {
  return 'Basic ' + Buffer.from(config.privateKey + ':').toString('base64');
}
async function readState(config) {
  const url = config.endpoint + STATE_PATH;
  try {
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error('ImageKit state read HTTP ' + response.status);
    const value = await response.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid persisted catalogue state');
    return value;
  } catch (error) {
    if (/HTTP 404/.test(error.message)) return null;
    throw error;
  }
}
async function writeJson(config, path, value) {
  const form = new FormData();
  const bytes = Buffer.from(JSON.stringify(value));
  form.set('file', new Blob([bytes], { type: 'application/json' }), path.split('/').pop());
  form.set('fileName', path.split('/').pop());
  form.set('folder', path.slice(0, path.lastIndexOf('/')));
  form.set('useUniqueFileName', 'false');
  form.set('overwriteFile', 'true');
  form.set('isPrivateFile', 'false');
  const response = await fetch('https://upload.imagekit.io/api/v1/files/upload', {
    method: 'POST',
    headers: { Authorization: auth(config) },
    body: form,
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw new Error('ImageKit state upload HTTP ' + response.status + ': ' + (await response.text()).slice(0, 200));
  return response.json();
}
async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'GreatIndianCatalogScanner/1.0' },
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  return response.json();
}
function manifestBase(manifestUrl) {
  const url = new URL(manifestUrl);
  url.pathname = url.pathname.replace(/\/manifest\.json$/i, '').replace(/\/manifest\.json$/i, '');
  return url.toString().replace(/\/$/, '');
}
async function readManifest(key) {
  const manifestUrl = String(process.env[key] || '').trim();
  if (!manifestUrl) return { key, configured: false, catalogs: [], base: null };
  const manifest = await fetchJson(manifestUrl);
  if (!Array.isArray(manifest.catalogs)) throw new Error(key + ' manifest has no catalogs array');
  return {
    key,
    configured: true,
    name: String(manifest.name || key),
    base: manifestBase(manifestUrl),
    catalogs: manifest.catalogs.filter(c => c && c.type && c.id).map(c => ({
      type: String(c.type), id: String(c.id), name: String(c.name || c.id),
      extra: Array.isArray(c.extraSupported) ? c.extraSupported : [],
      required: Array.isArray(c.extraRequired) ? c.extraRequired : []
    }))
  };
}
function catalogUrl(base, catalog, skip) {
  const url = new URL(base + '/catalog/' + encodeURIComponent(catalog.type) + '/' + encodeURIComponent(catalog.id) + '.json');
  if (skip) url.searchParams.set('skip', String(skip));
  // Required extras are populated conservatively from the descriptor's first
  // advertised option when available; skip remains the pagination cursor.
  for (const extra of catalog.required) {
    if (!extra || extra.name === 'skip') continue;
    const options = Array.isArray(extra.options) ? extra.options : [];
    if (options.length) url.searchParams.set(extra.name, String(options[0]));
  }
  return url;
}
async function collectCatalog(manifest, catalog) {
  const metas = [];
  let pages = 0;
  let lastBatchSize = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await fetchJson(catalogUrl(manifest.base, catalog, page * PAGE_SIZE));
    const batch = Array.isArray(data.metas) ? data.metas : [];
    metas.push(...batch);
    lastBatchSize = batch.length;
    pages++;
    if (batch.length < PAGE_SIZE) break;
  }
  return { source: manifest.name, type: catalog.type, id: catalog.id, name: catalog.name, pages, metas, truncated: pages === MAX_PAGES && lastBatchSize === PAGE_SIZE };
}
function canonicalId(meta) {
  const raw = String(meta?.id || '').trim();
  if (/^tt\d{7,10}$/i.test(raw)) return raw.toLowerCase();
  const tmdb = raw.match(/^(?:tmdb:|tmdb\/)(\d{1,12})$/i);
  if (tmdb) return 'tmdb:' + tmdb[1];
  const tvmaze = raw.match(/^(?:tvmaze:|tvmaze\/)(\d{1,12})$/i);
  if (tvmaze) return 'tvmaze:' + tvmaze[1];
  const imdb = String(meta?.imdb_id || meta?.imdbId || '').trim();
  if (/^tt\d{7,10}$/i.test(imdb)) return imdb.toLowerCase();
  return null;
}
function posterPath(id, type) {
  if (/^tt\d{7,10}$/.test(id)) return '/poster/' + id + '.jpg';
  if (id.startsWith('tmdb:')) return '/poster/tmdb/' + id.slice(5) + '.jpg?type=' + (String(type).toLowerCase().includes('movie') ? 'movie' : 'tv');
  if (id.startsWith('tvmaze:')) return '/poster/tvmaze/' + id.slice(7) + '.jpg';
  return null;
}
async function runPool(items, worker) {
  const output = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      try { output[index] = await worker(items[index]); }
      catch (error) { output[index] = { id: items[index].id, status: 'failed', error: error?.message || 'unknown error' }; }
      if ((index + 1) % 50 === 0 || index + 1 === items.length) console.log('[catalog-scan-progress]', index + 1, '/', items.length);
    }
  }));
  return output;
}
async function checkImageKit(id) {
  const endpoint = String(process.env.IMAGEKIT_URL_ENDPOINT || '').replace(/\/$/, '');
  if (!endpoint) return false;
  try {
    const response = await fetch(endpoint + '/posters/' + encodeURIComponent(id) + '.jpg', { method: 'HEAD', cache: 'no-store', signal: AbortSignal.timeout(6000) });
    return response.ok && (response.headers.get('content-type') || '').toLowerCase().startsWith('image/');
  } catch { return false; }
}
async function waitForImageKit(id) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (await checkImageKit(id)) return true;
    await sleep(3000);
  }
  return false;
}
async function prewarm(item) {
  const path = posterPath(item.id, item.type);
  if (!path) return { id: item.id, status: 'unsupported-id-format' };
  const requestPath = item.poster
    ? path + (path.includes('?') ? '&' : '?') + 'fallback=' + encodeURIComponent(item.poster)
    : path;
  const response = await fetch((process.env.POSTER_SERVICE_URL || 'https://great-indian-upcoming-posters.onrender.com').replace(/\/$/, '') + requestPath, {
    headers: { accept: 'image/*' }, redirect: 'manual', signal: AbortSignal.timeout(60000)
  });
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location') || '';
    if (location.startsWith((process.env.IMAGEKIT_URL_ENDPOINT || '').replace(/\/$/, '') + '/posters/')) return { id: item.id, status: 'imagekit-hit' };
    return { id: item.id, status: 'source-redirect' };
  }
  if (!response.ok || !(response.headers.get('content-type') || '').startsWith('image/')) {
    throw new Error('Poster service returned HTTP ' + response.status);
  }
  const status = response.headers.get('x-poster-date-status') || 'rendered';
  const storage = response.headers.get('x-imagekit-storage') || 'not-stored';
  await response.arrayBuffer();
  if (storage === 'pending') {
    if (await waitForImageKit(item.id)) return { id: item.id, status: 'generated-and-cached', posterStatus: status };
    return { id: item.id, status: 'imagekit-upload-timeout', posterStatus: status };
  }
  if (await checkImageKit(item.id)) return { id: item.id, status: 'imagekit-hit', posterStatus: status };
  return { id: item.id, status: 'rendered-not-cached', posterStatus: status };
}
export async function runManifestCatalogRefresh() {
  const startedAt = new Date().toISOString();
  const configured = MANIFEST_KEYS.filter(key => process.env[key]);
  if (!configured.length) throw new Error('No catalogue manifest URLs are configured');
  const config = imageKitConfig();
  const prior = await readState(config);
  const manifests = await Promise.all(configured.map(readManifest));
  const catalogues = [];
  for (const manifest of manifests) {
    for (const catalog of manifest.catalogs) {
      try {
        const result = await collectCatalog(manifest, catalog);
        catalogues.push(result);
        console.log('[catalog-discovered]', JSON.stringify({ source: result.source, type: result.type, id: result.id, name: result.name, pages: result.pages, records: result.metas.length }));
      } catch (error) {
        const failed = { source: manifest.name, type: catalog.type, id: catalog.id, name: catalog.name, pages: 0, metas: [], error: error?.message || 'catalogue fetch failed' };
        catalogues.push(failed);
        console.warn('[catalog-fetch-failed]', JSON.stringify({ source: failed.source, type: failed.type, id: failed.id, error: failed.error }));
      }
    }
  }
  const current = new Map();
  for (const catalog of catalogues) {
    for (const meta of catalog.metas) {
      const id = canonicalId(meta);
      if (id && !current.has(id)) current.set(id, { id, type: catalog.type, title: String(meta.name || meta.title || ''), poster: String(meta.poster || '') });
    }
  }
  if (!current.size) throw new Error('No supported IMDb, TMDB or TVmaze IDs were found; refusing to mark an empty scan successful');
  const now = Date.now();
  const seen = prior?.seen && typeof prior.seen === 'object' ? prior.seen : {};
  const added = prior?.added && typeof prior.added === 'object' ? prior.added : {};
  const baselineReady = prior?.complete === true;
  let newlyDiscovered = 0;
  if (baselineReady) {
    for (const id of current.keys()) {
      if (!seen[id]) { added[id] = new Date(now).toISOString(); newlyDiscovered++; }
    }
  }
  for (const id of current.keys()) seen[id] = new Date(now).toISOString();
  for (const [id, timestamp] of Object.entries(added)) {
    const time = Date.parse(timestamp);
    if (!Number.isFinite(time) || now - time > INDEX_TTL_MS) delete added[id];
  }
  const index = {};
  for (const [id, timestamp] of Object.entries(added)) index['manifest|' + id] = timestamp;
  // Preserve the pre-existing IndianRegional first-seen index if reachable.
  try {
    const legacy = await fetchJson('https://raw.githubusercontent.com/dobinmathew-beep/nuvio-cloud-refresher/dobins-catalog/dobins-indian-catalog/data/catalog-added.json');
    for (const [key, timestamp] of Object.entries(legacy || {})) if (!index[key]) index[key] = timestamp;
  } catch {}
  const scanComplete = catalogues.every(c => !c.error && !c.truncated);
  const nextState = { initialized: true, complete: scanComplete, updatedAt: new Date(now).toISOString(), seen, added };
  await writeJson(config, STATE_PATH, nextState);
  await writeJson(config, INDEX_PATH, index);
  const items = [...current.values()];
  const results = await runPool(items, prewarm);
  const failures = results.filter(r => r.status === 'failed');
  const report = {
    startedAt, finishedAt: new Date().toISOString(), manifests: manifests.map(m => ({ source: m.name || m.key, catalogs: m.catalogs.length })),
    catalogues: catalogues.map(c => ({ source: c.source, type: c.type, id: c.id, name: c.name, pages: c.pages, records: c.metas.length, truncated: Boolean(c.truncated), error: c.error || null })),
    cataloguesDiscovered: catalogues.length, uniqueTitles: items.length, newlyDiscovered, scanComplete,
    postersProcessed: results.length, failures: failures.length,
    results: results.reduce((counts, r) => { counts[r.status] = (counts[r.status] || 0) + 1; return counts; }, {})
  };
  console.log('[catalog-refresh-complete]', JSON.stringify(report));
  return report;
}
