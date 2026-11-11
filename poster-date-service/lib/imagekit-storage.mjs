import { Buffer } from 'node:buffer';

const API = 'https://api.imagekit.io/v1';
const UPLOAD_API = 'https://upload.imagekit.io/api/v1/files/upload';
export const IMAGEKIT_STORAGE_LIMIT_BYTES = Math.floor(2.25 * 1000 * 1000 * 1000);
const MAINTENANCE_COOLDOWN_MS = 6 * 60 * 60 * 1000;
let storageSnapshot = { known: false, bytes: 0, checkedAt: 0, filesByPath: {} };
const UPLOAD_HEADROOM_BYTES = 32 * 1024 * 1024;
let maintenancePromise;
let lastMaintenanceAt = 0;
let lastMaintenanceReport = null;

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

export function getImageKitStorageSnapshot() {
  return { ...storageSnapshot };
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

  const response = await fetch(UPLOAD_API, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(config.privateKey + ':').toString('base64') },
    body: form,
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error('ImageKit upload failed (' + response.status + '): ' + detail);
  }
  const result = await response.json();
  if (!result.url || !result.fileId) throw new Error('ImageKit upload response did not include file identity');
  recordImageKitUpload('/posters/' + imdbId + '.jpg', result.fileId, poster.bytes.length);
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
          await deleteImageKitFile(current.fileId);
          deletedFileIds.add(current.fileId);
          accountBytes = Math.max(0, accountBytes - (Number(current.size) || 0));
          expiredDeleted++;
          console.log('ImageKit ineligible or expired poster deleted:', id, status.date || status.reason);
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
