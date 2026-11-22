import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { withRefreshLease, publishRefreshProgress } from './refresh-coordination.mjs';
import { initializeImageKitStorageSnapshot } from './imagekit-storage.mjs';
import { persistDurableQueueSnapshot, loadDurableQueueSnapshot, claimDurableQueueBatch, settleDurableQueueBatch, getDurableQueueState } from './imagekit-durable-queue.mjs';
import { createBoundedTaskQueue, refreshResourcePolicy } from './refresh-backpressure.mjs';
import { classifyPrewarmResponse, isFreshVerifiedRecord, isSourceProbeCoolingDown, isSourceUnavailableCoolingDown, needsResumeVerification, SOURCE_PROBE_RETRY_COOLDOWN_MS, SOURCE_UNAVAILABLE_COOLDOWN_MS } from './catalog-prewarm-policy.mjs';

const MANIFEST_KEYS = [
  'CATALOG_MANIFEST_ELFHOSTED_URL',
  'CATALOG_MANIFEST_MIDNIGHTIGNITE_URL',
  'CATALOG_MANIFEST_XPERIENCE_URL'
];
const PAGE_SIZE = 100;
const MAX_PAGES = Math.max(1, Math.min(500, Number(process.env.CATALOG_SCAN_MAX_PAGES || 500)));
const CONCURRENCY = 1;
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
const PREWARM_BATCH_SIZE = Math.max(2, Math.min(10, Number(process.env.CATALOG_PREWARM_BATCH_SIZE) || 10));
const PAGE_CHECKPOINT_INTERVAL = 5;
const CATALOG_CHECKPOINT_INTERVAL = 5;
const PREWARM_CONCURRENCY = 1;
const VERIFY_CONCURRENCY = 1;
const CATALOGUE_CHECKPOINT_REUSE_TTL_MS = 24 * 60 * 60 * 1000;
let stateReadNonce = 0;

function ledgerShard(id) {
  return createHash('sha256').update(String(id)).digest('hex')[0];
}
function ledgerPath(shard) {
  return LEDGER_DIR + '/' + shard + '.json';
}
function itemFingerprint(item) {
  // Every provider/catalogue identity and badge-driving field participates.
  // Artwork URL changes, metadata corrections and new episode/release dates
  // therefore invalidate only the affected title's reusable ledger record.
  const identity = [
    item.id || '', item.providerId || '', item.catalogSource || '', item.catalogId || '',
    item.type || '', item.title || '', item.year || '',
    ...(Array.isArray(item.catalogSources) ? item.catalogSources.map(source => String(source.source || '') + ':' + String(source.id || '')).sort() : []),
    item.imdbId || '', item.tmdbId || '', item.tvdbId || '', item.tvmazeId || ''
  ];
  const artwork = [item.poster || '', item.artworkSource || String(item.poster || '').split('/').slice(0, 3).join('/')];
  const dateMetadata = [
    item.digitalReleaseDate || item.releaseDate || item.releaseInfo || '',
    item.nextEpisodeDate || '', item.season ?? '', item.episode ?? '', item.premiereDate || ''
  ];
  return createHash('sha256')
    .update([...identity, ...artwork, ...dateMetadata, 'badge-rules-' + BADGE_RULES_VERSION].join('|'))
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
  // State files are overwritten in ImageKit. A unique query string bypasses
  // stale CDN edge entries so a resumed worker reads the newest checkpoint.
  const url = new URL(config.endpoint + path);
  url.searchParams.set('_state_read', String(Date.now()) + '-' + (++stateReadNonce));
  try {
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(12000) });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error('ImageKit state read HTTP ' + response.status);
    const value = await response.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid persisted catalogue state');
    const lastModified = response.headers.get('last-modified');
    if (lastModified) Object.defineProperty(value, '__stateFileLastModified', { value: lastModified, enumerable: false });
    return value;
  } catch (error) {
    if (/HTTP 404/.test(error.message)) return null;
    throw error;
  }
}
async function writeJson(config, path, value) {
  const serialized = JSON.stringify(value);
  // readState uses a nonce to bypass stale CDN responses; skip identical uploads.
  const existing = await readState(config, path);
  if (existing && JSON.stringify(existing) === serialized) return { filePath: path, unchanged: true };
  const form = new FormData();
  const bytes = Buffer.from(serialized);
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

export function isExplicitlyDeferredCatalogueCheckpoint(entry, catalog, scanGeneration) {
  if (!entry || entry.status !== 'deferred' ||
      entry.reason !== 'required-extra-options-unavailable' ||
      entry.scanGeneration !== String(scanGeneration)) return false;
  const expected = unresolvedRequiredExtras(catalog).sort();
  const recorded = Array.isArray(entry.requiredExtras)
    ? entry.requiredExtras.map(String).sort() : [];
  return expected.length > 0 && expected.length === recorded.length &&
    expected.every((name, index) => name === recorded[index]);
}

export function isCatalogueScanComplete(catalogues) {
  return Array.isArray(catalogues) && catalogues.every(catalogue =>
    !catalogue.error && !catalogue.truncated &&
    (!catalogue.skipped || catalogue.skippedDuplicate === true || catalogue.deferred === true)
  );
}

export function excludeDeferredQueueItems(queueItems, deferredIds) {
  const excluded = deferredIds instanceof Set ? deferredIds : new Set(deferredIds || []);
  return (Array.isArray(queueItems) ? queueItems : [])
    .filter(item => item && !excluded.has(String(item.id)));
}

function catalogueCheckpointPath(fingerprint) {
  const key = createHash('sha256').update(fingerprint).digest('hex').slice(0, 24);
  return CATALOG_CHECKPOINT_DIR + '/' + key + '.json';
}

export function shouldPersistCataloguePageCheckpoint(pages, done, interval = PAGE_CHECKPOINT_INTERVAL) {
  const safeInterval = Math.max(1, Math.floor(Number(interval) || PAGE_CHECKPOINT_INTERVAL));
  return done === true || (Number.isInteger(pages) && pages > 0 && pages % safeInterval === 0);
}

export function shouldPersistCatalogueInventoryCheckpoint(completedCount, interval = CATALOG_CHECKPOINT_INTERVAL) {
  const safeInterval = Math.max(1, Math.floor(Number(interval) || CATALOG_CHECKPOINT_INTERVAL));
  return Number.isInteger(completedCount) && completedCount > 0 && completedCount % safeInterval === 0;
}

export function canReuseCatalogueCheckpoint(existing, scanGeneration, forceRescan = false, now = Date.now()) {
  if (forceRescan || !existing || existing.version !== 1 ||
      !Number.isInteger(existing.nextPage) || !Number.isInteger(existing.pages) ||
      !Number.isInteger(existing.records) || !Array.isArray(existing.seenPageIds) ||
      !existing.titles || typeof existing.titles !== 'object' || Array.isArray(existing.titles)) return false;
  if (existing.scanGeneration === scanGeneration) return true;
  // A completed catalogue snapshot must never stand in for today's provider
  // fetch. Only an interrupted/incomplete page checkpoint is resumable across
  // scan generations; it is bounded to 24 hours and retains its page cursor.
  if (existing.complete === true) return false;
  const timestamp = Date.parse(existing.updatedAt || existing.__stateFileLastModified || '');
  if (!Number.isFinite(timestamp)) return false;
  const age = now - timestamp;
  return age >= 0 && age <= CATALOGUE_CHECKPOINT_REUSE_TTL_MS;
}

async function collectCatalog(manifest, catalog, config, fingerprint, lease, scanGeneration, forceRescan = false) {
  const path = catalogueCheckpointPath(fingerprint);
  const existing = await readState(config, path);
  // Reuse same-generation page state, and adopt validated recent snapshots
  // from an earlier generation. This preserves completed catalogues and
  // partial page cursors when a top-level checkpoint is recreated.
  const canReuse = canReuseCatalogueCheckpoint(existing, scanGeneration, forceRescan);
  const saved = canReuse ? { ...existing, scanGeneration } : null;
  const adoptedFromGeneration = canReuse && existing?.scanGeneration !== scanGeneration
    ? (existing?.scanGeneration || 'legacy') : null;
  const titles = new Map();
  if (saved?.titles && typeof saved.titles === 'object') {
    for (const [id, item] of Object.entries(saved.titles)) {
      if (item && item.id === id) titles.set(id, { ...item, catalogSource: item.catalogSource || String(manifest.name || manifest.key || ''), catalogId: item.catalogId || String(catalog.id || '') });
    }
  }
  const seenPageIds = new Set(Array.isArray(saved?.seenPageIds) ? saved.seenPageIds : []);
  let pages = Number.isInteger(saved?.pages) ? saved.pages : 0;
  let uniqueRecords = Number.isInteger(saved?.records) ? saved.records : 0;
  let lastBatchSize = 0;
  let lastPageNewIds = 0;
  if (saved && adoptedFromGeneration) {
    await lease?.assertOwned?.();
    await writeJson(config, path, {
      ...saved, scanGeneration, updatedAt: new Date().toISOString(),
      adoptedFromScanGeneration: adoptedFromGeneration
    });
    console.info('[catalog-page-checkpoint-adopted]', JSON.stringify({
      source: manifest.name, type: catalog.type, id: catalog.id,
      fromGeneration: adoptedFromGeneration, nextPage: saved.nextPage,
      complete: saved.complete === true, records: saved.records
    }));
  }
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
        const videos = Array.isArray(meta.videos) ? meta.videos : [];
        const nextEpisode = videos
          .filter(video => /^\d{4}-\d{2}-\d{2}$/.test(String(video?.released || video?.airdate || '')))
          .map(video => ({
            date: String(video.released || video.airdate),
            season: Number.isFinite(Number(video.season)) ? Number(video.season) : null,
            episode: Number.isFinite(Number(video.episode)) ? Number(video.episode) : null
          }))
          .sort((a, b) => a.date.localeCompare(b.date))[0] || null;
        titles.set(id, {
          id,
          type: catalog.type,
          catalogSource: String(manifest.name || manifest.key || ''),
          catalogId: String(catalog.id || ''),
          providerId: String(meta.id || ''),
          title: String(meta.name || meta.title || ''),
          poster: String(meta.poster || ''),
          year: meta.year || meta.releaseInfo?.year || '',
          releaseInfo: typeof meta.releaseInfo === 'string' ? meta.releaseInfo : '',
          digitalReleaseDate: meta.digitalReleaseDate || meta.releaseDate || '',
          premiereDate: meta.premiered || '',
          nextEpisodeDate: nextEpisode?.date || '',
          season: nextEpisode?.season ?? '',
          episode: nextEpisode?.episode ?? '',
          tmdbId: meta.tmdb_id || meta.tmdbId || '',
          tvdbId: meta.tvdb_id || meta.tvdbId || '',
          tvmazeId: meta.tvmaze_id || meta.tvmazeId || '',
          artworkSource: String(meta.poster || '').split('/').slice(0, 3).join('/')
        });
      }
    }
    lastBatchSize = batch.length;
    lastPageNewIds = newIds;
    pages++;
    const done = batch.length < PAGE_SIZE || (page > 0 && newIds === 0) || page + 1 >= MAX_PAGES;
    // Persist every fifth page and always persist completion. If interrupted
    // between checkpoints, at most four pages are safely re-fetched on resume.
    if (shouldPersistCataloguePageCheckpoint(pages, done)) {
      await lease?.assertOwned?.();
      await writeJson(config, path, {
        version: 1, scanGeneration, complete: done, nextPage: page + 1, pages, records: uniqueRecords,
        updatedAt: new Date().toISOString(),
        seenPageIds: [...seenPageIds], titles: Object.fromEntries(titles)
      });
    }
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
export function mergeCatalogSourceItem(existing, incoming) {
  const base = existing && typeof existing === 'object' ? existing : {};
  const next = incoming && typeof incoming === 'object' ? incoming : {};
  const sources = [
    ...(Array.isArray(base.catalogSources) ? base.catalogSources : []),
    ...(Array.isArray(next.catalogSources) ? next.catalogSources : []),
    { source: next.catalogSource, id: next.catalogId }
  ];
  const unique = new Map();
  for (const source of sources) {
    const normalized = {
      source: String(source?.source || '').trim(),
      id: String(source?.id || '').trim()
    };
    if (!normalized.source && !normalized.id) continue;
    unique.set(normalized.source + '|' + normalized.id, normalized);
  }
  // Keep the first useful metadata values, but never discard source coverage.
  return {
    ...next,
    ...base,
    catalogSources: [...unique.values()].sort((a, b) =>
      (a.source + '|' + a.id).localeCompare(b.source + '|' + b.id)
    )
  };
}


export function validateMetadataIndexChunk(chunk, expected) {
  if (!chunk || chunk.version !== 1 || chunk.scanGeneration !== expected.scanGeneration ||
      chunk.index !== expected.index || !Array.isArray(chunk.records) ||
      chunk.count !== chunk.records.length) return false;
  const actual = createHash('sha256').update(JSON.stringify(chunk.records)).digest('hex');
  return actual === chunk.sha256 && actual === expected.sha256 &&
    chunk.count === expected.count;
}

export function mergeIncrementalMetadataItem(existing, incoming) {
  const base = existing && typeof existing === 'object' ? existing : {};
  const next = incoming && typeof incoming === 'object' ? incoming : {};
  const merged = { ...base };
  for (const [key, value] of Object.entries(next)) {
    if (key === 'catalogSources' || key === 'fingerprint') continue;
    if (value !== undefined && value !== null && value !== '') merged[key] = value;
  }
  const sources = [
    ...(Array.isArray(base.catalogSources) ? base.catalogSources : []),
    ...(Array.isArray(next.catalogSources) ? next.catalogSources : []),
    { source: next.catalogSource, id: next.catalogId }
  ];
  const unique = new Map();
  for (const source of sources) {
    const normalized = { source: String(source?.source || '').trim(), id: String(source?.id || '').trim() };
    if (normalized.source || normalized.id) unique.set(normalized.source + '|' + normalized.id, normalized);
  }
  merged.catalogSources = [...unique.values()].sort((a, b) =>
    (a.source + '|' + a.id).localeCompare(b.source + '|' + b.id));
  merged.fingerprint = itemFingerprint(merged);
  return merged;
}

export function mergeIncrementalMetadata(baselineItems, observedItems) {
  const merged = new Map((baselineItems || []).filter(item => item?.id).map(item => [item.id, { ...item }]));
  const delta = new Map();
  let added = 0;
  let changed = 0;
  for (const incoming of observedItems || []) {
    if (!incoming?.id) continue;
    const existing = merged.get(incoming.id);
    const next = mergeIncrementalMetadataItem(existing, incoming);
    const nextFingerprint = itemFingerprint(next);
    if (!existing) {
      added++;
      delta.set(next.id, { ...next, fingerprint: nextFingerprint, deltaStatus: 'new' });
    } else if (String(existing.fingerprint || itemFingerprint(existing)) !== nextFingerprint) {
      changed++;
      delta.set(next.id, { ...next, fingerprint: nextFingerprint, deltaStatus: 'changed' });
    }
    next.fingerprint = nextFingerprint;
    merged.set(next.id, next);
  }
  return {
    items: [...merged.values()].sort((a, b) => a.id.localeCompare(b.id)),
    delta: [...delta.values()].sort((a, b) => a.id.localeCompare(b.id)),
    added, changed
  };
}

async function readMetadataStateWithRetry(config, path, attempts = 5) {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const value = await readState(config, path);
      if (value) return value;
      lastError = new Error('metadata state file is not visible on CDN yet');
    } catch (error) {
      lastError = error;
    }
    if (attempt + 1 < attempts) await sleep(Math.min(4000, 500 * (2 ** attempt)));
  }
  throw new Error('Metadata index readback failed for ' + path + ': ' + (lastError?.message || 'not visible'));
}

export async function loadMetadataIndexChunks(chunks, {
  scanGeneration, generationKey, readChunk, concurrency = 4
} = {}) {
  if (!Array.isArray(chunks) || typeof readChunk !== 'function') {
    throw new Error('Metadata index chunk loader requires descriptors and a read function');
  }
  const width = Math.max(1, Math.min(8, Number(concurrency) || 4));
  const records = [];
  for (let offset = 0; offset < chunks.length; offset += width) {
    const batch = chunks.slice(offset, offset + width);
    const loaded = await Promise.all(batch.map(async (descriptor, localIndex) => {
      const index = offset + localIndex;
      const expectedPath = '/catalog-state/metadata-index/v1/' + generationKey +
        '/chunk-' + String(index).padStart(5, '0') + '.json';
      if (!descriptor || descriptor.path !== expectedPath ||
          !Number.isInteger(descriptor.count) || descriptor.count < 0 ||
          !/^[a-f0-9]{64}$/.test(String(descriptor.sha256 || ''))) {
        throw new Error('Metadata index chunk descriptor is invalid at index ' + index);
      }
      let chunk;
      try {
        chunk = await readChunk(descriptor, index);
      } catch (error) {
        throw new Error('Metadata index chunk read failed at index ' + index + ': ' +
          (error?.message || 'unknown read error'));
      }
      if (!validateMetadataIndexChunk(chunk, {
        scanGeneration, index, count: descriptor.count, sha256: descriptor.sha256
      })) throw new Error('Published metadata-index chunk checksum failed at index ' + index);
      return chunk.records;
    }));
    records.push(...loaded.flat());
  }
  return records;
}

async function loadPublishedMetadataIndex(config) {
  const latest = await readMetadataStateWithRetry(config, '/catalog-state/metadata-index/latest.json');
  if (!latest || latest.version !== 1 ||
      typeof latest.scanGeneration !== 'string' ||
      typeof latest.manifestPath !== 'string' ||
      !/^[/]catalog-state[/]metadata-index[/]v1[/][a-f0-9]{24}[/]manifest[.]json$/.test(latest.manifestPath)) {
    throw new Error('Incremental scan requires a valid published metadata-index baseline; run a full discovery first');
  }
  const manifest = await readMetadataStateWithRetry(config, latest.manifestPath);
  if (!manifest || manifest.version !== 1 ||
      manifest.schema !== 'great-indian-normalized-metadata-index' ||
      manifest.scanGeneration !== latest.scanGeneration ||
      manifest.generationKey !== latest.generationKey ||
      latest.manifestPath !== '/catalog-state/metadata-index/v1/' + manifest.generationKey + '/manifest.json' ||
      !Array.isArray(manifest.chunks)) {
    throw new Error('Published metadata-index manifest is invalid; incremental scan refused');
  }
  const items = await loadMetadataIndexChunks(manifest.chunks, {
    scanGeneration: manifest.scanGeneration,
    generationKey: manifest.generationKey,
    concurrency: 4,
    readChunk: descriptor => readMetadataStateWithRetry(config, descriptor.path)
  });
  if (items.length !== manifest.itemCount ||
      manifest.chunks.length !== manifest.chunkCount ||
      latest.itemCount !== manifest.itemCount || latest.chunkCount !== manifest.chunkCount) {
    throw new Error('Published metadata-index item or chunk totals do not match');
  }
  return { items, manifest };
}

function incrementalMetadataItem(meta, manifest, catalog) {
  const id = canonicalId(meta);
  if (!id) return null;
  const videos = Array.isArray(meta.videos) ? meta.videos : [];
  const nextEpisode = videos
    .filter(video => /^\d{4}-\d{2}-\d{2}$/.test(String(video?.released || video?.airdate || '')))
    .map(video => ({
      date: String(video.released || video.airdate),
      season: Number.isFinite(Number(video.season)) ? Number(video.season) : null,
      episode: Number.isFinite(Number(video.episode)) ? Number(video.episode) : null
    }))
    .sort((a, b) => a.date.localeCompare(b.date))[0] || null;
  const item = {
    id, type: catalog.type,
    catalogSource: String(manifest.name || manifest.key || ''),
    catalogId: String(catalog.id || ''),
    providerId: String(meta.id || ''),
    title: String(meta.name || meta.title || ''),
    poster: String(meta.poster || ''),
    year: meta.year || meta.releaseInfo?.year || '',
    releaseInfo: typeof meta.releaseInfo === 'string' ? meta.releaseInfo : '',
    digitalReleaseDate: meta.digitalReleaseDate || meta.releaseDate || '',
    premiereDate: meta.premiered || '',
    nextEpisodeDate: nextEpisode?.date || '',
    season: nextEpisode?.season ?? '',
    episode: nextEpisode?.episode ?? '',
    imdbId: meta.imdb_id || meta.imdbId || (/^tt\d{7,10}$/i.test(String(meta.id || '')) ? String(meta.id).toLowerCase() : ''),
    tmdbId: meta.tmdb_id || meta.tmdbId || '',
    tvdbId: meta.tvdb_id || meta.tvdbId || '',
    tvmazeId: meta.tvmaze_id || meta.tvmazeId || '',
    artworkSource: String(meta.poster || '').split('/').slice(0, 3).join('/'),
    catalogSources: [{ source: String(manifest.name || manifest.key || ''), id: String(catalog.id || '') }]
  };
  item.fingerprint = itemFingerprint(item);
  return item;
}

export async function collectIncrementalCatalogues(manifests, {
  fetchPage, baselineIds = new Set(), pageLimit = 1, maxCatalogues = 500, lease
} = {}) {
  if (typeof fetchPage !== 'function') throw new Error('Incremental scanner requires a page fetch function');
  const safePageLimit = Math.max(1, Math.min(3, Number(pageLimit) || 1));
  const safeCatalogueLimit = Math.max(1, Math.min(1000, Number(maxCatalogues) || 500));
  const totalCatalogues = manifests.reduce((sum, manifest) => sum + manifest.catalogs.length, 0);
  if (totalCatalogues > safeCatalogueLimit) {
    throw new Error('Incremental scan catalogue limit exceeded (' + totalCatalogues + ' > ' + safeCatalogueLimit + '); refusing partial index publication');
  }
  const observed = new Map();
  const sourceStats = [];
  let pagesFetched = 0;
  let recordsFetched = 0;
  for (const manifest of manifests) {
    let sourceCatalogues = 0;
    let skippedDynamic = 0;
    for (const catalog of manifest.catalogs) {
      if (unresolvedRequiredExtras(catalog).length) {
        skippedDynamic++;
        continue;
      }
      let sourcePages = 0;
      for (let page = 0; page < safePageLimit; page++) {
        await lease?.assertOwned?.();
        const data = await fetchPage(manifest, catalog, page * PAGE_SIZE);
        const batch = Array.isArray(data.metas) ? data.metas : [];
        pagesFetched++;
        sourcePages++;
        recordsFetched += batch.length;
        for (const meta of batch) {
          const item = incrementalMetadataItem(meta, manifest, catalog);
          if (!item) continue;
          observed.set(item.id, observed.has(item.id)
            ? mergeIncrementalMetadataItem(observed.get(item.id), item)
            : item);
        }
        const hasUnknown = batch.some(meta => {
          const id = canonicalId(meta);
          return id && !baselineIds.has(id);
        });
        if (batch.length < PAGE_SIZE || (page > 0 && !hasUnknown)) break;
      }
      sourceCatalogues++;
    }
    sourceStats.push({ source: manifest.name, catalogues: sourceCatalogues, skippedDynamic });
  }
  return { observed: [...observed.values()], sourceStats, pagesFetched, recordsFetched, totalCatalogues };
}

async function runIncrementalMetadataScan(lease) {
  updateRefreshProgress({ status: 'running', stage: 'incremental-metadata-scan', mode: 'incremental-discovery' });
  const configured = MANIFEST_KEYS.filter(key => process.env[key]);
  if (configured.length !== MANIFEST_KEYS.length) {
    throw new Error('Incremental scan requires all three configured manifests; refusing partial coverage');
  }
  const config = imageKitConfig();
  const baseline = await loadPublishedMetadataIndex(config);
  const manifests = await Promise.all(MANIFEST_KEYS.map(readManifest));
  if (manifests.some(manifest => !manifest.configured || !manifest.catalogs.length)) {
    throw new Error('One or more configured manifests returned no catalogues; incremental scan refused');
  }
  const maxCatalogues = Math.max(1, Math.min(1000, Number(process.env.CATALOG_INCREMENTAL_MAX_CATALOGUES || 500)));
  const pageLimit = Math.max(1, Math.min(3, Number(process.env.CATALOG_INCREMENTAL_PAGES_PER_CATALOG || 1)));
  const baselineIds = new Set(baseline.items.map(item => item.id));
  const scan = await collectIncrementalCatalogues(manifests, {
    baselineIds, pageLimit, maxCatalogues, lease,
    fetchPage: (manifest, catalog, skip) => fetchJson(catalogUrl(manifest.base, catalog, skip))
  });
  const observed = new Map(scan.observed.map(item => [item.id, item]));
  const { sourceStats, pagesFetched, recordsFetched } = scan;
  if (!observed.size) throw new Error('Incremental scan found no supported catalogue IDs; baseline left unchanged');
  const result = mergeIncrementalMetadata(baseline.items, [...observed.values()]);
  const scanGeneration = 'incremental-' + new Date().toISOString().replace(/[:.]/g, '-');
  const deltaPath = '/catalog-state/metadata-index/deltas/' + scanGeneration + '.json';
  const deltaRecords = result.delta;
  const deltaSerialized = JSON.stringify(deltaRecords);
  const delta = {
    version: 1, schema: 'great-indian-metadata-index-delta',
    scanGeneration, baselineGeneration: baseline.manifest.scanGeneration,
    createdAt: new Date().toISOString(),
    sourceStats, pagesFetched, recordsFetched,
    baselineItemCount: baseline.items.length,
    itemCount: result.items.length, added: result.added, changed: result.changed,
    deltaCount: deltaRecords.length,
    sha256: createHash('sha256').update(deltaSerialized).digest('hex'),
    records: deltaRecords
  };
  await lease?.assertOwned?.();
  await writeJson(config, deltaPath, delta);
  // Publish the new index and switch its latest pointer only after the delta is durable.
  const manifest = await publishSharedMetadataIndex(result.items, scanGeneration, config, lease);
  console.info('[incremental-metadata-index-published]', JSON.stringify({
    scanGeneration, baselineGeneration: baseline.manifest.scanGeneration,
    sourceStats, pagesFetched, recordsFetched, itemCount: result.items.length,
    added: result.added, changed: result.changed, deltaCount: deltaRecords.length
  }));
  const report = {
    status: 'incremental-metadata-complete',
    mode: 'incremental-discovery',
    scanGeneration,
    baselineGeneration: baseline.manifest.scanGeneration,
    manifestsScanned: manifests.length,
    sourceStats, pagesFetched, recordsFetched,
    baselineItemCount: baseline.items.length,
    itemCount: result.items.length,
    added: result.added, changed: result.changed,
    deltaCount: deltaRecords.length,
    metadataManifestPath: '/catalog-state/metadata-index/v1/' + manifest.generationKey + '/manifest.json',
    deltaPath
  };
  updateRefreshProgress({
    status: 'completed', stage: 'incremental-metadata-complete',
    cataloguesDiscovered: scan.totalCatalogues, cataloguesScanned: scan.totalCatalogues,
    titlesDiscovered: result.items.length, titlesNewThisRun: result.added,
    report, finishedAt: new Date().toISOString()
  });
  return report;
}

async function publishSharedMetadataIndex(items, scanGeneration, config, lease) {
  const root = '/catalog-state/metadata-index/v1';
  const generationKey = createHash('sha256').update(String(scanGeneration)).digest('hex').slice(0, 24);
  const generationRoot = root + '/' + generationKey;
  const manifestPath = generationRoot + '/manifest.json';
  const existing = await readState(config, manifestPath);
  if (existing) {
    if (existing.version !== 1 || existing.scanGeneration !== String(scanGeneration)) {
      throw new Error('Shared metadata index generation is malformed; refusing overwrite');
    }
    await lease?.assertOwned?.();
    await writeJson(config, '/catalog-state/metadata-index/latest.json', {
      version: 1, scanGeneration: String(scanGeneration),
      generationKey, manifestPath, itemCount: existing.itemCount,
      chunkCount: existing.chunkCount, updatedAt: new Date().toISOString()
    });
    const verified = await loadPublishedMetadataIndex(config);
    if (verified.manifest.scanGeneration !== String(scanGeneration)) {
      throw new Error('Published metadata index readback resolved the wrong generation');
    }
    return existing;
  }
  const normalized = items
    .filter(item => item && typeof item.id === 'string' && item.id)
    .map(item => ({
      id: item.id, type: String(item.type || ''),
      title: String(item.title || ''), year: String(item.year || ''),
      imdbId: metadataIndexImdbId(item),
      tmdbId: String(item.tmdbId || ''), tvdbId: String(item.tvdbId || ''),
      tvmazeId: String(item.tvmazeId || ''),
      providerId: String(item.providerId || ''),
      catalogSource: String(item.catalogSource || ''),
      catalogId: String(item.catalogId || ''),
      catalogSources: (Array.isArray(item.catalogSources) ? item.catalogSources : [
        { source: item.catalogSource, id: item.catalogId }
      ]).map(source => ({
        source: String(source?.source || '').trim(),
        id: String(source?.id || '').trim()
      })).filter(source => source.source || source.id)
        .filter((source, index, all) => all.findIndex(candidate =>
          candidate.source === source.source && candidate.id === source.id
        ) === index)
        .sort((a, b) => (a.source + '|' + a.id).localeCompare(b.source + '|' + b.id)),
      poster: String(item.poster || ''),
      releaseDate: String(item.digitalReleaseDate || item.releaseInfo || ''),
      premiereDate: String(item.premiereDate || ''),
      nextEpisodeDate: String(item.nextEpisodeDate || ''),
      season: item.season ?? null, episode: item.episode ?? null,
      fingerprint: itemFingerprint(item)
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const chunkSize = 250;
  const chunks = [];
  for (let offset = 0; offset < normalized.length; offset += chunkSize) {
    const records = normalized.slice(offset, offset + chunkSize);
    const index = chunks.length;
    const path = generationRoot + '/chunk-' + String(index).padStart(5, '0') + '.json';
    const serialized = JSON.stringify(records);
    const sha256 = createHash('sha256').update(serialized).digest('hex');
    await lease?.assertOwned?.();
    await writeJson(config, path, { version: 1, scanGeneration: String(scanGeneration), index, count: records.length, sha256, records });
    chunks.push({ path, count: records.length, sha256 });
  }
  const manifest = {
    version: 1, schema: 'great-indian-normalized-metadata-index',
    scanGeneration: String(scanGeneration), generationKey,
    createdAt: new Date().toISOString(), itemCount: normalized.length,
    chunkCount: chunks.length, chunks
  };
  await lease?.assertOwned?.();
  await writeJson(config, manifestPath, manifest);
  // The latest pointer is committed last, after every immutable chunk and manifest is durable.
  await lease?.assertOwned?.();
  await writeJson(config, '/catalog-state/metadata-index/latest.json', {
    version: 1, scanGeneration: String(scanGeneration), generationKey,
    manifestPath, itemCount: normalized.length, chunkCount: chunks.length,
    updatedAt: new Date().toISOString()
  });
  const verified = await loadPublishedMetadataIndex(config);
  if (verified.manifest.scanGeneration !== String(scanGeneration) ||
      verified.items.length !== normalized.length) {
    throw new Error('Published metadata index failed full chunk readback validation');
  }
  console.info('[shared-metadata-index-published]', JSON.stringify({
    scanGeneration, itemCount: normalized.length, chunkCount: chunks.length, storage: 'imagekit'
  }));
  return manifest;
}

function catalogueFingerprint(catalog) {
  // Stremio catalogue IDs are the stable identity shared by cloned metadata
  // instances. Keep media type in the key because movie/series IDs can overlap.
  return String(catalog.type || '').trim().toLowerCase() + '|' + String(catalog.id || '').trim().toLowerCase();
}

export function metadataIndexImdbId(item) {
  const explicit = String(item?.imdbId || item?.imdb_id || '').trim();
  if (/^tt\d{7,10}$/i.test(explicit)) return explicit.toLowerCase();
  const id = String(item?.id || '').trim();
  return /^tt\d{7,10}$/i.test(id) ? id.toLowerCase() : '';
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
  // Image/OCR generation remains serial on the 512 MiB Render Free instance.
  return 1;
}

async function waitForImageWorkHeadroom() {
  let rssMiB = process.memoryUsage().rss / (1024 * 1024);
  let policy = refreshResourcePolicy(rssMiB);
  if (policy.runGc && global.gc) global.gc();
  if (policy.pauseImageWork) {
    console.warn('[catalog-memory-backpressure]', JSON.stringify({ rssMiB: Math.round(rssMiB), action: 'pause-image-work' }));
    // Do not start another image/OCR request close to Render's hard limit.
    for (let attempt = 0; attempt < 15; attempt++) {
      await sleep(2000);
      rssMiB = process.memoryUsage().rss / (1024 * 1024);
      policy = refreshResourcePolicy(rssMiB);
      if (!policy.pauseImageWork) break;
      if (global.gc) global.gc();
    }
    if (policy.pauseImageWork) {
      throw new Error('Refresh paused safely: RSS remained at or above 450 MiB; checkpoint is preserved for resume');
    }
  }
  return policy;
}

async function runPool(items, worker, concurrency = CONCURRENCY, onFailure = null) {
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
        if (typeof onFailure === 'function') onFailure(items[index], result.error);
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
async function checkImageKit(idOrUrl) {
  const endpoint = String(process.env.IMAGEKIT_URL_ENDPOINT || '').replace(/\/$/, '');
  if (!endpoint) return false;
  try {
    let verificationUrl;
    if (/^https:\/\//i.test(String(idOrUrl || ''))) {
      const supplied = new URL(String(idOrUrl));
      const expected = new URL(endpoint);
      const posterPrefix = expected.pathname.replace(/\/$/, '') + '/posters/';
      if (supplied.origin !== expected.origin || !supplied.pathname.startsWith(posterPrefix) ||
          !/\.jpe?g$/i.test(supplied.pathname)) return false;
      verificationUrl = supplied.toString();
    } else {
      const storageId = imageKitStorageId(String(idOrUrl));
      verificationUrl = endpoint + '/posters/' + encodeURIComponent(storageId) + '.jpg';
    }
    const response = await fetch(verificationUrl, { method: 'HEAD', cache: 'no-store', signal: AbortSignal.timeout(6000) });
    return response.ok && (response.headers.get('content-type') || '').toLowerCase().startsWith('image/');
  } catch { return false; }
}
async function waitForImageKit(id, timeoutMs = 90000) {
  // Upload acceptance and CDN visibility are separate events. Poll the stable
  // asset URL with bounded exponential backoff; never re-upload just because
  // the first edge check is early.
  const deadline = Date.now() + Math.max(0, timeoutMs);
  let delay = 1500;
  do {
    if (await checkImageKit(id)) return true;
    if (Date.now() >= deadline) break;
    await sleep(Math.min(delay, Math.max(0, deadline - Date.now())));
    delay = Math.min(8000, Math.round(delay * 1.5));
  } while (Date.now() < deadline);
  return false;
}
async function prewarm(item, knownImageKitCheck = null) {
  const path = posterPath(item.id, item.type);
  if (!path) return { id: item.id, status: 'unsupported-id-format' };
  const requestPath = item.poster
    ? path + (path.includes('?') ? '&' : '?') + 'fallback=' + encodeURIComponent(item.poster)
    : path;
  const endpoint = (process.env.POSTER_SERVICE_URL || 'https://great-indian-upcoming-posters.onrender.com').replace(/\/$/, '');

  // A prior request may have completed its upload even when its HTTP response
  // was lost. Never issue another generation request until the canonical asset
  // has been checked.
  if (knownImageKitCheck === true) return { id: item.id, status: 'imagekit-hit' };
  if (knownImageKitCheck !== false && await checkImageKit(item.id)) return { id: item.id, status: 'imagekit-hit' };

  try {
    const response = await fetch(endpoint + requestPath, {
      headers: { accept: 'image/*' }, redirect: 'manual', signal: AbortSignal.timeout(30000)
    });
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    const location = response.headers.get('location') || '';
    const storage = response.headers.get('x-imagekit-storage') || 'not-stored';
    const fallbackReason = response.headers.get('x-poster-fallback-reason') || '';
    const posterStatus = response.headers.get('x-poster-date-status') || 'rendered';
    const imageKitBase = (process.env.IMAGEKIT_URL_ENDPOINT || '').replace(/\/$/, '') + '/posters/';
    const decision = classifyPrewarmResponse({
      status: response.status, contentType, location, imageKitBase, storage, fallbackReason
    });
    await response.body?.cancel().catch(() => {});

    if (decision.status === 'source-unavailable') {
      return {
        id: item.id, status: 'source-unavailable',
        retryAfterMs: decision.cooldownMs || SOURCE_UNAVAILABLE_COOLDOWN_MS,
        error: fallbackReason || 'Poster service confirmed that no usable poster source is currently available'
      };
    }
    if (decision.status === 'source-probe-failed') {
      const error = fallbackReason || 'Poster service returned HTTP ' + response.status;
      console.warn('[catalog-source-probe-deferred]', JSON.stringify({
        id: item.id, httpStatus: response.status, storage,
        fallbackReason: error.slice(0, 240), retryAfterMs: decision.cooldownMs || SOURCE_PROBE_RETRY_COOLDOWN_MS
      }));
      return {
        id: item.id, status: 'source-probe-failed',
        retryAfterMs: decision.cooldownMs || SOURCE_PROBE_RETRY_COOLDOWN_MS,
        error
      };
    }
    if (decision.status === 'failed') {
      throw new Error('Poster service returned HTTP ' + response.status + (contentType ? ' (' + contentType + ')' : ''));
    }
    if (decision.status === 'retry') {
      return { id: item.id, status: 'retry', error: 'Poster service returned HTTP ' + response.status };
    }
    if (decision.status === 'source-redirect') {
      return { id: item.id, status: 'source-redirect', error: 'Poster service redirected to its source provider' };
    }
    if (decision.status === 'upload-pending') {
      // TMDB/TVmaze routes may resolve to an IMDb-keyed ImageKit asset. Verify
      // the exact redirected CDN URL rather than a synthetic tmdb-/tvmaze- key.
      let verificationUrl = null;
      let locationDetails = null;
      try {
        const parsedLocation = new URL(location);
        locationDetails = { host: parsedLocation.host, path: parsedLocation.pathname };
        const configured = new URL(imageKitBase);
        const prefix = configured.pathname.replace(/\/$/, '') + '/';
        if (parsedLocation.origin === configured.origin && parsedLocation.pathname.startsWith(prefix) &&
            /\.jpe?g$/i.test(parsedLocation.pathname)) verificationUrl = parsedLocation.toString();
      } catch {}
      if (await checkImageKit(verificationUrl || item.id)) return { id: item.id, status: 'imagekit-hit', posterStatus };
      console.info('[catalog-prewarm-upload-pending]', JSON.stringify({
        id: item.id,
        posterServiceHost: new URL(endpoint).host,
        httpStatus: response.status,
        storage,
        contentType,
        fallbackReason: fallbackReason.slice(0, 240),
        location: locationDetails,
        decisionReason: decision.reason,
        verificationTimeoutMs: decision.verificationTimeoutMs,
        uploadAccepted: decision.reason === 'imagekit-upload-pending'
      }));
      return {
        id: item.id, status: 'upload-pending', posterStatus,
        verificationUrl,
        verificationTimeoutMs: decision.verificationTimeoutMs,
        uploadAccepted: decision.reason === 'imagekit-upload-pending',
        error: 'Upload outcome requires asynchronous ImageKit visibility verification'
      };
    }

    if (await checkImageKit(item.id)) return { id: item.id, status: 'imagekit-hit', posterStatus };
    // The service returned a valid image but did not confirm ImageKit storage.
    // Do not repeat OCR/render work in this run; leave it for a later retry.
    return { id: item.id, status: 'rendered-not-cached', posterStatus,
      error: 'Poster rendered without a confirmed ImageKit cache asset' };
  } catch (error) {
    if (/Poster service returned HTTP /.test(error?.message || '')) throw error;
    // A transport timeout/reset is an uncertain outcome: the origin may have
    // completed its upload. Check once, then defer to the asynchronous verifier.
    if (await checkImageKit(item.id)) return { id: item.id, status: 'imagekit-hit' };
    return {
      id: item.id, status: 'upload-pending', verificationTimeoutMs: 20000,
      error: 'Poster request ended with an uncertain transport outcome: ' + (error?.message || 'unknown error')
    };
  }
}
let activeRefreshPromise = null;
let activeRefreshProgress = null;
let activeRefreshJobId = null;
let progressWriteChain = Promise.resolve();

export function getManifestCatalogRefreshProgress() {
  if (!activeRefreshProgress) return null;
  const snapshot = structuredClone(activeRefreshProgress);
  const started = Date.parse(snapshot.startedAt || '');
  if (Number.isFinite(started)) snapshot.elapsedSeconds = Math.max(0, Math.round((Date.now() - started) / 1000));
  const total = Number(snapshot.postersTargeted) || 0;
  const done = Math.min(total, Number(snapshot.postersVisited) || 0);
  snapshot.completionPercent = total
    ? Math.round(done / total * 1000) / 10
    : snapshot.stage === 'completed' ? 100 : 0;
  return snapshot;
}

function queueRefreshProgressWrite() {
  if (!activeRefreshJobId || !activeRefreshProgress) return;
  const jobId = activeRefreshJobId;
  const snapshot = getManifestCatalogRefreshProgress();
  progressWriteChain = progressWriteChain
    .then(() => publishRefreshProgress(jobId, snapshot))
    .catch(error => console.warn('[catalog-progress-publish-failed]', error?.message || 'unknown error'));
}

async function flushRefreshProgress() {
  await progressWriteChain;
}

function updateRefreshProgress(patch) {
  if (!activeRefreshProgress) return;
  Object.assign(activeRefreshProgress, patch, { updatedAt: new Date().toISOString() });
  const started = Date.parse(activeRefreshProgress.startedAt || '');
  if (Number.isFinite(started)) activeRefreshProgress.elapsedSeconds = Math.max(0, Math.round((Date.now() - started) / 1000));
  queueRefreshProgressWrite();
}

export async function resumeIncompleteManifestCatalogRefresh() {
  const config = imageKitConfig();
  const checkpoint = await readState(config, CHECKPOINT_PATH);
  // Startup recovery is deliberately non-destructive: a missing or completed
  // checkpoint is not permission to launch a full catalogue revalidation.
  // Full reprocessing remains an explicit/manual runManifestCatalogRefresh option.
  if (!checkpoint || checkpoint.complete === true) {
    return { status: 'no-incomplete-checkpoint', skipped: true };
  }
  // Resume the exact saved scan generation, catalogue page checkpoints and
  // verified poster ledger. Completed assets remain out of the retry queue.
  return runManifestCatalogRefresh();
}

export async function getManifestCatalogRefreshDiagnostics() {
  const config = imageKitConfig();
  const checkpoint = await readState(config, CHECKPOINT_PATH);
  const configured = MANIFEST_KEYS.filter(key => process.env[key]);
  const manifests = await Promise.all(configured.map(readManifest));
  const inventory = new Map();
  let rawCatalogueDefinitions = 0;
  for (const manifest of manifests) {
    for (const catalog of manifest.catalogs) {
      rawCatalogueDefinitions++;
      const fingerprint = catalogueFingerprint(catalog);
      if (!inventory.has(fingerprint)) inventory.set(fingerprint, { manifest, catalog });
    }
  }

  const completed = checkpoint?.completedCatalogues && typeof checkpoint.completedCatalogues === 'object'
    ? checkpoint.completedCatalogues : {};
  const generation = checkpoint?.scanGeneration || null;
  const completedCurrent = new Set(Object.entries(completed)
    .filter(([fingerprint, entry]) => inventory.has(fingerprint) && generation &&
      entry?.scanGeneration === generation && entry?.status !== 'deferred')
    .map(([fingerprint]) => fingerprint));
  const deferredCurrent = new Set(Object.entries(completed)
    .filter(([fingerprint, entry]) => {
      const item = inventory.get(fingerprint);
      return Boolean(item && isExplicitlyDeferredCatalogueCheckpoint(entry, item.catalog, generation));
    })
    .map(([fingerprint]) => fingerprint));
  const dynamic = new Set();
  const pending = [];
  for (const [fingerprint, item] of inventory) {
    if (completedCurrent.has(fingerprint)) continue;
    if (deferredCurrent.has(fingerprint) || unresolvedRequiredExtras(item.catalog).length) dynamic.add(fingerprint);
    else pending.push({ fingerprint, ...item });
  }

  let firstIncompleteCatalogue = null;
  if (pending.length) {
    const first = pending[0];
    const path = checkpoint?.titleFiles?.[first.fingerprint] || catalogueCheckpointPath(first.fingerprint);
    const pageCheckpoint = await readState(config, path);
    firstIncompleteCatalogue = {
      source: first.manifest.name, type: first.catalog.type, id: first.catalog.id, name: first.catalog.name,
      pageCheckpoint: {
        exists: Boolean(pageCheckpoint),
        complete: pageCheckpoint?.complete === true,
        nextPage: Number(pageCheckpoint?.nextPage) || 0,
        pages: Number(pageCheckpoint?.pages) || 0,
        records: Number(pageCheckpoint?.records) || 0,
        generationMatches: Boolean(generation && pageCheckpoint?.scanGeneration === generation)
      }
    };
  }

  let durableQueue = null;
  if (generation) {
    try { durableQueue = await getDurableQueueState(generation); }
    catch (error) { durableQueue = { status: 'unavailable', error: error?.message || 'queue state unavailable' }; }
  }

  const staleCompletions = Object.entries(completed)
    .filter(([fingerprint, entry]) => !inventory.has(fingerprint) || !generation || entry?.scanGeneration !== generation).length;
  return {
    checkpointExists: Boolean(checkpoint),
    checkpointComplete: checkpoint?.complete === true,
    scanGeneration: generation,
    checkpointUpdatedAt: checkpoint?.updatedAt || null,
    configuredManifestCount: manifests.length,
    manifests: manifests.map(manifest => ({ source: manifest.name || manifest.key, catalogueDefinitions: manifest.catalogs.length })),
    rawCatalogueDefinitions,
    uniqueCatalogueCount: inventory.size,
    duplicateDefinitions: rawCatalogueDefinitions - inventory.size,
    completedCatalogueCount: completedCurrent.size,
    deferredCatalogueCount: deferredCurrent.size,
    pendingCatalogueCount: pending.length,
    dynamicCatalogueCount: dynamic.size,
    discoveryComplete: checkpoint?.discoveryComplete === true,
    staleCompletionCount: staleCompletions,
    titleFileCount: Object.keys(checkpoint?.titleFiles || {}).length,
    durableQueue,
    firstIncompleteCatalogue
  };
}

export function runManifestCatalogRefresh(options = {}) {
  if (activeRefreshPromise) return activeRefreshPromise;
  // Progress belongs to the lease owner only. A contender must not publish a
  // fake zero/finished snapshot while another process is doing the real work.
  activeRefreshProgress = null;
  activeRefreshJobId = null;
  activeRefreshPromise = withRefreshLease(async lease => {
    activeRefreshJobId = lease.jobId;
    activeRefreshProgress = {
      jobId: lease.jobId, status: 'starting', stage: 'initializing',
      startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      cataloguesDiscovered: 0, cataloguesScanned: 0, cataloguesTotal: 0,
      cataloguesFailed: 0, cataloguesSkipped: 0, titlesDiscovered: 0,
      postersTargeted: 0, postersVisited: 0, postersCorrected: 0,
      postersCacheHits: 0, postersPending: 0, failures: 0,
      failureDetails: [], elapsedSeconds: 0, titlesPerMinute: 0,
      cataloguesPerMinute: 0, titlesNewThisRun: 0, catalogueRecordsScanned: 0,
      catalogueRecordsResumed: 0, postersPerMinute: 0, lastCheckpointAt: null
    };
    queueRefreshProgressWrite();
    try {
      return await runManifestCatalogRefreshInternal(lease, options);
    } catch (error) {
      updateRefreshProgress({
        status: 'failed', stage: 'failed', error: error?.message || 'Catalogue refresh failed',
        finishedAt: new Date().toISOString()
      });
      throw error;
    } finally {
      if (activeRefreshProgress) {
        activeRefreshProgress.finishedAt = activeRefreshProgress.finishedAt || new Date().toISOString();
        activeRefreshProgress.updatedAt = activeRefreshProgress.finishedAt;
        queueRefreshProgressWrite();
        await flushRefreshProgress();
      }
      activeRefreshJobId = null;
    }
  }).finally(() => {
    activeRefreshPromise = null;
  });
  return activeRefreshPromise;
}

async function runManifestCatalogRefreshInternal(lease, options = {}) {
  const forceReprocess = options.forceReprocess === true;
  const mode = options.mode || 'combined';
  if (!['combined', 'discovery-only', 'queue-drain', 'incremental-discovery'].includes(mode)) {
    throw new Error('Unsupported catalogue pipeline mode: ' + mode);
  }
  if (mode === 'incremental-discovery') return runIncrementalMetadataScan(lease);
  const queueOnly = mode === 'queue-drain';
  const discoveryOnly = mode === 'discovery-only';
  if (mode !== 'combined' && forceReprocess) {
    throw new Error('Force reprocessing is not permitted in staged discovery or queue-drain modes');
  }
  await lease?.assertOwned?.();
  const startedAt = new Date().toISOString();
  const configured = MANIFEST_KEYS.filter(key => process.env[key]);
  if (!configured.length) throw new Error('No catalogue manifest URLs are configured');
  const config = imageKitConfig();
  const prior = await readState(config);
  let checkpoint = await readState(config, CHECKPOINT_PATH);
  // A completed checkpoint belongs to the previous run. Start a clean scan;
  // an incomplete checkpoint is a crash-safe resume point after an OOM/restart.
  if (queueOnly && checkpoint?.discoveryComplete !== true) {
    throw new Error('Queue-drain refused: no fully completed discovery checkpoint is available');
  }
  if ((!queueOnly && (forceReprocess || !checkpoint || checkpoint.complete === true || ![1, 2].includes(checkpoint.version)))) {
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
  const initialUniqueTitleCount = current.size;
  const manifests = await Promise.all(configured.map(readManifest));
  const catalogues = [];
  const cataloguesTotal = manifests.reduce((sum, manifest) => sum + manifest.catalogs.length, 0);
  const progressStartedMs = Date.now();
  updateRefreshProgress({
    status: 'running', stage: 'catalogue-discovery', scanGeneration,
    manifests: manifests.map(m => ({ source: m.name || m.key, catalogues: m.catalogs.length })),
    cataloguesTotal, titlesDiscovered: current.size,
    lastCheckpointAt: checkpoint.updatedAt || startedAt
  });
  const handledFingerprints = new Map();
  let cataloguesScannedThisRun = 0;
  let cataloguesResumed = 0;
  let catalogueRecordsScanned = 0;
  let catalogueRecordsResumed = 0;
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
        updateRefreshProgress({ cataloguesDiscovered: catalogues.length, cataloguesSkipped: cataloguesSkippedDuplicate });
        console.info('[catalog-skipped-duplicate]', JSON.stringify({
          source: skipped.source, type: skipped.type, id: skipped.id,
          duplicateOf: skipped.duplicateOf
        }));
        continue;
      }

      const unresolvedExtras = unresolvedRequiredExtras(catalog);
      const saved = completedCatalogues[fingerprint];

      if (unresolvedExtras.length) {
        if (queueOnly && !isExplicitlyDeferredCatalogueCheckpoint(saved, catalog, scanGeneration)) {
          throw new Error('Queue-drain refused: catalogue discovery checkpoint is incomplete for ' + fingerprint);
        }
        if (!queueOnly && !isExplicitlyDeferredCatalogueCheckpoint(saved, catalog, scanGeneration)) {
          completedCatalogues[fingerprint] = {
            source: manifest.name, type: catalog.type, id: catalog.id, name: catalog.name,
            status: 'deferred', reason: 'required-extra-options-unavailable',
            requiredExtras: [...unresolvedExtras].sort(), scanGeneration
          };
          checkpoint = {
            ...checkpoint, version: 2, badgeRulesVersion: BADGE_RULES_VERSION,
            scanGeneration, complete: false, completedCatalogues, titleFiles,
            updatedAt: new Date().toISOString()
          };
          await lease?.assertOwned?.();
          await writeJson(config, CHECKPOINT_PATH, checkpoint);
        }
        handledFingerprints.set(fingerprint, {
          source: manifest.name, type: catalog.type, id: catalog.id, name: catalog.name
        });
        const skipped = {
          source: manifest.name, type: catalog.type, id: catalog.id, name: catalog.name,
          pages: 0, records: 0, metas: [], skipped: true, deferred: true,
          skipReason: 'Requires user-supplied catalogue extras: ' + unresolvedExtras.join(', ')
        };
        catalogues.push(skipped);
        updateRefreshProgress({
          cataloguesDiscovered: catalogues.length,
          cataloguesSkipped: catalogues.filter(c => c.skipped || c.skippedDuplicate).length
        });
        console.info('[catalog-skipped-dynamic]', JSON.stringify({
          source: skipped.source, type: skipped.type, id: skipped.id,
          name: skipped.name, requiredExtras: unresolvedExtras, checkpointed: true
        }));
        continue;
      }

      if (saved?.status === 'deferred') delete completedCatalogues[fingerprint];
      if (queueOnly && (!saved || saved.status === 'deferred' || saved.scanGeneration !== scanGeneration)) {
        throw new Error('Queue-drain refused: catalogue discovery checkpoint is incomplete for ' + fingerprint);
      }
      if (saved && saved.scanGeneration === scanGeneration && saved.status !== 'deferred') {
        const perCatalog = await readState(config, titleFiles[fingerprint] || catalogueCheckpointPath(fingerprint));
        if (perCatalog?.titles && typeof perCatalog.titles === 'object') {
          for (const [id, item] of Object.entries(perCatalog.titles)) {
            if (item?.id !== id) continue;
            current.set(id, current.has(id) ? mergeCatalogSourceItem(current.get(id), item) : mergeCatalogSourceItem({}, item));
          }
        }
        handledFingerprints.set(fingerprint, {
          source: saved.source, type: catalog.type, id: catalog.id, name: catalog.name
        });
        cataloguesResumed++;
        catalogueRecordsResumed += Number(saved.records) || 0;
        catalogues.push({
          source: manifest.name, type: catalog.type, id: catalog.id, name: catalog.name,
          pages: saved.pages || 0, records: saved.records || 0, truncated: Boolean(saved.truncated), resumed: true
        });
        const resumeElapsedMinutes = Math.max((Date.now() - progressStartedMs) / 60000, 1 / 60);
        updateRefreshProgress({
          cataloguesDiscovered: catalogues.length, cataloguesResumed,
          catalogueRecordsResumed, titlesDiscovered: current.size,
          titlesNewThisRun: Math.max(0, current.size - initialUniqueTitleCount),
          titlesPerMinute: Math.round(Math.max(0, current.size - initialUniqueTitleCount) / resumeElapsedMinutes)
        });
        console.info('[catalog-resumed-from-checkpoint]', JSON.stringify({
          source: manifest.name, type: catalog.type, id: catalog.id,
          fingerprint, titlesRestored: current.size
        }));
        continue;
      }

      if (saved) delete completedCatalogues[fingerprint];

      try {
        const result = await collectCatalog(manifest, catalog, config, fingerprint, lease, scanGeneration, forceRescanCatalogs);
        for (const item of result.titles) {
          current.set(item.id, current.has(item.id)
            ? mergeCatalogSourceItem(current.get(item.id), item)
            : mergeCatalogSourceItem({}, item));
        }
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
        catalogueRecordsScanned += Number(result.records) || 0;
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
        // The per-catalogue file is durable immediately. Coalesce only the
        // compact inventory pointer; an interrupted catalogue can be replayed.
        if (shouldPersistCatalogueInventoryCheckpoint(Object.keys(completedCatalogues).length)) {
          await lease?.assertOwned?.();
          await writeJson(config, CHECKPOINT_PATH, checkpoint);
        }
        const elapsedMinutes = Math.max((Date.now() - progressStartedMs) / 60000, 1 / 60);
        updateRefreshProgress({
          cataloguesDiscovered: catalogues.length, cataloguesScanned: cataloguesScannedThisRun,
          cataloguesResumed, cataloguesSkipped: cataloguesSkippedDuplicate,
          catalogueRecordsScanned, catalogueRecordsResumed,
          titlesDiscovered: current.size,
          titlesNewThisRun: Math.max(0, current.size - initialUniqueTitleCount),
          titlesPerMinute: Math.round(Math.max(0, current.size - initialUniqueTitleCount) / elapsedMinutes),
          cataloguesPerMinute: Math.round(cataloguesScannedThisRun / elapsedMinutes * 10) / 10,
          lastCheckpointAt: checkpoint.updatedAt
        });
      } catch (error) {
        if (/coordination lease/.test(error?.message || '')) throw error;
        const failed = {
          source: manifest.name, type: catalog.type, id: catalog.id, name: catalog.name,
          pages: 0, records: 0, titles: [], error: error?.message || 'catalogue fetch failed'
        };
        catalogues.push(failed);
        const failureDetails = activeRefreshProgress?.failureDetails || [];
        failureDetails.push({ stage: 'catalogue-discovery', source: failed.source, catalogue: failed.name, error: failed.error });
        updateRefreshProgress({
          cataloguesDiscovered: catalogues.length, cataloguesFailed: catalogues.filter(c => c.error).length,
          failures: (activeRefreshProgress?.failures || 0) + 1,
          failureDetails: failureDetails.slice(-20)
        });
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
  const scanComplete = isCatalogueScanComplete(catalogues);
  if (queueOnly && !scanComplete) throw new Error('Queue-drain refused: saved discovery inventory is not complete');
  checkpoint = { ...checkpoint, discoveryComplete: scanComplete, updatedAt: new Date().toISOString() };
  await lease?.assertOwned?.();
  await writeJson(config, CHECKPOINT_PATH, checkpoint);
  const nextState = { initialized: true, complete: scanComplete, updatedAt: new Date(now).toISOString(), seen, added };
  await lease?.assertOwned?.();
  await writeJson(config, STATE_PATH, nextState);
  await lease?.assertOwned?.();
  await writeJson(config, INDEX_PATH, index);

  // Keep the complete catalogue inventory, but only send unresolved titles
  // through poster generation. Verified ledger entries are retained when the
  // fingerprint still matches and ImageKit confirms the asset is available.
  const allItems = [...current.values()];
  if (scanComplete) await publishSharedMetadataIndex(allItems, scanGeneration, config, lease);
  const preflightLedgerCache = new Map();
  const preflightImageKitChecks = new Map();
  const items = [];
  const candidatesForHeadCheck = [];
  const pendingResumeItems = [];
  const deferredQueueIds = new Set();
  let preflightVerifiedHits = 0;
  let deferredPending = 0;
  let deferredSourceUnavailable = 0;
  let deferredSourceProbe = 0;
  let deferredHistoricalUnresolved = 0;
  // Read each ledger shard once, then verify existing assets with a small,
  // bounded network-only fan-out. OCR/image generation stays serial on Free.
  const refreshedLedgerShards = new Set();
  if (discoveryOnly) {
    // A discovery-only baseline must not read, verify, or mutate poster ledgers.
    // Historical failed/retry/upload-pending records remain untouched.
    items.push(...allItems);
  } else {
  for (const item of allItems) {
    const shard = ledgerShard(item.id);
    const records = await loadLedgerShard(config, shard, preflightLedgerCache);
    const record = records[item.id];
    if (!forceReprocess && record && ['failed', 'retry', 'upload-pending'].includes(record.status)) {
      // Historical unresolved records are preserved for an explicit, source-aware
      // recovery pass. A normal discovery/queue cycle must never auto-retry them.
      deferredQueueIds.add(String(item.id));
      deferredHistoricalUnresolved++;
    } else if (!forceReprocess && isSourceUnavailableCoolingDown(record, itemFingerprint(item))) {
      deferredQueueIds.add(String(item.id));
      deferredSourceUnavailable++;
    } else if (!forceReprocess && isSourceProbeCoolingDown(record, itemFingerprint(item))) {
      deferredQueueIds.add(String(item.id));
      deferredSourceProbe++;
    } else if (!forceReprocess && needsResumeVerification(record, itemFingerprint(item))) {
      pendingResumeItems.push({ item, record });
    } else if (!forceReprocess && reusableLedgerRecord(record, item)) {
      if (isFreshVerifiedRecord(record, itemFingerprint(item))) {
        // A recent successful HEAD confirmation remains valid across a restart.
        preflightImageKitChecks.set(item.id, true);
        preflightVerifiedHits++;
      } else {
        candidatesForHeadCheck.push(item);
      }
    } else {
      items.push(item);
    }
  }
  const PREFLIGHT_HEAD_CONCURRENCY = 8;
  // A persisted upload-pending record means the previous process may have
  // stopped after the origin accepted the upload but before CDN verification.
  // Confirm the canonical asset once; if still absent, defer regeneration for
  // two minutes so propagation can finish without risking a duplicate.
  for (let offset = 0; offset < pendingResumeItems.length; offset += PREFLIGHT_HEAD_CONCURRENCY) {
    const batch = pendingResumeItems.slice(offset, offset + PREFLIGHT_HEAD_CONCURRENCY);
    const checks = await Promise.all(batch.map(({ item, record }) => checkImageKit(record?.verificationUrl || item.id)));
    for (let index = 0; index < batch.length; index++) {
      const { item, record } = batch[index];
      const shard = ledgerShard(item.id);
      const records = await loadLedgerShard(config, shard, preflightLedgerCache);
      preflightImageKitChecks.set(item.id, checks[index]);
      if (checks[index]) {
        records[item.id] = ledgerRecord(item, 'verified', {
          verifiedAt: new Date().toISOString(),
          verification: 'restart-pending-upload-head-confirmed'
        });
        preflightVerifiedHits++;
      } else {
        records[item.id] = ledgerRecord(item, 'retry', {
          attempts: (Number(record.attempts) || 0) + 1,
          retryAfter: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
          lastError: 'Previous upload outcome was uncertain; deferred after restart to avoid duplicate generation'
        });
        deferredQueueIds.add(String(item.id));
        deferredPending++;
      }
      refreshedLedgerShards.add(shard);
    }
  }
  for (let offset = 0; offset < candidatesForHeadCheck.length; offset += PREFLIGHT_HEAD_CONCURRENCY) {
    const batch = candidatesForHeadCheck.slice(offset, offset + PREFLIGHT_HEAD_CONCURRENCY);
    const checks = await Promise.all(batch.map(item => checkImageKit(item.id)));
    for (let index = 0; index < batch.length; index++) {
      const item = batch[index];
      preflightImageKitChecks.set(item.id, checks[index]);
      if (checks[index]) {
        preflightVerifiedHits++;
        const shard = ledgerShard(item.id);
        const records = await loadLedgerShard(config, shard, preflightLedgerCache);
        if (records[item.id]) {
          const verifiedAt = new Date().toISOString();
          records[item.id].verifiedAt = verifiedAt;
          records[item.id].updatedAt = verifiedAt;
          refreshedLedgerShards.add(shard);
        }
      } else {
        items.push(item);
      }
    }
  }
  if (refreshedLedgerShards.size) {
    await lease?.assertOwned?.();
    await persistLedgerShards(config, preflightLedgerCache, [...refreshedLedgerShards]);
  }
  preflightLedgerCache.clear();
  }
  // Publish a durable, generation-scoped queue to ImageKit before any poster
  // work begins. The queue manifest is committed last; each chunk is checksummed.
  // A restart can reload this exact candidate set without losing discovered work.
  if (queueOnly) {
    // A drain is never allowed to manufacture a new queue from a partial or
    // newly scanned inventory. It must consume the already published snapshot.
    await loadDurableQueueSnapshot(scanGeneration);
  }
  const queueItems = items.map(item => ({ ...item, queueFingerprint: itemFingerprint(item) }));
  const durableQueueManifest = await persistDurableQueueSnapshot(queueItems, scanGeneration, {
    assertOwned: () => lease?.assertOwned?.()
  });
  await lease?.assertOwned?.();
  const durableQueue = await loadDurableQueueSnapshot(scanGeneration);
  if (durableQueue.items.some(item => item.queueFingerprint !== itemFingerprint(item))) {
    throw new Error('Durable poster queue fingerprint validation failed; refusing to process stale queue data');
  }
  items.length = 0;
  const eligibleQueueItems = excludeDeferredQueueItems(durableQueue.items, deferredQueueIds);
  for (const item of eligibleQueueItems) items.push(item);
  console.info('[durable-poster-queue-loaded]', JSON.stringify({
    scanGeneration, itemCount: durableQueue.items.length, eligibleItemCount: eligibleQueueItems.length,
    deferredHistoricalUnresolved, chunkCount: durableQueueManifest.chunkCount,
    storage: 'imagekit', mode
  }));
  if (discoveryOnly) {
    const report = {
      status: scanComplete ? 'discovery-complete-queue-ready' : 'discovery-incomplete',
      mode, scanGeneration, scanComplete, cataloguesDiscovered: catalogues.length,
      cataloguesScannedThisRun, uniqueTitles: allItems.length,
      queueItems: durableQueue.items.length, queueChunks: durableQueueManifest.chunkCount,
      storage: 'imagekit', finishedAt: new Date().toISOString()
    };
    updateRefreshProgress({ status: scanComplete ? 'completed' : 'failed', stage: 'discovery-complete',
      report, finishedAt: report.finishedAt, titlesDiscovered: allItems.length,
      postersTargeted: durableQueue.items.length, lastCheckpointAt: checkpoint.updatedAt });
    return report;
  }
  // Publish poster-stage totals only after the target list and cache-hit count
  // have been initialized. Referencing items above this point triggers a TDZ
  // ReferenceError and breaks automatic recovery after a Render restart.
  updateRefreshProgress({
    stage: 'poster-processing', titlesDiscovered: allItems.length,
    postersTargeted: items.length, postersCacheHits: preflightVerifiedHits, postersDeferred: deferredPending + deferredSourceUnavailable + deferredSourceProbe + deferredHistoricalUnresolved,
    cataloguesDiscovered: catalogues.length,
    cataloguesScanned: cataloguesScannedThisRun,
    cataloguesFailed: catalogues.filter(c => c.error).length
  });
  console.info('[catalog-recovery-targeted]', JSON.stringify({
    catalogueTitles: allItems.length,
    retryCandidates: items.length,
    alreadyVerified: preflightVerifiedHits,
    deferredPending,
    deferredSourceUnavailable,
    deferredSourceProbe,
    deferredHistoricalUnresolved,
    strategy: forceReprocess ? 'force-revalidate-all-catalogue-titles' : 'retry-only-unresolved-or-missing-imagekit-assets'
  }));
  // Establish a verified storage budget before the first poster request.
  // The HTTP handler deliberately initializes this in the background so
  // ordinary Nuvio requests never wait on an account inventory scan; the
  // recovery worker must await it or every first upload would be skipped.
  await initializeImageKitStorageSnapshot();
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
    // Verification is a bounded, ID-only queue. It never retains image bodies.
    const verificationQueue = createBoundedTaskQueue(4);

    const verifyPendingBatch = async pendingItems => {
      const verificationPolicy = refreshResourcePolicy(process.memoryUsage().rss / (1024 * 1024));
      const verification = await runPool(pendingItems, async item => {
        if (await waitForImageKit(item.verificationUrl || item.id, item.verificationTimeoutMs || 90000)) {
          records[item.id] = ledgerRecord(item, 'verified', {
            verifiedAt: new Date().toISOString(),
            verification: 'imagekit-head-confirmed'
          });
          return {
            id: item.id,
            status: item.uploadAccepted ? 'generated-and-cached' : 'imagekit-confirmed-after-uncertain-request'
          };
        }
        records[item.id] = ledgerRecord(item, 'failed', {
          attempts: (Number(records[item.id]?.attempts) || 0) + 1,
          retryAfter: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
          lastError: 'ImageKit upload did not become visible within the bounded verification window'
        });
        throw new Error('ImageKit upload did not become visible within the bounded verification window');
      }, verificationPolicy.verificationConcurrency, (item, error) => {
        const failureDetails = activeRefreshProgress?.failureDetails || [];
        failureDetails.push({ stage: 'imagekit-verification', titleId: item.id, error });
        updateRefreshProgress({ failureDetails: failureDetails.slice(-20) });
      });

      for (const [status, count] of Object.entries(verification.counts)) {
        resultCounts[status] = (resultCounts[status] || 0) + count;
      }
      totalFailures += verification.failures;
      verifiedUploads += verification.counts['generated-and-cached'] || 0;
      verifiedCacheHits += verification.counts['imagekit-confirmed-after-uncertain-request'] || 0;
      uploadPending -= pendingItems.length;
      resultCounts['upload-pending'] = Math.max(0, (resultCounts['upload-pending'] || 0) - pendingItems.length);
      if (!resultCounts['upload-pending']) delete resultCounts['upload-pending'];
      await persistShard();
      const elapsedMinutes = Math.max((Date.now() - progressStartedMs) / 60000, 1 / 60);
      updateRefreshProgress({
        postersCorrected: verifiedUploads, postersCacheHits: verifiedCacheHits,
        postersPending: uploadPending, failures: totalFailures + catalogues.filter(c => c.error).length,
        postersPerMinute: Math.round(postersVisited / elapsedMinutes),
        lastCheckpointAt: new Date().toISOString()
      });
    };

    for (let offset = 0; offset < shardItems.length; offset += PREWARM_BATCH_SIZE) {
      // Let CDN visibility checks overlap poster generation, but apply RSS-based
      // backpressure and a strict cap so the queue cannot grow without bound.
      const resourcePolicy = await waitForImageWorkHeadroom();
      if (verificationQueue.pendingCount >= resourcePolicy.maxPendingBatches) {
        await verificationQueue.drain();
      }
      await lease?.assertOwned?.();
      const batchCandidates = shardItems.slice(offset, offset + PREWARM_BATCH_SIZE);
      const queueOwner = String(lease?.jobId || 'catalog-refresh');
      const claimedIds = await claimDurableQueueBatch(
        scanGeneration, batchCandidates.map(item => item.id), queueOwner,
        { assertOwned: () => lease?.assertOwned?.() }
      );
      const claimedSet = new Set(claimedIds);
      const batch = batchCandidates.filter(item => claimedSet.has(item.id));
      if (!batch.length) {
        console.info('[durable-poster-queue-batch-skipped]', JSON.stringify({
          scanGeneration, shard, offset, reason: 'already-recorded-or-actively-claimed'
        }));
        continue;
      }
      const reusable = await Promise.all(batch.map(async item => {
        if (forceReprocess) return false;
        const record = records[item.id];
        if (!reusableLedgerRecord(record, item)) return false;
        const preflightResult = preflightImageKitChecks.get(item.id);
        if (preflightResult === false) return false;
        return preflightResult === true || await checkImageKit(item.id);
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
            const result = await prewarm(item, preflightImageKitChecks.get(item.id));
            if (result.status === 'upload-pending') {
              records[item.id] = ledgerRecord(item, 'upload-pending', {
                attempts: (Number(records[item.id]?.attempts) || 0) + 1,
                posterStatus: result.posterStatus || null,
                verificationTimeoutMs: result.verificationTimeoutMs || 90000,
                uploadAccepted: result.uploadAccepted === true,
                verificationUrl: result.verificationUrl || null,
                pendingSince: new Date().toISOString()
              });
              pendingItems.push({ ...item, verificationUrl: result.verificationUrl || null, verificationTimeoutMs: result.verificationTimeoutMs || 90000, uploadAccepted: result.uploadAccepted === true });
              uploadPending++;
            } else if (result.status === 'source-unavailable') {
              records[item.id] = ledgerRecord(item, 'source-unavailable', {
                attempts: (Number(records[item.id]?.attempts) || 0) + 1,
                retryAfter: new Date(Date.now() + (result.retryAfterMs || SOURCE_UNAVAILABLE_COOLDOWN_MS)).toISOString(),
                lastError: result.error || 'No usable poster source currently available'
              });
            } else if (result.status === 'source-probe-failed') {
              records[item.id] = ledgerRecord(item, 'source-probe-failed', {
                attempts: (Number(records[item.id]?.attempts) || 0) + 1,
                retryAfter: new Date(Date.now() + (result.retryAfterMs || SOURCE_PROBE_RETRY_COOLDOWN_MS)).toISOString(),
                lastError: result.error || 'Poster source probe temporarily failed'
              });
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
        }, adaptivePrewarmConcurrency(), (item, error) => {
          const failureDetails = activeRefreshProgress?.failureDetails || [];
          failureDetails.push({ stage: 'poster-processing', titleId: item.id, error });
          updateRefreshProgress({ failureDetails: failureDetails.slice(-20) });
        });

        for (const [status, count] of Object.entries(prewarmReport.counts)) {
          resultCounts[status] = (resultCounts[status] || 0) + count;
        }
        totalFailures += prewarmReport.failures;

        // Persist pending records before their asynchronous verification starts.
        // A restart can safely HEAD-check or retry only this incomplete batch.
        await persistShard();
        if (pendingItems.length) {
          const queued = await verificationQueue.enqueue(() => verifyPendingBatch([...pendingItems]));
          queued.completion.then(outcome => {
            if (outcome.status === 'rejected') {
              totalFailures++;
              const failureDetails = activeRefreshProgress?.failureDetails || [];
              failureDetails.push({ stage: 'imagekit-verification-persistence', error: outcome.error?.message || 'verification task failed' });
              updateRefreshProgress({ failureDetails: failureDetails.slice(-20) });
              console.error('[catalog-verification-task-failed]', outcome.error?.message || 'unknown error');
            }
          });
        }
      }

      // The poster ledger is the completion record. Acknowledge the queue only
      // after any changed ledger shard has been durably written to ImageKit.
      await settleDurableQueueBatch(
        scanGeneration, batch.map(item => item.id), queueOwner, 'recorded',
        { assertOwned: () => lease?.assertOwned?.() }
      );
      batchesProcessed++;
      postersVisited += batch.length;
      if (global.gc) global.gc();
      if (batchesProcessed % 2 === 0 || postersVisited === items.length) {
        const elapsedMinutes = Math.max((Date.now() - progressStartedMs) / 60000, 1 / 60);
        updateRefreshProgress({
          postersVisited, postersTargeted: items.length, postersCorrected: verifiedUploads,
          postersCacheHits: verifiedCacheHits, postersPending: uploadPending,
          failures: totalFailures + catalogues.filter(c => c.error).length,
          postersPerMinute: Math.round(postersVisited / elapsedMinutes),
          lastCheckpointAt: new Date().toISOString()
        });
        const rss = Math.round(process.memoryUsage().rss / (1024 * 1024));
        console.log('[catalog-ledger-progress]', JSON.stringify({
          visited: postersVisited, total: items.length, batch: batchesProcessed,
          batchSize: batch.length, ledgerHits, verifiedUploads, verifiedCacheHits,
          uploadPending, failures: totalFailures, rssMiB: rss,
          prewarmConcurrency: adaptivePrewarmConcurrency(),
          verificationBatchesInFlight: verificationQueue.pendingCount,
          verificationConcurrency: resourcePolicy.verificationConcurrency,
          memoryPolicy: resourcePolicy
        }));
      }
    }

    await verificationQueue.drain();
    preflightImageKitChecks.clear();
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
    uniqueTitles: allItems.length, newlyDiscovered, scanComplete,
    postersProcessed: postersVisited, postersSkippedFromLedger: ledgerHits, batchesProcessed,
    postersDeferredHistorical: deferredHistoricalUnresolved,
    verifiedUploads, verifiedCacheHits, uploadsAwaitingVerification: uploadPending,
    failures: totalFailures, results: resultCounts
  };
  // Mark the checkpoint reusable only when both discovery and poster prewarm
  // finish cleanly. A subsequent scheduled run will start a fresh scan.
  if (scanComplete && totalFailures === 0 && !resultCounts.failed && !resultCounts.retry && !resultCounts['rendered-not-cached'] && !resultCounts['source-redirect']) {
    checkpoint = {
      version: 2, badgeRulesVersion: BADGE_RULES_VERSION,
      scanGeneration, forceRescanCatalogs: false, titleInventoryGeneration: scanGeneration,
      complete: true, discoveryComplete: true, updatedAt: new Date().toISOString(),
      completedCatalogues, titleFiles
    };
    await lease?.assertOwned?.();
    await writeJson(config, CHECKPOINT_PATH, checkpoint);
  }
  updateRefreshProgress({
    status: 'completed', stage: 'completed', cataloguesDiscovered: catalogues.length,
    cataloguesScanned: cataloguesScannedThisRun, cataloguesResumed,
    catalogueRecordsScanned, catalogueRecordsResumed,
    cataloguesPerMinute: Math.round(cataloguesScannedThisRun / Math.max((Date.now() - progressStartedMs) / 60000, 1 / 60) * 10) / 10,
    cataloguesFailed: catalogues.filter(c => c.error).length,
    titlesDiscovered: allItems.length, titlesNewThisRun: Math.max(0, allItems.length - initialUniqueTitleCount),
    postersTargeted: items.length,
    postersVisited, postersCorrected: verifiedUploads, postersCacheHits: verifiedCacheHits,
    postersPending: uploadPending, failures: totalFailures + catalogues.filter(c => c.error).length,
    report, finishedAt: new Date().toISOString(),
    elapsedSeconds: Math.round((Date.now() - progressStartedMs) / 1000),
    lastCheckpointAt: checkpoint.updatedAt || new Date().toISOString()
  });
  console.log('[catalog-refresh-complete]', JSON.stringify(report));
  return report;
}
