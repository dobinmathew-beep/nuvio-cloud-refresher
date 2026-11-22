import { Buffer } from 'node:buffer';
import { isValidPosterPointer } from './poster-versioning.mjs';

const API = 'https://api.imagekit.io/v1';
const UPLOAD_API = 'https://upload.imagekit.io/api/v1/files/upload';
export const IMAGEKIT_STORAGE_LIMIT_BYTES = Math.floor(2.25 * 1000 * 1000 * 1000);
const MAINTENANCE_COOLDOWN_MS = 6 * 60 * 60 * 1000;
export const VERSIONED_POSTER_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const STORAGE_SNAPSHOT_PATH = '/catalog-state/imagekit-storage-snapshot.json';
export function imageKitStorageSnapshotUrl(endpoint, cacheBuster = Date.now()) {
  let base = String(endpoint);
  while (base.endsWith('/')) base = base.slice(0, -1);
  const url = new URL(base + STORAGE_SNAPSHOT_PATH);
  url.searchParams.set('v', String(cacheBuster));
  return url.toString();
}
const STORAGE_SNAPSHOT_TTL_MS = 6 * 60 * 60 * 1000;
let storageSnapshot = { known: false, bytes: 0, checkedAt: 0, filesByPath: {} };
const UPLOAD_HEADROOM_BYTES = 32 * 1024 * 1024;
let maintenancePromise;
let lastMaintenanceAt = 0;
let lastMaintenanceReport = null;
let snapshotInitializationPromise = null;
let snapshotRetryAfter = 0;
let snapshotPersistPromise = null;
let snapshotDirtyUploads = 0;

export function imageKitConfig() {
  let endpoint = String(process.env.IMAGEKIT_URL_ENDPOINT || '').trim();
  const privateKey = process.env.IMAGEKIT_PRIVATE_KEY || '';
  while (endpoint.endsWith('/')) endpoint = endpoint.slice(0, -1);
  if (!endpoint || !privateKey) return null;
  try {
    const parsed = new URL(endpoint);
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'ik.imagekit.io' ||
        parts.length !== 1 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || parsed.search || parsed.hash) return null;
    return { endpoint: parsed.origin + '/' + parts[0], privateKey };
  } catch {
    return null;
  }
}

function authHeaders(config) {
  return { Authorization: 'Basic ' + Buffer.from(config.privateKey + ':').toString('base64'), Accept: 'application/json' };
}

async function apiRequest(url, options = {}, timeoutMs = 15000) {
  const config = imageKitConfig();
  if (!config) throw new Error('ImageKit credentials are not configured');
  let response;
  for (let attempt = 0; attempt < 4; attempt++) {
    response = await fetch(url, {
      ...options,
      headers: { ...authHeaders(config), ...(options.headers || {}) },
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (response.status !== 429 || attempt === 3) break;
    const wait = Math.min(30000, Math.max(1000, Number(response.headers.get('x-ratelimit-reset') || 3000)));
    await new Promise(resolve => setTimeout(resolve, wait));
  }
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error('ImageKit API ' + response.status + ': ' + detail);
  }
  return response;
}

async function listFolderEntries(path, type) {
  const entries = [];
  const limit = 1000;
  for (let skip = 0; skip < 100000; skip += limit) {
    const url = new URL(API + '/files');
    url.searchParams.set('type', type);
    url.searchParams.set('path', path);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('skip', String(skip));
    const response = await apiRequest(url);
    const page = await response.json();
    if (!Array.isArray(page)) throw new Error('Unexpected ImageKit ' + type + '-list response');
    entries.push(...page);
    if (page.length < limit) break;
  }
  return entries;
}

export async function listImageKitFiles() {
  const files = [];
  const pendingFolders = ['/'];
  const visited = new Set();
  while (pendingFolders.length) {
    const path = pendingFolders.pop();
    if (visited.has(path) || visited.size > 5000) continue;
    visited.add(path);
    const [folderFiles, subfolders] = await Promise.all([
      listFolderEntries(path, 'file'),
      listFolderEntries(path, 'folder')
    ]);
    files.push(...folderFiles);
    for (const folder of subfolders) {
      const name = String(folder.name || '');
      if (!name || name === '.' || name === '..') continue;
      const childPath = (path === '/' ? '' : path) + '/' + name;
      if (!visited.has(childPath)) pendingFolders.push(childPath);
    }
  }
  return files;
}

export async function deleteImageKitFile(fileId) {
  if (!fileId || typeof fileId !== 'string') throw new Error('Missing ImageKit file ID');
  await apiRequest(API + '/files/' + encodeURIComponent(fileId), { method: 'DELETE' });
}

async function pruneOldFileVersions(file) {
  const currentVersionId = file.versionInfo?.id;
  if (!currentVersionId || !file.fileId) return { deleted: 0, extraBytes: 0, checked: false };
  const response = await apiRequest(API + '/files/' + encodeURIComponent(file.fileId) + '/versions');
  const versions = await response.json();
  if (!Array.isArray(versions)) throw new Error('Unexpected ImageKit version-list response');
  let deleted = 0;
  let extraBytes = 0;
  for (const version of versions) {
    const versionId = version.versionInfo?.id;
    if (!versionId) continue;
    if (versionId === currentVersionId) continue;
    const size = Math.max(0, Number(version.size) || 0);
    extraBytes += size;
    await apiRequest(API + '/files/' + encodeURIComponent(file.fileId) + '/versions/' + encodeURIComponent(versionId), { method: 'DELETE' });
    deleted++;
    console.log('ImageKit old poster version deleted:', file.name, versionId);
  }
  return { deleted, extraBytes, checked: true };
}

async function persistStorageSnapshot() {
  if (!storageSnapshot.known) return false;
  if (snapshotPersistPromise) return snapshotPersistPromise;
  const dirtyAtStart = snapshotDirtyUploads;
  const config = imageKitConfig();
  if (!config) return false;
  let persisted = false;
  snapshotPersistPromise = (async () => {
    const value = {
      version: 1,
      updatedAt: new Date().toISOString(),
      bytes: storageSnapshot.bytes,
      filesByPath: storageSnapshot.filesByPath
    };
    const form = new FormData();
    form.set('file', new Blob([JSON.stringify(value)], { type: 'application/json' }), 'imagekit-storage-snapshot.json');
    form.set('fileName', 'imagekit-storage-snapshot.json');
    form.set('folder', '/catalog-state');
    form.set('useUniqueFileName', 'false');
    form.set('overwriteFile', 'true');
    form.set('isPrivateFile', 'false');
    const response = await fetch(UPLOAD_API, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + Buffer.from(config.privateKey + ':').toString('base64') },
      body: form,
      signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) throw new Error('ImageKit storage snapshot upload failed (' + response.status + ')');
    const uploadMetadata = await response.json().catch(() => null);
    console.info('[imagekit-storage-snapshot-persisted]', JSON.stringify({
      filePath: uploadMetadata?.filePath || STORAGE_SNAPSHOT_PATH,
      bytes: Buffer.byteLength(JSON.stringify(value))
    }));
    snapshotDirtyUploads = Math.max(0, snapshotDirtyUploads - dirtyAtStart);
    persisted = true;
    return true;
  })().finally(() => {
    snapshotPersistPromise = null;
    // Retry once only when this write succeeded and newer uploads accumulated
    // while it was in flight. A failed network write must not create a hot loop.
    if (persisted && snapshotDirtyUploads >= 25) {
      setImmediate(() => void persistStorageSnapshot().catch(error => console.warn('[imagekit-storage-snapshot-persist-failed]', error?.message || 'unknown error')));
    }
  });
  return snapshotPersistPromise;
}

async function buildStorageSnapshotFromInventory() {
  // Stream the account inventory in small pages. Do not retain every ImageKit
  // file object in memory: only poster metadata is needed for overwrite safety.
  const filesByPath = {};
  const pendingFolders = ['/'];
  const visited = new Set();
  let accountBytes = 0;
  let posterFiles = 0;
  while (pendingFolders.length) {
    const path = pendingFolders.pop();
    if (visited.has(path)) continue;
    if (visited.size >= 2000) throw new Error('ImageKit inventory exceeded the 2,000-folder safety bound');
    visited.add(path);
    const subfolders = await listFolderEntries(path, 'folder');
    for (const folder of subfolders) {
      const name = String(folder.name || '');
      if (!name || name === '.' || name === '..') continue;
      const childPath = (path === '/' ? '' : path) + '/' + name;
      if (!visited.has(childPath)) pendingFolders.push(childPath);
    }
    for (let skip = 0; skip < 100000; skip += 250) {
      const url = new URL(API + '/files');
      url.searchParams.set('type', 'file');
      url.searchParams.set('path', path);
      url.searchParams.set('limit', '250');
      url.searchParams.set('skip', String(skip));
      const response = await apiRequest(url, {}, 12000);
      const page = await response.json();
      if (!Array.isArray(page)) throw new Error('Unexpected ImageKit file-list response');
      for (const file of page) {
        accountBytes += Math.max(0, Number(file.size) || 0);
        if (path === '/posters' && isPosterFolderFile(file)) {
          const id = imdbIdFromName(file.name);
          if (id && file.fileId) {
            filesByPath['/posters/' + id + '.jpg'] = { fileId: file.fileId, size: Math.max(0, Number(file.size) || 0) };
            posterFiles++;
          }
        } else if (file.filePath && (file.filePath.startsWith('/poster-versions/') || file.filePath.startsWith('/catalog-state/poster-pointers/')) && file.fileId) {
          filesByPath[file.filePath] = { fileId: file.fileId, size: Math.max(0, Number(file.size) || 0) };
        }
      }
      if (page.length < 250) break;
    }
  }
  storageSnapshot = { known: true, bytes: accountBytes, checkedAt: Date.now(), filesByPath };
  console.log('[imagekit-storage-inventory-built]', JSON.stringify({
    accountBytes, posterFiles, foldersVisited: visited.size, strategy: 'paged-incremental'
  }));
  try {
    await persistStorageSnapshot();
  } catch (error) {
    console.warn('[imagekit-storage-snapshot-persist-failed]', error?.message || 'unknown error');
  }
  return getImageKitStorageSnapshot();
}

export async function initializeImageKitStorageSnapshot() {
  if (storageSnapshot.known) return getImageKitStorageSnapshot();
  if (snapshotInitializationPromise) return snapshotInitializationPromise;
  if (Date.now() < snapshotRetryAfter) throw new Error('ImageKit storage snapshot retry is cooling down');
  snapshotInitializationPromise = (async () => {
    const config = imageKitConfig();
    if (!config) throw new Error('ImageKit credentials are not configured');
    const snapshotUrl = imageKitStorageSnapshotUrl(config.endpoint);
    try {
      const response = await fetch(snapshotUrl, { cache: 'no-store', signal: AbortSignal.timeout(12000) });
      if (response.ok) {
        const saved = await response.json();
        const savedAt = Date.parse(saved?.updatedAt || '');
        if (saved?.version === 1 && Number.isFinite(savedAt) &&
            Date.now() - savedAt >= 0 && Date.now() - savedAt < STORAGE_SNAPSHOT_TTL_MS &&
            Number.isFinite(saved.bytes) && saved.filesByPath && typeof saved.filesByPath === 'object') {
          storageSnapshot = {
            known: true,
            bytes: Math.max(0, Number(saved.bytes) || 0),
            checkedAt: savedAt,
            filesByPath: saved.filesByPath
          };
          console.log('[imagekit-storage-snapshot-restored]', JSON.stringify({
            accountBytes: storageSnapshot.bytes,
            indexedFiles: Object.keys(storageSnapshot.filesByPath).length,
            ageMinutes: Math.round((Date.now() - savedAt) / 60000)
          }));
          return getImageKitStorageSnapshot();
        }
      } else {
        console.warn('[imagekit-storage-snapshot-not-found]', JSON.stringify({ status: response.status }));
      }
    } catch (error) {
      console.warn('[imagekit-storage-snapshot-restore-failed]', error?.message || 'unknown error');
    }
    console.warn('[imagekit-storage-snapshot-rebuilding]', 'Saved snapshot unavailable; building bounded paged inventory');
    return buildStorageSnapshotFromInventory();
  })().catch(error => {
    snapshotRetryAfter = Date.now() + 60 * 1000;
    throw error;
  }).finally(() => { snapshotInitializationPromise = null; });
  return snapshotInitializationPromise;
}

export function getImageKitStorageSnapshot() {
  return { ...storageSnapshot };
}

export function hasImmutablePosterStorageCapacity(accountBytes, newSize) {
  if (!Number.isFinite(accountBytes) || accountBytes < 0 || !Number.isFinite(newSize) || newSize <= 0) return false;
  // Immutable versions add bytes; never subtract the previous poster size.
  return accountBytes + newSize + UPLOAD_HEADROOM_BYTES <= IMAGEKIT_STORAGE_LIMIT_BYTES;
}

export function canStoreImmutableImageKitPoster(newSize) {
  return storageSnapshot.known && hasImmutablePosterStorageCapacity(storageSnapshot.bytes, newSize);
}

export function canStoreImageKitPoster(imdbId, newSize) {
  if (!storageSnapshot.known || !Number.isFinite(newSize) || newSize <= 0) return false;
  const path = '/posters/' + imdbId + '.jpg';
  const existingSize = Number(storageSnapshot.filesByPath[path]?.size) || 0;
  return storageSnapshot.bytes - existingSize + newSize + UPLOAD_HEADROOM_BYTES <= IMAGEKIT_STORAGE_LIMIT_BYTES;
}

export function recordImageKitUpload(path, fileId, bytes) {
  if (!storageSnapshot.known || !path || !fileId || !Number.isFinite(bytes) || bytes <= 0) return;
  const previous = storageSnapshot.filesByPath[path];
  storageSnapshot.bytes = Math.max(0, storageSnapshot.bytes - (Number(previous?.size) || 0) + bytes);
  storageSnapshot.filesByPath[path] = { fileId, size: bytes };
  storageSnapshot.checkedAt = Date.now();
  snapshotDirtyUploads++;
  if (snapshotDirtyUploads >= 25) {
    void persistStorageSnapshot().catch(error => console.warn('[imagekit-storage-snapshot-persist-failed]', error?.message || 'unknown error'));
  }
}

export async function readPosterValidationMetadata(imdbId) {
  if (!/^tt\d{7,10}$/.test(String(imdbId || ''))) return null;
  const config = imageKitConfig();
  if (!config) return null;
  const url = new URL(config.endpoint + '/catalog-state/poster-validation/' + encodeURIComponent(imdbId) + '.json');
  url.searchParams.set('v', String(Math.floor(Date.now() / 300000)));
  try {
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(3000) });
    if (response.status === 404) return null;
    if (!response.ok) return null;
    const value = await response.json();
    return value && [1, 2].includes(value.version) && value.imdbId === imdbId ? value : null;
  } catch {
    return null;
  }
}

export async function savePosterValidationMetadata(imdbId, metadata) {
  if (!/^tt\d{7,10}$/.test(String(imdbId || ''))) return false;
  const config = imageKitConfig();
  if (!config) return false;
  const value = {
    version: 2,
    imdbId,
    releaseDate: metadata?.releaseDate || null,
    releaseKind: metadata?.releaseKind || null,
    justAdded: metadata?.justAdded === true,
    digitalReleasedWorldwide: metadata?.digitalReleasedWorldwide === true,
    uploadedAt: metadata?.uploadedAt || new Date().toISOString()
  };
  const form = new FormData();
  const bytes = Buffer.from(JSON.stringify(value));
  form.set('file', new Blob([bytes], { type: 'application/json' }), imdbId + '.json');
  form.set('fileName', imdbId + '.json');
  form.set('folder', '/catalog-state/poster-validation');
  form.set('useUniqueFileName', 'false');
  form.set('overwriteFile', 'true');
  form.set('isPrivateFile', 'false');
  const response = await fetch(UPLOAD_API, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(config.privateKey + ':').toString('base64') },
    body: form,
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) {
    throw new Error('ImageKit poster validation metadata upload failed (' + response.status + '): ' + (await response.text()).slice(0, 200));
  }
  return true;
}

export function isRetryableImageKitUploadStatus(status) {
  return [408, 425, 429, 500, 502, 503, 504].includes(Number(status));
}

export async function uploadPosterToImageKit(imdbId, poster) {
  const config = imageKitConfig();
  if (!config) return { stored: false, reason: 'imagekit-not-configured' };
  if (!canStoreImageKitPoster(imdbId, poster.bytes.length)) {
    return { stored: false, reason: 'storage-safety-ceiling-reached' };
  }

  const form = new FormData();
  form.set('file', new Blob([poster.bytes], { type: poster.type }), imdbId + '.jpg');
  form.set('fileName', imdbId + '.jpg');
  form.set('folder', '/posters');
  form.set('useUniqueFileName', 'false');
  form.set('overwriteFile', 'true');
  form.set('isPrivateFile', 'false');

  let response;
  
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      response = await fetch(UPLOAD_API, {
        method: 'POST',
        headers: { Authorization: 'Basic ' + Buffer.from(config.privateKey + ':').toString('base64') },
        body: form,
        signal: AbortSignal.timeout(20000)
      });
    } catch (error) {
      if (attempt === 4) throw new Error('ImageKit upload request failed after four attempts: ' + (error?.message || 'network error'));
      const delay = Math.min(12000, 1500 * (2 ** (attempt - 1)));
      console.warn('[imagekit-upload-retry]', JSON.stringify({ imdbId, attempt, nextDelayMs: delay, error: error?.message || 'network error' }));
      await new Promise(resolve => setTimeout(resolve, delay));
      continue;
    }
    if (response.ok) break;
    const status = response.status;
    const detail = (await response.text()).slice(0, 300);
    if (!isRetryableImageKitUploadStatus(status) || attempt === 4) {
      throw new Error('ImageKit upload failed (' + status + '): ' + detail);
    }
    const delay = Math.min(12000, 1500 * (2 ** (attempt - 1)));
    console.warn('[imagekit-upload-retry]', JSON.stringify({ imdbId, attempt, status, nextDelayMs: delay }));
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  if (!response?.ok) throw new Error('ImageKit upload failed without a successful response');
  const result = await response.json();
  if (!result.url || !result.fileId) throw new Error('ImageKit upload response did not include file identity');
  recordImageKitUpload('/posters/' + imdbId + '.jpg', result.fileId, poster.bytes.length);
  if (/^tt\d{7,10}$/.test(imdbId) && poster && typeof poster.status === 'string') {
    try {
      await savePosterValidationMetadata(imdbId, {
        releaseDate: poster.releaseDate === 'none' ? null : poster.releaseDate,
        releaseKind: poster.releaseKind === 'none' ? null : poster.releaseKind,
        justAdded: poster.status.includes('just-added'),
        digitalReleasedWorldwide: poster.digitalReleasedWorldwide === true,
        uploadedAt: new Date().toISOString()
      });
    } catch (error) {
      console.warn('[poster-validation-sidecar-save-failed]', JSON.stringify({
        imdbId, error: error?.message || 'unknown error'
      }));
    }
  }
  console.log('ImageKit upcoming poster stored:', imdbId, poster.bytes.length, 'bytes');
  return { stored: true, url: result.url, fileId: result.fileId };
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const parsed = new Date(value + 'T00:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

async function tmdbJson(path) {
  const token = process.env.TMDB_API_READ_ACCESS_TOKEN || '';
  const apiKey = process.env.TMDB_API_KEY || '';
  if (!token && !apiKey) throw new Error('TMDB credentials unavailable');
  const url = new URL('https://api.themoviedb.org/3' + path);
  const headers = { accept: 'application/json' };
  if (token) headers.authorization = 'Bearer ' + token;
  else url.searchParams.set('api_key', apiKey);
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('TMDB HTTP ' + response.status);
  return response.json();
}

async function getReleaseStatus(imdbId, today) {
  const found = await tmdbJson('/find/' + encodeURIComponent(imdbId) + '?external_source=imdb_id');
  const movie = found.movie_results?.[0];
  if (movie?.id) {
    const data = await tmdbJson('/movie/' + movie.id + '/release_dates');
    const allDates = (data.results || []).flatMap(region => (region.release_dates || [])
      .map(item => ({ date: (item.release_date || '').slice(0, 10), type: item.type }))
      .filter(item => validDate(item.date)));
    const digitalDates = allDates.filter(item => item.type === 4).map(item => item.date);
    const future = digitalDates.filter(date => date > today).sort();
    if (future.length) return { status: 'upcoming', date: future[0] };
    if (digitalDates.length) return { status: 'expired', date: digitalDates.sort().at(-1) };
    if (allDates.length || validDate(movie.release_date)) {
      return { status: 'ineligible', reason: 'Movie has no upcoming digital release date' };
    }
    return { status: 'unknown', reason: 'TMDB movie has no usable digital release date' };
  }

  const show = found.tv_results?.[0];
  if (show?.id) {
    const details = await tmdbJson('/tv/' + show.id);
    const next = details.next_episode_to_air?.air_date;
    if (validDate(next)) {
      return next > today ? { status: 'upcoming', date: next } : { status: 'expired', date: next };
    }
    const premiere = details.first_air_date;
    if (validDate(premiere)) {
      return premiere > today ? { status: 'upcoming', date: premiere } : { status: 'expired', date: premiere };
    }
    return { status: 'unknown', reason: 'TMDB series has no usable episode or premiere date' };
  }
  return { status: 'unknown', reason: 'IMDb ID not found in TMDB' };
}

function isPosterFolderFile(file) {
  const path = String(file.filePath || '').replace(/\/$/, '');
  return path.startsWith('/posters/') && typeof file.name === 'string';
}

function imdbIdFromName(name) {
  const match = String(name || '').match(/^(tt\d{7,10})(?:_[^.]+)?\.jpg$/i);
  return match?.[1] || null;
}

export function shouldDeleteUnpointedVersion(file, {
  activePaths = new Set(), unknownPointerIds = new Set(),
  now = Date.now(), retentionMs = VERSIONED_POSTER_RETENTION_MS
} = {}) {
  const path = String(file?.filePath || '');
  const match = path.match(/^\/poster-versions\/(tt\d{7,10})\/([a-f0-9]{64})\.jpg$/);
  if (!match || unknownPointerIds.has(match[1]) || activePaths.has(path)) return false;
  const createdAt = Date.parse(file.createdAt || file.updatedAt || '');
  return Number.isFinite(createdAt) && now - createdAt >= retentionMs;
}

export async function runImageKitMaintenance({ force = false } = {}) {
  if (maintenancePromise) return maintenancePromise;
  if (!force && lastMaintenanceReport && Date.now() - lastMaintenanceAt < MAINTENANCE_COOLDOWN_MS) {
    return { ...lastMaintenanceReport, skipped: 'maintenance-cooldown' };
  }

  maintenancePromise = (async () => {
    const files = await listImageKitFiles();
    let accountBytes = files.reduce((sum, file) => sum + Math.max(0, Number(file.size) || 0), 0);
    const posterFiles = files.filter(isPosterFolderFile);
    const byId = new Map();
    for (const file of posterFiles) {
      const id = imdbIdFromName(file.name);
      if (!id) continue;
      if (!byId.has(id)) byId.set(id, []);
      byId.get(id).push(file);
    }

    const deletedFileIds = new Set();
    let duplicatesDeleted = 0;
    let expiredDeleted = 0;
    let unknownRetained = 0;
    let versionsDeleted = 0;
    let versionChecksFailed = 0;
    const active = [];
    const today = new Date().toISOString().slice(0, 10);

    // Versioned assets are never pruned unless a valid pointer has been read
    // back for that IMDb ID. A missing/unreadable pointer makes the whole ID
    // ineligible for cleanup, preventing accidental deletion of a live target.
    const versionedById = new Map();
    const pointerFilesById = new Map();
    for (const file of files) {
      const versionMatch = String(file.filePath || '').match(/^\/poster-versions\/(tt\d{7,10})\/[a-f0-9]{64}\.jpg$/);
      if (versionMatch) {
        if (!versionedById.has(versionMatch[1])) versionedById.set(versionMatch[1], []);
        versionedById.get(versionMatch[1]).push(file);
      }
      const pointerMatch = String(file.filePath || '').match(/^\/catalog-state\/poster-pointers\/(tt\d{7,10})\.json$/);
      if (pointerMatch) pointerFilesById.set(pointerMatch[1], file);
    }
    const activeVersionPaths = new Set();
    const unknownPointerIds = new Set();
    const config = imageKitConfig();
    for (const id of versionedById.keys()) {
      const pointerFile = pointerFilesById.get(id);
      if (!pointerFile || !config) {
        unknownPointerIds.add(id);
        continue;
      }
      try {
        const pointerUrl = config.endpoint + pointerFile.filePath + '?maintenance=' + Date.now();
        const response = await fetch(pointerUrl, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
        if (!response.ok) {
          unknownPointerIds.add(id);
          continue;
        }
        const pointer = await response.json();
        const expectedUrl = new URL(config.endpoint + pointer?.assetPath);
        const actualUrl = new URL(pointer?.assetUrl || 'https://invalid.invalid');
        const urlMatches = actualUrl.protocol === 'https:' &&
          actualUrl.origin === expectedUrl.origin && actualUrl.pathname === expectedUrl.pathname;
        if (!isValidPosterPointer(pointer, id) || !urlMatches) {
          unknownPointerIds.add(id);
          continue;
        }
        const targetExists = versionedById.get(id).some(file => file.filePath === pointer.assetPath);
        if (!targetExists) {
          unknownPointerIds.add(id);
          continue;
        }
        activeVersionPaths.add(pointer.assetPath);
      } catch {
        unknownPointerIds.add(id);
      }
    }

    let versionedFilesDeleted = 0;
    let pointedVersionAssetsRetained = activeVersionPaths.size;
    for (const [id, versions] of versionedById) {
      if (unknownPointerIds.has(id)) continue;
      for (const file of versions) {
        if (!shouldDeleteUnpointedVersion(file, { activePaths: activeVersionPaths, unknownPointerIds })) continue;
        if (!file.fileId) continue;
        await deleteImageKitFile(file.fileId);
        deletedFileIds.add(file.fileId);
        accountBytes = Math.max(0, accountBytes - Math.max(0, Number(file.size) || 0));
        versionedFilesDeleted++;
      }
    }

    // Remove only duplicate copies inside our dedicated /posters folder.
    for (const [id, copies] of byId) {
      if (copies.length < 2) continue;
      const canonical = copies.filter(file => file.name.toLowerCase() === (id + '.jpg').toLowerCase());
      if (!canonical.length) {
        // Non-canonical variants are not used by the public URL scheme.
        // Remove them; an active title will be re-created at the stable ID path.
        for (const file of copies) {
          if (!file.fileId) continue;
          await deleteImageKitFile(file.fileId);
          deletedFileIds.add(file.fileId);
          accountBytes = Math.max(0, accountBytes - (Number(file.size) || 0));
          duplicatesDeleted++;
        }
        byId.set(id, []);
        continue;
      }
      const keep = canonical.sort((a, b) => Date.parse(b.updatedAt || b.createdAt || 0) - Date.parse(a.updatedAt || a.createdAt || 0))[0];
      for (const file of copies) {
        if (file.fileId === keep.fileId) continue;
        await deleteImageKitFile(file.fileId);
        deletedFileIds.add(file.fileId);
        accountBytes = Math.max(0, accountBytes - (Number(file.size) || 0));
        duplicatesDeleted++;
      }
      byId.set(id, [keep]);
    }

    for (const [id, copies] of byId) {
      const current = copies.find(file => file.name.toLowerCase() === (id + '.jpg').toLowerCase());
      if (!current && copies.length) {
        for (const file of copies) {
          if (!file.fileId) continue;
          await deleteImageKitFile(file.fileId);
          accountBytes = Math.max(0, accountBytes - (Number(file.size) || 0));
          duplicatesDeleted++;
        }
        byId.set(id, []);
        continue;
      }
      if (!current || !current.fileId) continue;
      try {
        try {
          const versionResult = await pruneOldFileVersions(current);
          versionsDeleted += versionResult.deleted;
          accountBytes = Math.max(0, accountBytes + versionResult.extraBytes);
        } catch (versionError) {
          versionChecksFailed++;
          console.warn('ImageKit old versions retained; version audit failed:', id, versionError.message);
        }
        const status = await getReleaseStatus(id, today);
        if (status.status === 'expired' || status.status === 'ineligible') {
          // The folder now stores the complete Nuvio poster cache, not only
          // upcoming-release assets. Keep the artwork; the request pipeline
          // refreshes badge state before it is served.
          unknownRetained++;
          console.log('ImageKit general poster cache retained:', id, status.date || status.reason);
        } else if (status.status === 'upcoming') {
          active.push({ id, date: status.date, file: current });
        } else {
          unknownRetained++;
          console.warn('ImageKit poster retained; release status unknown:', id, status.reason);
        }
      } catch (error) {
        unknownRetained++;
        console.warn('ImageKit poster retained; TMDB check failed:', id, error.message);
      }
    }

    // Keep at least 25% of a 3 GB allowance free. If unrelated account
    // assets already consume the reserve, stop adding posters; never delete
    // anything outside our own /posters directory.
    const removedForBudget = [];
    if (accountBytes > IMAGEKIT_STORAGE_LIMIT_BYTES) {
      const farthestFirst = active.sort((a, b) => b.date.localeCompare(a.date));
      for (const item of farthestFirst) {
        if (accountBytes <= IMAGEKIT_STORAGE_LIMIT_BYTES) break;
        await deleteImageKitFile(item.file.fileId);
        deletedFileIds.add(item.file.fileId);
        accountBytes = Math.max(0, accountBytes - (Number(item.file.size) || 0));
        removedForBudget.push({ id: item.id, date: item.date });
        console.warn('ImageKit poster removed to preserve storage reserve:', item.id, item.date);
      }
    }

    const filesByPath = {};
    for (const file of files) {
      if (file.filePath && file.fileId && !deletedFileIds.has(file.fileId)) filesByPath[file.filePath] = { fileId: file.fileId, size: Number(file.size) || 0 };
    }
    storageSnapshot = { known: true, bytes: accountBytes, checkedAt: Date.now(), filesByPath };
    await persistStorageSnapshot().catch(error => console.warn('[imagekit-storage-snapshot-persist-failed]', error?.message || 'unknown error'));
    const report = {
      checkedAt: new Date().toISOString(),
      accountFiles: files.length,
      accountBytes,
      accountGiB: Number((accountBytes / (1024 ** 3)).toFixed(3)),
      safetyCeilingBytes: IMAGEKIT_STORAGE_LIMIT_BYTES,
      posterFilesScanned: posterFiles.length,
      duplicatesDeleted,
      expiredDeleted,
      unknownRetained,
      versionsDeleted,
      versionChecksFailed,
      versionedFilesDeleted,
      pointedVersionAssetsRetained,
      versionedIdsRetainedForPointerSafety: unknownPointerIds.size,
      removedForBudget,
      uploadsAllowed: accountBytes < IMAGEKIT_STORAGE_LIMIT_BYTES
    };
    lastMaintenanceAt = Date.now();
    lastMaintenanceReport = report;
    console.log('ImageKit storage maintenance:', JSON.stringify(report));
    return report;
  })().finally(() => { maintenancePromise = null; });

  return maintenancePromise;
}
