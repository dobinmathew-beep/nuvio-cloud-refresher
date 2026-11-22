import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';

const ROOT = '/catalog-state/durable-queue';
const CHUNK_SIZE = 100;

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
