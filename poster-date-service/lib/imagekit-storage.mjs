import { Buffer } from 'node:buffer';

const API = 'https://api.imagekit.io/v1';
const UPLOAD_API = 'https://upload.imagekit.io/api/v1/files/upload';
export const IMAGEKIT_STORAGE_LIMIT_BYTES = Math.floor(2.4 * 1024 * 1024 * 1024);
const MAINTENANCE_COOLDOWN_MS = 6 * 60 * 60 * 1000;
let storageSnapshot = { known: false, bytes: 0, checkedAt: 0 };
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

export async function listImageKitFiles() {
  const files = [];
  const limit = 1000;
  for (let skip = 0; skip < 100000; skip += limit) {
    const url = new URL(API + '/files');
    url.searchParams.set('type', 'file');
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('skip', String(skip));
    const response = await apiRequest(url);
    const page = await response.json();
    if (!Array.isArray(page)) throw new Error('Unexpected ImageKit file-list response');
    files.push(...page);
    if (page.length < limit) break;
  }
  return files;
}

export async function deleteImageKitFile(fileId) {
  if (!fileId || typeof fileId !== 'string') throw new Error('Missing ImageKit file ID');
  await apiRequest(API + '/files/' + encodeURIComponent(fileId), { method: 'DELETE' });
}

export function getImageKitStorageSnapshot() {
  return { ...storageSnapshot };
}

export function recordImageKitUpload(bytes) {
  if (storageSnapshot.known && Number.isFinite(bytes) && bytes > 0) {
    storageSnapshot.bytes += bytes;
    storageSnapshot.checkedAt = Date.now();
  }
}

export async function uploadPosterToImageKit(imdbId, poster) {
  const config = imageKitConfig();
  if (!config) return { stored: false, reason: 'imagekit-not-configured' };
  if (!storageSnapshot.known) return { stored: false, reason: 'storage-inventory-not-yet-verified' };
  if (storageSnapshot.bytes + poster.bytes.length > IMAGEKIT_STORAGE_LIMIT_BYTES) {
    return { stored: false, reason: 'storage-safety-ceiling-reached' };
  }

  const form = new FormData();
  form.set('file', new Blob([poster.bytes], { type: poster.type }), imdbId + '.jpg');
  form.set('fileName', imdbId + '.jpg');
  form.set('folder', '/posters');
  form.set('useUniqueFileName', 'false');
  form.set('overwriteFile', 'true');
  form.set('isPrivateFile', 'false');
  form.set('tags', JSON.stringify(['great-indian-addon', 'upcoming-date-poster']));

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
  recordImageKitUpload(poster.bytes.length);
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
    const dates = (data.results || []).flatMap(region => (region.release_dates || [])
      .map(item => (item.release_date || '').slice(0, 10)).filter(validDate));
    const future = dates.filter(date => date > today).sort();
    if (future.length) return { status: 'upcoming', date: future[0] };
    if (dates.length) return { status: 'expired', date: dates.sort().at(-1) };
    if (validDate(movie.release_date)) {
      return movie.release_date > today
        ? { status: 'upcoming', date: movie.release_date }
        : { status: 'expired', date: movie.release_date };
    }
    return { status: 'unknown', reason: 'TMDB movie has no usable release date' };
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
  return path === '/posters' && typeof file.name === 'string';
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

    let duplicatesDeleted = 0;
    let expiredDeleted = 0;
    let unknownRetained = 0;
    const active = [];
    const today = new Date().toISOString().slice(0, 10);

    // Remove only duplicate copies inside our dedicated /posters folder.
    for (const [id, copies] of byId) {
      if (copies.length < 2) continue;
      const canonical = copies.filter(file => file.name.toLowerCase() === (id + '.jpg').toLowerCase());
      if (!canonical.length) continue;
      const keep = canonical.sort((a, b) => Date.parse(b.updatedAt || b.createdAt || 0) - Date.parse(a.updatedAt || a.createdAt || 0))[0];
      for (const file of copies) {
        if (file.fileId === keep.fileId) continue;
        await deleteImageKitFile(file.fileId);
        accountBytes = Math.max(0, accountBytes - (Number(file.size) || 0));
        duplicatesDeleted++;
      }
    }

    for (const [id, copies] of byId) {
      const current = copies.find(file => file.name.toLowerCase() === (id + '.jpg').toLowerCase()) || copies[0];
      if (!current || !current.fileId) continue;
      try {
        const status = await getReleaseStatus(id, today);
        if (status.status === 'expired') {
          await deleteImageKitFile(current.fileId);
          accountBytes = Math.max(0, accountBytes - (Number(current.size) || 0));
          expiredDeleted++;
          console.log('ImageKit expired poster deleted:', id, status.date);
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

    // Keep at least 20% of the 3 GB allowance free. If unrelated account
    // assets already consume the reserve, stop adding posters; never delete
    // anything outside our own /posters directory.
    const removedForBudget = [];
    if (accountBytes > IMAGEKIT_STORAGE_LIMIT_BYTES) {
      const farthestFirst = active.sort((a, b) => b.date.localeCompare(a.date));
      for (const item of farthestFirst) {
        if (accountBytes <= IMAGEKIT_STORAGE_LIMIT_BYTES) break;
        await deleteImageKitFile(item.file.fileId);
        accountBytes = Math.max(0, accountBytes - (Number(item.file.size) || 0));
        removedForBudget.push({ id: item.id, date: item.date });
        console.warn('ImageKit poster removed to preserve storage reserve:', item.id, item.date);
      }
    }

    storageSnapshot = { known: true, bytes: accountBytes, checkedAt: Date.now() };
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
