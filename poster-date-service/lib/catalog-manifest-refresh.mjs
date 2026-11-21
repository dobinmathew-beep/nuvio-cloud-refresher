import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { withRefreshLease } from './refresh-coordination.mjs';

const MANIFEST_KEYS = [
  'CATALOG_MANIFEST_ELFHOSTED_URL',
  'CATALOG_MANIFEST_MIDNIGHTIGNITE_URL',
  'CATALOG_MANIFEST_XPERIENCE_URL'
];
const PAGE_SIZE = 100;
const MAX_PAGES = Math.max(1, Math.min(500, Number(process.env.CATALOG_SCAN_MAX_PAGES || 500)));
const CONCURRENCY = Math.max(1, Math.min(4, Number(process.env.CATALOG_SCAN_CONCURRENCY || 2)));
const STATE_PATH = '/catalog-state/manifest-scan-state.json';
const CHECKPOINT_PATH = '/catalog-state/manifest-scan-checkpoint.json';
const CATALOG_CHECKPOINT_DIR = '/catalog-state/catalogues';
const INDEX_PATH = '/catalog-state/catalog-added.json';
const INDEX_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const LEDGER_DIR = '/catalog-state/poster-processing';
const LEDGER_VERSION = 1;
const BADGE_RULES_VERSION = 3;
const LEDGER_SHARDS = '0123456789abcdef';
const PREWARM_BATCH_SIZE = Math.max(10, Math.min(50, Number(process.env.CATALOG_PREWARM_BATCH_SIZE || 50)));
const PREWARM_CONCURRENCY = Math.max(1, Math.min(6, Number(process.env.CATALOG_PREWARM_CONCURRENCY || 4)));
const VERIFY_CONCURRENCY = Math.max(1, Math.min(8, Number(process.env.CATALOG_VERIFY_CONCURRENCY || 6)));

function ledgerShard(id) {
  return createHash('sha256').update(String(id)).digest('hex')[0];
}
function ledgerPath(shard) {
  return LEDGER_DIR + '/' + shard + '.json';
}
function itemFingerprint(item) {
  return createHash('sha256')
    .update([item.id, item.type || '', item.poster || '', 'badge-rules-' + BADGE_RULES_VERSION].join('|'))
    .digest('hex');
}
async function loadLedgerShard(config, shard, cache) {
  if (cache.has(shard)) return cache.get(shard);
  const saved = await readState(config, ledgerPath(shard));
  const records = saved?.version === LEDGER_VERSION && saved.records && typeof saved.records === 'object'
    ? saved.records : {};
  cache.set(shard, records);
  return records;
}
async function persistLedgerShards(config, cache, shards) {
  for (const shard of [...new Set(shards)].sort()) {
    const records = cache.get(shard) || {};
    await writeJson(config, ledgerPath(shard), {
      version: LEDGER_VERSION,
      updatedAt: new Date().toISOString(),
      records
    });
  }
}
function ledgerRecord(item, status, extra = {}) {
  return {
    id: item.id,
    fingerprint: itemFingerprint(item),
    status,
    updatedAt: new Date().toISOString(),
    ...extra
  };
}
function reusableLedgerRecord(record, item) {
  // A verified poster is reusable for as long as the catalogue identity and
  // poster fingerprint are unchanged and ImageKit still serves the asset.
  // Do not expire completed work after six hours: long refreshes and Render
  // restarts must not force already-verified titles through the pipeline again.
  if (!record || !['verified', 'cache-hit'].includes(record.status)) return false;
  return record.fingerprint === itemFingerprint(item);
}

function imageKitConfig() {
  const endpoint = String(process.env.IMAGEKIT_URL_ENDPOINT || '').replace(/\/+$/, '');
  const privateKey = process.env.IMAGEKIT_PRIVATE_KEY || '';
  if (!endpoint || !privateKey) throw new Error('ImageKit credentials are required for persistent catalogue state');
  return { endpoint, privateKey };
}
function auth(config) {
  return 'Basic ' + Buffer.from(config.privateKey + ':').toString('base64');
}
async function readState(config, path = STATE_PATH) {
  const url = config.endpoint + path;
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
      extra: Array.isArray(c.extra) ? c.extra : [],
      extraSupported: Array.isArray(c.extraSupported) ? c.extraSupported : [],
      required: Array.isArray(c.extraRequired) ? c.extraRequired : []
    }))
  };
}
function catalogUrl(base, catalog, skip) {
  const url = new URL(base + '/catalog/' + encodeURIComponent(catalog.type) + '/' + encodeURIComponent(catalog.id) + '.json');
  if (skip) url.searchParams.set('skip', String(skip));
  // Required extras are populated conservatively from the descriptor's first
  // advertised option when available; skip remains the pagination cursor.
  for (const requirement of catalog.required) {
    const name = typeof requirement === 'string' ? requirement : String(requirement?.name || '');
    if (!name || name === 'skip') continue;
    const descriptor = catalog.extra.find(item => item && typeof item === 'object' && item.name === name);
    const options = Array.isArray(descriptor?.options) ? descriptor.options
      : Array.isArray(requirement?.options) ? requirement.options : [];
    if (options.length) url.searchParams.set(name, String(options[0]));
  }
  return url;
}
function unresolvedRequiredExtras(catalog) {
  return catalog.required.map(item => typeof item === 'string' ? item : String(item?.name || ''))
    .filter(name => name && name !== 'skip')
    .filter(name => {
      const descriptor = catalog.extra.find(item => item && typeof item === 'object' && item.name === name);
      const requiredItem = catalog.required.find(item => (typeof item === 'string' ? item : item?.name) === name);
      const options = Array.isArray(descriptor?.options) ? descriptor.options
        : Array.isArray(requiredItem?.options) ? requiredItem.options : [];
      return options.length === 0;
    });
}

function catalogueCheckpointPath(fingerprint) {
  const key = createHash('sha256').update(fingerprint).digest('hex').slice(0, 24);
  return CATALOG_CHECKPOINT_DIR + '/' + key + '.json';
}

async function collectCatalog(manifest, catalog, config, fingerprint, lease, scanGeneration, forceRescan = false) {
  const path = catalogueCheckpointPath(fingerprint);
  const existing = await readState(config, path);
  // Only reuse page state written by this refresh generation. Old completed
  // snapshots must not short-circuit a forced full rediscovery.
  const saved = existing?.scanGeneration === scanGeneration ? existing : null;
  const titles = new Map();
  if (saved?.titles && typeof saved.titles === 'object') {
    for (const [id, item] of Object.entries(saved.titles)) {
      if (item && item.id === id) titles.set(id, item);
    }
  }
  const seenPageIds = new Set(Array.isArray(saved?.seenPageIds) ? saved.seenPageIds : []);
  let pages = Number.isInteger(saved?.pages) ? saved.pages : 0;
  let uniqueRecords = Number.isInteger(saved?.records) ? saved.records : 0;
  let lastBatchSize = 0;
  let lastPageNewIds = 0;
  if (saved?.complete === true) {
    return {
      source: manifest.name, type: catalog.type, id: catalog.id, name: catalog.name,
      pages, records: uniqueRecords, titles: [...titles.values()], truncated: false,
      resumedFromPageCheckpoint: true
    };
  }
  const firstPage = Number.isInteger(saved?.nextPage) ? saved.nextPage : 0;
  for (let page = firstPage; page < MAX_PAGES; page++) {
    const data = await fetchJson(catalogUrl(manifest.base, catalog, page * PAGE_SIZE));
    const batch = Array.isArray(data.metas) ? data.metas : [];
    let newIds = 0;
    for (const meta of batch) {
      const identity = String(meta?.id || (String(meta?.name || meta?.title || '') + '|' + String(meta?.releaseInfo?.year || meta?.year || '')));
      if (!identity || seenPageIds.has(identity)) continue;
      seenPageIds.add(identity);
      uniqueRecords++;
      newIds++;
      const id = canonicalId(meta);
      if (id && !titles.has(id)) {
        titles.set(id, {
          id,
          type: catalog.type,
          title: String(meta.name || meta.title || ''),
          poster: String(meta.poster || '')
        });
      }
    }
    lastBatchSize = batch.length;
    lastPageNewIds = newIds;
    pages++;
    const done = batch.length < PAGE_SIZE || (page > 0 && newIds === 0) || page + 1 >= MAX_PAGES;
    // Keep each catalogue's resumable page state separate. This avoids
    // rewriting the entire multi-source title index after every catalogue.
    await lease?.assertOwned?.();
    await writeJson(config, path, {
      version: 1, scanGeneration, complete: done, nextPage: page + 1, pages, records: uniqueRecords,
      seenPageIds: [...seenPageIds], titles: Object.fromEntries(titles)
    });
    if (pages % 25 === 0) console.log('[catalog-page-progress]', JSON.stringify({ source: manifest.name, id: catalog.id, pages, uniqueRecords, supportedTitles: titles.size }));
    if (done) break;
  }
  return {
    source: manifest.name, type: catalog.type, id: catalog.id, name: catalog.name,
    pages, records: uniqueRecords, titles: [...titles.values()],
    truncated: pages >= MAX_PAGES && lastBatchSize === PAGE_SIZE && lastPageNewIds > 0,
    resumedFromPageCheckpoint: firstPage > 0
  };
}
function catalogueFingerprint(catalog) {
  // Stremio catalogue IDs are the stable identity shared by cloned metadata
  // instances. Keep media type in the key because movie/series IDs can overlap.
  return String(catalog.type || '').trim().toLowerCase() + '|' + String(catalog.id || '').trim().toLowerCase();
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
function adaptivePrewarmConcurrency() {
  // Render's free instance has a tight memory budget. Increase network
  // throughput by default, but back off automatically if native/image work
  // pushes resident memory toward the safety ceiling.
  const rssMiB = process.memoryUsage().rss / (1024 * 1024);
  if (rssMiB >= 360) return 1;
  if (rssMiB >= 300) return Math.min(2, PREWARM_CONCURRENCY);
  return Math.min(3, PREWARM_CONCURRENCY);
}

async function runPool(items, worker, concurrency = CONCURRENCY) {
  const counts = {};
  let failures = 0;
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      let result;
      try { result = await worker(items[index]); }
      catch (error) {
        failures++;
        result = { status: 'failed', error: error?.message || 'unknown error' };
        if (failures <= 20) console.warn('[catalog-prewarm-failed]', JSON.stringify({ id: items[index].id, error: result.error }));
      }
      const status = result?.status || 'unknown';
      counts[status] = (counts[status] || 0) + 1;
      if ((index + 1) % 50 === 0 || index + 1 === items.length) {
        console.log('[catalog-scan-progress]', index + 1, '/', items.length, JSON.stringify({ counts, failures }));
      }
    }
  }));
  return { counts, failures };
}

function imageKitStorageId(id) {
  if (id.startsWith('tmdb:')) return 'tmdb-' + id.slice(5);
  if (id.startsWith('tvmaze:')) return 'tvmaze-' + id.slice(7);
  return id;
}
async function checkImageKit(id) {
  const endpoint = String(process.env.IMAGEKIT_URL_ENDPOINT || '').replace(/\/$/, '');
  if (!endpoint) return false;
  try {
    const storageId = imageKitStorageId(id);
    const response = await fetch(endpoint + '/posters/' + encodeURIComponent(storageId) + '.jpg', { method: 'HEAD', cache: 'no-store', signal: AbortSignal.timeout(6000) });
    return response.ok && (response.headers.get('content-type') || '').toLowerCase().startsWith('image/');
  } catch { return false; }
}
async function waitForImageKit(id) {
  // ImageKit can accept an upload before its CDN edge exposes the new file.
  // Give the asynchronous upload a longer bounded propagation window and
  // back off HEAD checks to avoid hammering the free Render instance.
  const deadline = Date.now() + 180000;
  let delay = 2000;
  while (Date.now() < deadline) {
    if (await checkImageKit(id)) return true;
    await sleep(delay);
    delay = Math.min(8000, Math.round(delay * 1.5));
  }
  return false;
}
async function prewarm(item) {
  const path = posterPath(item.id, item.type);
  if (!path) return { id: item.id, status: 'unsupported-id-format' };
  const requestBase = item.poster
    ? path + (path.includes('?') ? '&' : '?') + 'fallback=' + encodeURIComponent(item.poster)
    : path;
  const forceVersion = process.env.CATALOG_REFRESH_FORCE_REPROCESS_ON_START === 'true'
    ? (requestBase.includes('?') ? '&' : '?') + 'v=global-badge-rules-v2'
    : '';
  const requestPath = requestBase + forceVersion;
  const endpoint = (process.env.POSTER_SERVICE_URL || 'https://great-indian-upcoming-posters.onrender.com').replace(/\/$/, '');
  let lastError = null;
  let sourceRedirect = false;

  // Retry transient Render/provider responses and source fallbacks before
  // recording an unresolved title. A redirect is never accepted as a cached
  // poster unless ImageKit itself confirms the target with a successful HEAD.
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(endpoint + requestPath, {
        headers: { accept: 'image/*' }, redirect: 'manual', signal: AbortSignal.timeout(60000)
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location') || '';
        const imageKitBase = (process.env.IMAGEKIT_URL_ENDPOINT || '').replace(/\/$/, '') + '/posters/';
        if (imageKitBase.length > 9 && location.startsWith(imageKitBase)) {
          if (await checkImageKit(item.id)) return { id: item.id, status: 'imagekit-hit' };
          lastError = 'ImageKit redirect target is not yet visible';
        } else {
          sourceRedirect = true;
          lastError = 'Poster service fell back to its source provider';
        }
      } else {
        if (!response.ok || !(response.headers.get('content-type') || '').toLowerCase().startsWith('image/')) {
          lastError = 'Poster service returned HTTP ' + response.status;
        } else {
          const status = response.headers.get('x-poster-date-status') || 'rendered';
          const storage = response.headers.get('x-imagekit-storage') || 'not-stored';
          await response.body?.cancel().catch(() => {});
          if (storage === 'pending') return { id: item.id, status: 'upload-pending', posterStatus: status };
          if (await checkImageKit(item.id)) return { id: item.id, status: 'imagekit-hit', posterStatus: status };
          lastError = 'Poster rendered but no verified ImageKit asset was found';
        }
      }
    } catch (error) {
      lastError = error?.message || 'unknown poster request error';
    }
    if (attempt < 3) await sleep(attempt * (sourceRedirect ? 3000 : 2000));
  }
  if (sourceRedirect) return { id: item.id, status: 'source-redirect', error: lastError };
  throw new Error(lastError || 'Poster prewarm failed after three attempts');
}
let activeRefreshPromise = null;

export async function resumeIncompleteManifestCatalogRefresh(options = {}) {
  const config = imageKitConfig();
  const checkpoint = await readState(config, CHECKPOINT_PATH);
  if (!checkpoint || checkpoint.complete === true) {
    // Launch the one-time full revalidation only when the durable checkpoint
    // does not already prove that this badge-rule version completed.
    if (options.forceReprocess === true && checkpoint?.badgeRulesVersion !== BADGE_RULES_VERSION) {
      return runManifestCatalogRefresh({ forceReprocess: true });
    }
    return { status: 'no-incomplete-checkpoint', skipped: true };
  }
  // A restarted forced run resumes its page checkpoints and the versioned
  // ledger instead of resetting discovery or reprocessing completed batches.
  return runManifestCatalogRefresh();
}

export function runManifestCatalogRefresh(options = {}) {
  if (activeRefreshPromise) return activeRefreshPromise;
  activeRefreshPromise = withRefreshLease(lease => runManifestCatalogRefreshInternal(lease, options)).finally(() => { activeRefreshPromise = null; });
  return activeRefreshPromise;
}

async function runManifestCatalogRefreshInternal(lease, options = {}) {
  const forceReprocess = options.forceReprocess === true;
  await lease?.assertOwned?.();
  const startedAt = new Date().toISOString();
  const configured = MANIFEST_KEYS.filter(key => process.env[key]);
  if (!configured.length) throw new Error('No catalogue manifest URLs are configured');
  const config = imageKitConfig();
  const prior = await readState(config);
  let checkpoint = await readState(config, CHECKPOINT_PATH);
  // A completed checkpoint belongs to the previous run. Start a clean scan;
  // an incomplete checkpoint is a crash-safe resume point after an OOM/restart.
  if (forceReprocess || !checkpoint || checkpoint.complete === true || ![1, 2].includes(checkpoint.version)) {
    checkpoint = {
      version: 2, badgeRulesVersion: BADGE_RULES_VERSION,
      scanGeneration: startedAt, forceRescanCatalogs: Boolean(forceReprocess),
      complete: false, updatedAt: startedAt, completedCatalogues: {}, titleFiles: {}
    };
    await lease?.assertOwned?.();
    await writeJson(config, CHECKPOINT_PATH, checkpoint);
  }
  // A badge-rule-version checkpoint without an explicit completion marker is
  // an interrupted full scan from the previous implementation. Continue its
  // forced catalogue rediscovery rather than trusting old page snapshots.
  const completedCatalogues = checkpoint.completedCatalogues && typeof checkpoint.completedCatalogues === 'object'
    ? { ...checkpoint.completedCatalogues } : {};
  const hasUnversionedCatalogueCompletion = Object.values(completedCatalogues)
    .some(entry => entry?.scanGeneration !== checkpoint.scanGeneration);
  const scanGeneration = String(
    checkpoint.scanGeneration && !hasUnversionedCatalogueCompletion
      ? checkpoint.scanGeneration
      : startedAt
  );
  const forceRescanCatalogs = checkpoint.forceRescanCatalogs === true ||
    (checkpoint.badgeRulesVersion === BADGE_RULES_VERSION && checkpoint.forceRescanCatalogs !== false);
  // Persist a fresh generation when an older run wrote completion records
  // without generation IDs. Its page snapshots must be re-fetched once.
  if (checkpoint.scanGeneration !== scanGeneration || checkpoint.forceRescanCatalogs !== forceRescanCatalogs) {
    checkpoint = {
      ...checkpoint,
      scanGeneration,
      forceRescanCatalogs,
      // Start the new generation from a clean catalogue inventory; each
      // current manifest/catalogue will repopulate its own title file.
      completedCatalogues: {},
      titleFiles: {},
      updatedAt: new Date().toISOString()
    };
    await lease?.assertOwned?.();
    await writeJson(config, CHECKPOINT_PATH, checkpoint);
  }
  if (checkpoint.titleInventoryGeneration !== scanGeneration) {
    checkpoint = {
      ...checkpoint,
      titleInventoryGeneration: scanGeneration,
      titleFiles: {},
      updatedAt: new Date().toISOString()
    };
    await lease?.assertOwned?.();
    await writeJson(config, CHECKPOINT_PATH, checkpoint);
  }
  const titleFiles = checkpoint.titleFiles && typeof checkpoint.titleFiles === 'object' ? { ...checkpoint.titleFiles } : {};
  const current = new Map();
  if (checkpoint.titles && typeof checkpoint.titles === 'object') {
    for (const [id, item] of Object.entries(checkpoint.titles)) {
      if (item && item.id === id) current.set(id, item);
    }
  }
  const manifests = await Promise.all(configured.map(readManifest));
  const catalogues = [];
  const handledFingerprints = new Map();
  let cataloguesScannedThisRun = 0;
  let cataloguesResumed = 0;
  let cataloguesSkippedDuplicate = 0;

  for (const manifest of manifests) {
    for (const catalog of manifest.catalogs) {
      const fingerprint = catalogueFingerprint(catalog);
      const duplicateOf = handledFingerprints.get(fingerprint);
      if (duplicateOf) {
        cataloguesSkippedDuplicate++;
        const skipped = {
          source: manifest.name, type: catalog.type, id: catalog.id, name: catalog.name,
          pages: 0, records: 0, skippedDuplicate: true,
          duplicateOf: { source: duplicateOf.source, type: duplicateOf.type, id: duplicateOf.id, name: duplicateOf.name }
        };
        catalogues.push(skipped);
        console.info('[catalog-skipped-duplicate]', JSON.stringify({
          source: skipped.source, type: skipped.type, id: skipped.id,
          duplicateOf: skipped.duplicateOf
        }));
        continue;
      }

      const saved = completedCatalogues[fingerprint];
      if (saved && saved.scanGeneration === scanGeneration) {
        const perCatalog = await readState(config, titleFiles[fingerprint] || catalogueCheckpointPath(fingerprint));
        if (perCatalog?.titles && typeof perCatalog.titles === 'object') {
          for (const [id, item] of Object.entries(perCatalog.titles)) if (item?.id === id && !current.has(id)) current.set(id, item);
        }
        handledFingerprints.set(fingerprint, {
          source: saved.source, type: catalog.type, id: catalog.id, name: catalog.name
        });
        cataloguesResumed++;
        catalogues.push({
          source: manifest.name, type: catalog.type, id: catalog.id, name: catalog.name,
          pages: saved.pages || 0, records: saved.records || 0, truncated: Boolean(saved.truncated), resumed: true
        });
        console.info('[catalog-resumed-from-checkpoint]', JSON.stringify({
          source: manifest.name, type: catalog.type, id: catalog.id,
          fingerprint, titlesRestored: current.size
        }));
        continue;
      }

      if (saved) delete completedCatalogues[fingerprint];

      const unresolvedExtras = unresolvedRequiredExtras(catalog);
      if (unresolvedExtras.length) {
        const skipped = {
          source: manifest.name, type: catalog.type, id: catalog.id, name: catalog.name,
          pages: 0, records: 0, metas: [], skipped: true,
          skipReason: 'Requires user-supplied catalogue extras: ' + unresolvedExtras.join(', ')
        };
        catalogues.push(skipped);
        console.info('[catalog-skipped-dynamic]', JSON.stringify({
          source: skipped.source, type: skipped.type, id: skipped.id,
          name: skipped.name, requiredExtras: unresolvedExtras
        }));
        continue;
      }

      try {
        const result = await collectCatalog(manifest, catalog, config, fingerprint, lease, scanGeneration, forceRescanCatalogs);
        for (const item of result.titles) if (!current.has(item.id)) current.set(item.id, item);
        delete result.titles;
        completedCatalogues[fingerprint] = {
          source: result.source, type: result.type, id: result.id, name: result.name,
          pages: result.pages, records: result.records, truncated: Boolean(result.truncated),
          scanGeneration
        };
        handledFingerprints.set(fingerprint, {
          source: result.source, type: result.type, id: result.id, name: result.name
        });
        cataloguesScannedThisRun++;
        if (result.resumedFromPageCheckpoint) cataloguesResumed++;
        titleFiles[fingerprint] = catalogueCheckpointPath(fingerprint);
        catalogues.push(result);
        console.log('[catalog-discovered]', JSON.stringify({
          source: result.source, type: result.type, id: result.id, name: result.name,
          pages: result.pages, records: result.records, uniqueTitles: current.size
        }));
        // The per-catalogue page file holds title data. The top-level checkpoint
        // stays compact and records only which catalogues are complete.
        checkpoint = {
          version: 2, badgeRulesVersion: BADGE_RULES_VERSION,
          scanGeneration, forceRescanCatalogs, titleInventoryGeneration: scanGeneration,
          complete: false, updatedAt: new Date().toISOString(),
          completedCatalogues, titleFiles
        };
        await lease?.assertOwned?.();
        await writeJson(config, CHECKPOINT_PATH, checkpoint);
      } catch (error) {
        if (/coordination lease/.test(error?.message || '')) throw error;
        const failed = {
          source: manifest.name, type: catalog.type, id: catalog.id, name: catalog.name,
          pages: 0, records: 0, titles: [], error: error?.message || 'catalogue fetch failed'
        };
        catalogues.push(failed);
        console.warn('[catalog-fetch-failed]', JSON.stringify({
          source: failed.source, type: failed.type, id: failed.id, error: failed.error
        }));
      }
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
  await lease?.assertOwned?.();
  await writeJson(config, STATE_PATH, nextState);
  await lease?.assertOwned?.();
  await writeJson(config, INDEX_PATH, index);

  // Keep the complete catalogue inventory, but only send unresolved titles
  // through poster generation. Verified ledger entries are retained when the
  // fingerprint still matches and ImageKit confirms the asset is available.
  const allItems = [...current.values()];
  const preflightLedgerCache = new Map();
  const items = [];
  let preflightVerifiedHits = 0;
  for (const item of allItems) {
    const shard = ledgerShard(item.id);
    const records = await loadLedgerShard(config, shard, preflightLedgerCache);
    const record = records[item.id];
    if (!forceReprocess && reusableLedgerRecord(record, item) && await checkImageKit(item.id)) {
      preflightVerifiedHits++;
    } else {
      items.push(item);
    }
  }
  preflightLedgerCache.clear();
  console.info('[catalog-recovery-targeted]', JSON.stringify({
    catalogueTitles: allItems.length,
    retryCandidates: items.length,
    alreadyVerified: preflightVerifiedHits,
    strategy: forceReprocess ? 'force-revalidate-all-catalogue-titles' : 'retry-only-unresolved-or-missing-imagekit-assets'
  }));
  const resultCounts = preflightVerifiedHits ? { 'ledger-hit': preflightVerifiedHits } : {};
  let totalFailures = 0;
  let ledgerHits = preflightVerifiedHits;
  let batchesProcessed = 0;
  let postersVisited = 0;
  let verifiedUploads = 0;
  let verifiedCacheHits = preflightVerifiedHits;
  let uploadPending = 0;

  // Process one deterministic ledger shard at a time. This keeps memory bounded
  // and avoids rewriting many unrelated ledger files for every batch.
  const itemsByShard = new Map();
  for (const item of items) {
    const shard = ledgerShard(item.id);
    if (!itemsByShard.has(shard)) itemsByShard.set(shard, []);
    itemsByShard.get(shard).push(item);
  }

  // The ledger lives in ImageKit beside the catalogue checkpoints, not on the
  // ephemeral Render filesystem. Verified records do not expire: a matching
  // fingerprint plus a live ImageKit HEAD check is the completion proof.
  for (const [shard, shardItems] of itemsByShard) {
    const ledgerCache = new Map();
    const records = await loadLedgerShard(config, shard, ledgerCache);
    // All writes for this shard are serialized so overlapping verification
    // cannot overwrite a newer pending/verified record with an older snapshot.
    let ledgerWriteChain = Promise.resolve();
    const persistShard = () => {
      ledgerWriteChain = ledgerWriteChain.then(async () => {
        await lease?.assertOwned?.();
        await persistLedgerShards(config, ledgerCache, [shard]);
      });
      return ledgerWriteChain;
    };
    const inFlightVerifications = [];

    const verifyPendingBatch = async pendingItems => {
      const verification = await runPool(pendingItems, async item => {
        if (await waitForImageKit(item.id)) {
          records[item.id] = ledgerRecord(item, 'verified', {
            verifiedAt: new Date().toISOString(),
            verification: 'imagekit-head-confirmed'
          });
          return { id: item.id, status: 'generated-and-cached' };
        }
        records[item.id] = ledgerRecord(item, 'failed', {
          attempts: (Number(records[item.id]?.attempts) || 0) + 1,
          lastError: 'ImageKit upload did not become visible within 180 seconds'
        });
        throw new Error('ImageKit upload did not become visible within 180 seconds');
      }, VERIFY_CONCURRENCY);

      for (const [status, count] of Object.entries(verification.counts)) {
        resultCounts[status] = (resultCounts[status] || 0) + count;
      }
      totalFailures += verification.failures;
      verifiedUploads += verification.counts['generated-and-cached'] || 0;
      uploadPending -= pendingItems.length;
      resultCounts['upload-pending'] = Math.max(0, (resultCounts['upload-pending'] || 0) - pendingItems.length);
      if (!resultCounts['upload-pending']) delete resultCounts['upload-pending'];
      await persistShard();
    };

    for (let offset = 0; offset < shardItems.length; offset += PREWARM_BATCH_SIZE) {
      // Keep at most two verification batches in flight. The next prewarm
      // overlaps ImageKit visibility checks, but memory and outbound requests
      // remain bounded on Render's free instance.
      if (inFlightVerifications.length >= 2) {
        await inFlightVerifications.shift();
      }
      await lease?.assertOwned?.();
      const batch = shardItems.slice(offset, offset + PREWARM_BATCH_SIZE);
      const reusable = await Promise.all(batch.map(async item => {
        if (forceReprocess) return false;
        const record = records[item.id];
        return reusableLedgerRecord(record, item) && await checkImageKit(item.id);
      }));
      const pendingItems = [];
      const toProcess = [];
      for (let index = 0; index < batch.length; index++) {
        const item = batch[index];
        if (reusable[index]) {
          ledgerHits++;
          verifiedCacheHits++;
          resultCounts['ledger-hit'] = (resultCounts['ledger-hit'] || 0) + 1;
        } else {
          toProcess.push(item);
        }
      }

      if (toProcess.length) {
        const prewarmReport = await runPool(toProcess, async item => {
          try {
            const result = await prewarm(item);
            if (result.status === 'upload-pending') {
              records[item.id] = ledgerRecord(item, 'upload-pending', {
                attempts: (Number(records[item.id]?.attempts) || 0) + 1,
                posterStatus: result.posterStatus || null
              });
              pendingItems.push(item);
              uploadPending++;
            } else if (result.status === 'imagekit-hit') {
              records[item.id] = ledgerRecord(item, 'verified', {
                verifiedAt: new Date().toISOString(),
                verification: 'poster-service-cache-hit',
                posterStatus: result.posterStatus || null
              });
              verifiedCacheHits++;
            } else {
              records[item.id] = ledgerRecord(item, 'retry', {
                attempts: (Number(records[item.id]?.attempts) || 0) + 1,
                lastError: result.error || result.status
              });
            }
            return result;
          } catch (error) {
            records[item.id] = ledgerRecord(item, 'failed', {
              attempts: (Number(records[item.id]?.attempts) || 0) + 1,
              lastError: error?.message || 'unknown error'
            });
            throw error;
          }
        }, adaptivePrewarmConcurrency());

        for (const [status, count] of Object.entries(prewarmReport.counts)) {
          resultCounts[status] = (resultCounts[status] || 0) + count;
        }
        totalFailures += prewarmReport.failures;

        // Persist pending records before their asynchronous verification starts.
        // A restart can safely HEAD-check or retry only this incomplete batch.
        await persistShard();
        if (pendingItems.length) {
          inFlightVerifications.push(verifyPendingBatch([...pendingItems]));
        }
      }

      batchesProcessed++;
      postersVisited += batch.length;
      if (batchesProcessed % 4 === 0 || postersVisited === items.length) {
        const rss = Math.round(process.memoryUsage().rss / (1024 * 1024));
        console.log('[catalog-ledger-progress]', JSON.stringify({
          visited: postersVisited, total: items.length, batch: batchesProcessed,
          batchSize: batch.length, ledgerHits, verifiedUploads, verifiedCacheHits,
          uploadPending, failures: totalFailures, rssMiB: rss,
          prewarmConcurrency: adaptivePrewarmConcurrency(),
          verificationBatchesInFlight: inFlightVerifications.length
        }));
      }
    }

    await Promise.all(inFlightVerifications);
    await ledgerWriteChain;
    ledgerCache.clear();
  }
  const prewarmReport = { counts: resultCounts, failures: totalFailures };

  const report = {
    startedAt, finishedAt: new Date().toISOString(),
    manifests: manifests.map(m => ({ source: m.name || m.key, catalogs: m.catalogs.length })),
    catalogues: catalogues.map(c => ({
      source: c.source, type: c.type, id: c.id, name: c.name, pages: c.pages,
      records: c.records || 0, truncated: Boolean(c.truncated),
      skipped: Boolean(c.skipped), skippedDuplicate: Boolean(c.skippedDuplicate),
      duplicateOf: c.duplicateOf || null, resumed: Boolean(c.resumed),
      skipReason: c.skipReason || null, error: c.error || null
    })),
    cataloguesDiscovered: catalogues.length,
    cataloguesScannedThisRun,
    cataloguesResumed,
    cataloguesSkippedDuplicate,
    cataloguesSkippedDynamic: catalogues.filter(c => c.skipped).length,
    cataloguesFailed: catalogues.filter(c => c.error).length,
    uniqueTitles: items.length, newlyDiscovered, scanComplete,
    postersProcessed: postersVisited, postersSkippedFromLedger: ledgerHits, batchesProcessed,
    verifiedUploads, verifiedCacheHits, uploadsAwaitingVerification: uploadPending,
    failures: totalFailures, results: resultCounts
  };
  // Mark the checkpoint reusable only when both discovery and poster prewarm
  // finish cleanly. A subsequent scheduled run will start a fresh scan.
  if (scanComplete && totalFailures === 0 && !resultCounts.failed && !resultCounts.retry && !resultCounts['rendered-not-cached'] && !resultCounts['source-redirect']) {
    checkpoint = {
      version: 2, badgeRulesVersion: BADGE_RULES_VERSION,
      scanGeneration, forceRescanCatalogs: false, titleInventoryGeneration: scanGeneration,
      complete: true, updatedAt: new Date().toISOString(),
      completedCatalogues, titleFiles
    };
    await lease?.assertOwned?.();
    await writeJson(config, CHECKPOINT_PATH, checkpoint);
  }
  console.log('[catalog-refresh-complete]', JSON.stringify(report));
  return report;
}
