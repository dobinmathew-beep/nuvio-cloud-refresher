import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';

const ROOT = '/catalog-state/durable-queue';
const CHUNK_SIZE = 100;
const STATE_FILE = 'queue-state.json';
const DEFAULT_CLAIM_MS = 5 * 60 * 1000;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function safeGeneration(value) {
  const generation = String(value || '').trim();
  if (!generation) throw new Error('A scan generation is required for a durable queue snapshot');
  return sha256(generation).slice(0, 32);
}

export function chunkDurableQueue(items, chunkSize = CHUNK_SIZE) {
  if (!Array.isArray(items)) throw new TypeError('Queue items must be an array');
  if (!Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > 500) {
    throw new RangeError('Queue chunk size must be between 1 and 500');
  }
  const chunks = [];
  for (let offset = 0; offset < items.length; offset += chunkSize) {
    chunks.push(items.slice(offset, offset + chunkSize));
  }
  return chunks;
}

export function validateDurableQueueChunk(chunk, expected) {
  if (!Array.isArray(chunk)) return false;
  const serialized = JSON.stringify(chunk);
  return chunk.length === expected.count && sha256(serialized) === expected.sha256;
}

function imageKitConfig() {
  const endpoint = String(process.env.IMAGEKIT_URL_ENDPOINT || '').replace(/\/+$/, '');
  const privateKey = process.env.IMAGEKIT_PRIVATE_KEY || '';
  if (!endpoint || !privateKey) throw new Error('ImageKit credentials are required for durable queue storage');
  return { endpoint, privateKey };
}

function auth(config) {
  return 'Basic ' + Buffer.from(config.privateKey + ':').toString('base64');
}

async function readJson(config, path) {
  const url = new URL(config.endpoint + path);
  url.searchParams.set('_queue_read', String(Date.now()) + '-' + randomUUID());
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(12000) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('ImageKit durable queue read HTTP ' + response.status);
  const value = await response.json();
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid ImageKit durable queue JSON at ' + path);
  }
  return value;
}

async function writeJson(config, path, value) {
  const fileName = path.split('/').pop();
  const form = new FormData();
  form.set('file', new Blob([JSON.stringify(value)], { type: 'application/json' }), fileName);
  form.set('fileName', fileName);
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
  if (!response.ok) {
    throw new Error('ImageKit durable queue write HTTP ' + response.status + ': ' + (await response.text()).slice(0, 240));
  }
  return response.json();
}

/**
 * Persist a generation-scoped queue snapshot. Chunks are uploaded first and
 * the manifest is written last, so readers never treat a partial snapshot as
 * ready. Callers must hold the shared refresh lease while writing.
 */
export async function persistDurableQueueSnapshot(items, scanGeneration, options = {}) {
  const config = options.config || imageKitConfig();
  const chunks = chunkDurableQueue(items, options.chunkSize || CHUNK_SIZE);
  const generationKey = safeGeneration(scanGeneration);
  const folder = ROOT + '/' + generationKey;
  // A published generation is immutable. On restart, reuse its exact candidate
  // set rather than replacing it with a partially rebuilt in-memory list.
  const existing = await readJson(config, folder + '/manifest.json');
  if (existing) {
    const validated = await loadDurableQueueSnapshot(scanGeneration, { config });
    await initializeDurableQueueState(scanGeneration, validated.items.map(item => item.id), { config, assertOwned: options.assertOwned });
    return validated.manifest;
  }
  const chunkEntries = [];

  for (let index = 0; index < chunks.length; index++) {
    const path = folder + '/chunk-' + String(index).padStart(5, '0') + '.json';
    const serialized = JSON.stringify(chunks[index]);
    await options.assertOwned?.();
    await writeJson(config, path, {
      version: 1,
      scanGeneration: String(scanGeneration),
      index,
      count: chunks[index].length,
      sha256: sha256(serialized),
      items: chunks[index]
    });
    chunkEntries.push({
      path,
      count: chunks[index].length,
      sha256: sha256(serialized)
    });
  }

  const manifest = {
    version: 1,
    scanGeneration: String(scanGeneration),
    generationKey,
    createdAt: new Date().toISOString(),
    itemCount: items.length,
    chunkCount: chunkEntries.length,
    chunks: chunkEntries
  };
  await options.assertOwned?.();
  await writeJson(config, folder + '/manifest.json', manifest);
  await initializeDurableQueueState(scanGeneration, items.map(item => item.id), { config });
  console.info('[durable-poster-queue-persisted]', JSON.stringify({
    scanGeneration,
    itemCount: items.length,
    chunkCount: chunkEntries.length,
    storage: 'imagekit'
  }));
  return manifest;
}

/**
 * Load and checksum every chunk referenced by the last published manifest.
 * Missing/corrupt chunks fail closed; callers must not fall back to a partial
 * in-memory queue and accidentally report a complete run.
 */
export async function loadDurableQueueSnapshot(scanGeneration, options = {}) {
  const config = options.config || imageKitConfig();
  const generationKey = safeGeneration(scanGeneration);
  const folder = ROOT + '/' + generationKey;
  const manifest = await readJson(config, folder + '/manifest.json');
  if (!manifest || manifest.version !== 1 || manifest.scanGeneration !== String(scanGeneration) ||
      !Array.isArray(manifest.chunks) || manifest.chunkCount !== manifest.chunks.length ||
      !Number.isInteger(manifest.itemCount) || manifest.itemCount < 0) {
    throw new Error('Durable poster queue manifest is missing or invalid for scan generation ' + scanGeneration);
  }

  const items = [];
  for (const entry of manifest.chunks) {
    if (!entry || typeof entry.path !== 'string' || !entry.path.startsWith(folder + '/') ||
        !Number.isInteger(entry.count) || typeof entry.sha256 !== 'string') {
      throw new Error('Durable poster queue manifest contains an invalid chunk reference');
    }
    const saved = await readJson(config, entry.path);
    if (!saved || saved.version !== 1 || saved.scanGeneration !== String(scanGeneration) ||
        !Array.isArray(saved.items) || saved.count !== entry.count ||
        saved.sha256 !== entry.sha256 || !validateDurableQueueChunk(saved.items, entry)) {
      throw new Error('Durable poster queue chunk failed validation: ' + entry.path);
    }
    items.push(...saved.items);
  }
  if (items.length !== manifest.itemCount) {
    throw new Error('Durable poster queue item count mismatch: expected ' + manifest.itemCount + ', loaded ' + items.length);
  }
  return { manifest, items };
}


function queueStatePath(scanGeneration) {
  return ROOT + '/' + safeGeneration(scanGeneration) + '/' + STATE_FILE;
}

async function readQueueState(config, scanGeneration) {
  const state = await readJson(config, queueStatePath(scanGeneration));
  if (!state || state.version !== 1 || state.scanGeneration !== String(scanGeneration) ||
      !state.items || typeof state.items !== 'object' || Array.isArray(state.items)) {
    throw new Error('Durable poster queue state is missing or invalid for generation ' + scanGeneration);
  }
  return state;
}

/** Initialize once; never erase existing claims or completed acknowledgements. */
export async function initializeDurableQueueState(scanGeneration, itemIds, options = {}) {
  const config = options.config || imageKitConfig();
  const path = queueStatePath(scanGeneration);
  const existing = await readJson(config, path);
  const uniqueIds = [...new Set(itemIds.map(id => String(id)))];
  if (existing) {
    if (existing.version !== 1 || existing.scanGeneration !== String(scanGeneration) ||
        !existing.items || typeof existing.items !== 'object') {
      throw new Error('Existing durable queue state is malformed; refusing to overwrite it');
    }
    const savedIds = Object.keys(existing.items).sort();
    const expectedIds = [...uniqueIds].sort();
    if (savedIds.length !== expectedIds.length || savedIds.some((id, index) => id !== expectedIds[index])) {
      throw new Error('Existing durable queue membership differs from immutable manifest; refusing destructive rewrite');
    }
    return existing;
  }
  const items = Object.fromEntries(uniqueIds.map(id => [id, {
    status: 'queued', attempts: 0, updatedAt: new Date().toISOString()
  }]));
  const state = { version: 1, scanGeneration: String(scanGeneration), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), items };
  await options.assertOwned?.();
  await writeJson(config, path, state);
  return state;
}

/** Expired claims are returned to queued; the caller must hold the global refresh lease. */
export async function claimDurableQueueBatch(scanGeneration, itemIds, owner, options = {}) {
  const config = options.config || imageKitConfig();
  const state = await readQueueState(config, scanGeneration);
  const now = Date.now();
  const claimMs = Math.max(30_000, Number(options.claimMs) || DEFAULT_CLAIM_MS);
  const claimed = [];
  for (const rawId of itemIds) {
    const id = String(rawId);
    const entry = state.items[id];
    if (!entry) throw new Error('Queue item is absent from durable manifest: ' + id);
    if (entry.status === 'recorded') continue;
    if (entry.status === 'claimed' && Date.parse(entry.claimExpiresAt || '') > now) continue;
    entry.status = 'claimed';
    entry.owner = String(owner);
    entry.claimedAt = new Date(now).toISOString();
    entry.claimExpiresAt = new Date(now + claimMs).toISOString();
    entry.attempts = (Number(entry.attempts) || 0) + 1;
    entry.updatedAt = new Date(now).toISOString();
    claimed.push(id);
  }
  if (claimed.length) {
    state.updatedAt = new Date(now).toISOString();
    await options.assertOwned?.();
    await writeJson(config, queueStatePath(scanGeneration), state);
  }
  return claimed;
}

/** Acknowledge only jobs claimed by this owner, after their ledger writes are durable. */
export async function settleDurableQueueBatch(scanGeneration, itemIds, owner, outcome = 'recorded', options = {}) {
  const config = options.config || imageKitConfig();
  const state = await readQueueState(config, scanGeneration);
  const now = new Date().toISOString();
  for (const rawId of itemIds) {
    const id = String(rawId);
    const entry = state.items[id];
    if (!entry) throw new Error('Queue item is absent from durable manifest: ' + id);
    if (entry.status === 'recorded') continue;
    if (entry.status !== 'claimed' || entry.owner !== String(owner)) {
      throw new Error('Queue claim ownership lost for ' + id + '; refusing acknowledgement');
    }
    entry.status = outcome === 'recorded' ? 'recorded' : 'queued';
    entry.lastOutcome = String(outcome);
    entry.recordedAt = outcome === 'recorded' ? now : null;
    entry.owner = null;
    entry.claimedAt = null;
    entry.claimExpiresAt = null;
    entry.updatedAt = now;
  }
  state.updatedAt = now;
  await options.assertOwned?.();
  await writeJson(config, queueStatePath(scanGeneration), state);
  return state;
}

export async function getDurableQueueState(scanGeneration, options = {}) {
  const config = options.config || imageKitConfig();
  const state = await readQueueState(config, scanGeneration);
  const counts = { queued: 0, claimed: 0, recorded: 0, expiredClaims: 0 };
  const now = Date.now();
  for (const entry of Object.values(state.items)) {
    if (entry.status === 'claimed' && Date.parse(entry.claimExpiresAt || '') <= now) counts.expiredClaims++;
    if (counts[entry.status] !== undefined) counts[entry.status]++;
  }
  return { scanGeneration: state.scanGeneration, total: Object.keys(state.items).length, counts, updatedAt: state.updatedAt };
}
