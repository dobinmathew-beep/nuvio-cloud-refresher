import { Buffer } from 'node:buffer';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { imageKitConfig } from '../lib/imagekit-storage.mjs';

const API = 'https://api.imagekit.io/v1';
const PAGE_SIZE = 1000;
const MAX_PAGES_PER_FOLDER = 100;
const MAX_FOLDERS = 5000;
const VERSION_CONCURRENCY = Math.max(1, Math.min(4, Number(process.env.IMAGEKIT_AUDIT_VERSION_CONCURRENCY) || 2));
const now = Date.now();
const DAY = 86400000;
const bytes = value => Math.max(0, Number(value) || 0);
const dateMs = value => { const n = Date.parse(value || ''); return Number.isFinite(n) ? n : null; };
const categoryFor = path => {
  const p = String(path || '/').toLowerCase();
  if (p.startsWith('/posters/')) return 'posters';
  if (p.startsWith('/poster-versions/')) return 'poster-versions';
  if (p.startsWith('/catalog-state/')) return 'catalog-state';
  if (p.startsWith('/backdrops/')) return 'backdrops';
  if (p.startsWith('/hero/') || p.startsWith('/reels/')) return 'hero-reels';
  if (p.startsWith('/epg/')) return 'epg';
  return 'other';
};
const authHeaders = config => ({
  Authorization: 'Basic ' + Buffer.from(config.privateKey + ':').toString('base64'),
  Accept: 'application/json'
});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function getJson(config, url) {
  let lastError;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const response = await fetch(url, { headers: authHeaders(config), signal: AbortSignal.timeout(30000) });
      if (response.status === 429 || response.status >= 500) {
        const retry = Number(response.headers.get('x-ratelimit-reset') || response.headers.get('retry-after')) || 0;
        lastError = new Error('HTTP ' + response.status + ': ' + (await response.text()).slice(0, 300));
        if (attempt < 5) { await sleep(Math.min(30000, Math.max(1500, retry * (retry < 1000 ? 1000 : 1), 1500 * (attempt + 1)))); continue; }
      }
      if (!response.ok) throw new Error('HTTP ' + response.status + ': ' + (await response.text()).slice(0, 300));
      return { data: await response.json(), requestId: response.headers.get('x-ik-requestId') || null };
    } catch (error) {
      lastError = error;
      if (attempt < 5 && /fetch failed|timeout|network|HTTP 429|HTTP 5\d\d/i.test(error.message)) {
        await sleep(Math.min(30000, 1000 * (attempt + 1)));
        continue;
      }
      throw error;
    }
  }
  throw lastError || new Error('ImageKit read failed');
}

async function listFolder(config, path, type, audit) {
  const all = [];
  let pageCount = 0;
  for (let skip = 0; pageCount < MAX_PAGES_PER_FOLDER; skip += PAGE_SIZE) {
    const url = new URL(API + '/files');
    url.searchParams.set('type', type);
    url.searchParams.set('path', path);
    url.searchParams.set('limit', String(PAGE_SIZE));
    url.searchParams.set('skip', String(skip));
    const { data, requestId } = await getJson(config, url);
    if (!Array.isArray(data)) throw new Error('Unexpected ' + type + ' listing for ' + path);
    pageCount++;
    audit.apiRequests++;
    if (requestId) audit.requestIds.push(requestId);
    all.push(...data);
    if (data.length < PAGE_SIZE) return { items: all, pages: pageCount, complete: true };
  }
  return { items: all, pages: pageCount, complete: false };
}

async function inventory(config) {
  const audit = { apiRequests: 0, requestIds: [], folderCount: 0, folderListingFailures: [], fileListingFailures: [], truncatedFolders: [] };
  const files = [];
  const folders = ['/'];
  const visited = new Set();
  const folderPages = {};
  while (folders.length) {
    const path = folders.shift();
    if (visited.has(path)) continue;
    if (visited.size >= MAX_FOLDERS) {
      audit.truncatedFolders.push({ path, reason: 'MAX_FOLDERS safety limit reached' });
      break;
    }
    visited.add(path);
    let childFolders;
    try {
      const result = await listFolder(config, path, 'folder', audit);
      childFolders = result.items;
      folderPages[path] = { pages: result.pages, complete: result.complete };
      if (!result.complete) audit.truncatedFolders.push({ path, type: 'folder', reason: 'pagination ceiling reached' });
    } catch (error) {
      audit.folderListingFailures.push({ path, error: String(error.message || error).slice(0, 400) });
      continue;
    }
    for (const folder of childFolders) {
      const name = String(folder.name || '');
      if (!name || name === '.' || name === '..') continue;
      const childPath = (path === '/' ? '' : path) + '/' + name;
      if (!visited.has(childPath)) folders.push(childPath);
    }
    try {
      const result = await listFolder(config, path, 'file', audit);
      files.push(...result.items.map(file => ({ ...file, __listedFrom: path })));
      folderPages[path].files = { pages: result.pages, complete: result.complete, count: result.items.length };
      if (!result.complete) audit.truncatedFolders.push({ path, type: 'file', reason: 'pagination ceiling reached' });
    } catch (error) {
      audit.fileListingFailures.push({ path, error: String(error.message || error).slice(0, 400) });
    }
    audit.folderCount = visited.size;
    if (visited.size % 100 === 0) console.log('[imagekit-forensic-inventory-progress]', JSON.stringify({ folders: visited.size, files: files.length, queuedFolders: folders.length }));
  }
  const unique = new Map();
  const duplicateIds = [];
  for (const file of files) {
    if (!file.fileId) continue;
    if (unique.has(file.fileId)) duplicateIds.push({ fileId: file.fileId, paths: [unique.get(file.fileId).filePath, file.filePath] });
    else unique.set(file.fileId, file);
  }
  return { files: [...unique.values()], audit: { ...audit, duplicateFileIdCount: duplicateIds.length, duplicateFileIds: duplicateIds, folderPages } };
}

async function readUsage(config) {
  const startDate = new Date(now - DAY).toISOString().slice(0, 10);
  const endDate = new Date(now + DAY).toISOString().slice(0, 10);
  const url = new URL(API + '/accounts/usage');
  url.searchParams.set('startDate', startDate);
  url.searchParams.set('endDate', endDate);
  const { data, requestId } = await getJson(config, url);
  const usage = Array.isArray(data) ? data[0] : (data?.data?.[0] || data);
  const fields = ['mediaLibraryStorageBytes', 'originalCacheStorageBytes', 'bandwidthBytes', 'videoProcessingUnitsCount', 'extensionUnitsCount'];
  const metrics = Object.fromEntries(fields.map(key => [key, usage?.[key] ?? null]));
  return { startDate, endDate, requestId, responseKeys: Object.keys(usage || {}), metrics, rawSample: usage };
}

async function mapLimit(items, limit, fn) {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) { const item = items[cursor++]; await fn(item); }
  }));
}

async function main() {
  const config = imageKitConfig();
  if (!config) throw new Error('ImageKit credentials are not configured');
  console.log('[imagekit-forensic-audit] READ ONLY: no delete, upload, move, or update calls');
  const usage = await readUsage(config).catch(error => ({ error: error.message, metrics: null }));
  const { files, audit } = await inventory(config);
  const folderStats = {};
  const categoryStats = {};
  let currentBytes = 0;
  const seenPaths = new Map();
  for (const file of files) {
    const path = String(file.filePath || '/');
    const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) || '/' : '/';
    const size = bytes(file.size);
    currentBytes += size;
    const cat = categoryFor(path);
    const f = folderStats[folder] ||= { files: 0, currentBytes: 0, categories: {} };
    f.files++; f.currentBytes += size; f.categories[cat] = (f.categories[cat] || 0) + 1;
    const c = categoryStats[cat] ||= { files: 0, currentBytes: 0 };
    c.files++; c.currentBytes += size;
    if (seenPaths.has(path)) seenPaths.set(path, seenPaths.get(path) + 1); else seenPaths.set(path, 1);
  }

  const versionRows = [];
  const versionFailures = [];
  const versionIntegrity = { currentVersionMissing: [], currentVersionSizeMismatch: [], duplicateVersionIds: [] };
  let processed = 0;
  await mapLimit(files, VERSION_CONCURRENCY, async file => {
    try {
      const url = API + '/files/' + encodeURIComponent(file.fileId) + '/versions';
      const { data, requestId } = await getJson(config, url);
      audit.apiRequests++;
      if (requestId) audit.requestIds.push(requestId);
      if (!Array.isArray(data)) throw new Error('Unexpected version response');
      const currentId = file.versionInfo?.id || null;
      const versions = data.map(v => {
        const id = v.versionInfo?.id || null;
        const createdAt = v.createdAt || v.updatedAt || null;
        const timestamp = dateMs(createdAt);
        return {
          versionId: id, isCurrent: Boolean(id && id === currentId), bytes: bytes(v.size),
          createdAt, ageDays: timestamp === null ? null : Math.max(0, (now - timestamp) / DAY),
          unknownDate: timestamp === null
        };
      });
      const currentVersion = versions.find(v => v.isCurrent);
      if (currentId && !currentVersion) versionIntegrity.currentVersionMissing.push({ fileId: file.fileId, path: file.filePath || null, currentVersionId: currentId });
      if (currentVersion && currentVersion.bytes !== bytes(file.size)) versionIntegrity.currentVersionSizeMismatch.push({ fileId: file.fileId, path: file.filePath || null, listedFileBytes: bytes(file.size), currentVersionBytes: currentVersion.bytes });
      const ids = versions.map(v => v.versionId).filter(Boolean);
      if (new Set(ids).size !== ids.length) versionIntegrity.duplicateVersionIds.push({ fileId: file.fileId, path: file.filePath || null });
      const history = versions.filter(v => !v.isCurrent);
      const newestFirst = [...history].sort((a,b) => (dateMs(b.createdAt) || 0) - (dateMs(a.createdAt) || 0));
      const posterKeepOnePotential = categoryFor(file.filePath) === 'posters' ? newestFirst.slice(1) : [];
      const older30 = history.filter(v => v.ageDays !== null && v.ageDays >= 30);
      const older90 = history.filter(v => v.ageDays !== null && v.ageDays >= 90);
      versionRows.push({
        fileId: file.fileId, path: file.filePath || null, category: categoryFor(file.filePath),
        currentVersionId: currentId, currentFileBytes: bytes(file.size),
        versionsListed: versions.length, historyCount: history.length,
        historyBytes: history.reduce((s,v)=>s+v.bytes,0),
        olderThan30DaysCount: older30.length, olderThan30DaysBytes: older30.reduce((s,v)=>s+v.bytes,0),
        olderThan90DaysCount: older90.length, olderThan90DaysBytes: older90.reduce((s,v)=>s+v.bytes,0),
        unknownDateCount: history.filter(v=>v.unknownDate).length,
        posterHistoricalBeyondNewestOneCount: posterKeepOnePotential.length,
        posterHistoricalBeyondNewestOneBytes: posterKeepOnePotential.reduce((s,v)=>s+v.bytes,0),
        versions
      });
    } catch (error) {
      versionFailures.push({ fileId: file.fileId, path: file.filePath || null, error: String(error.message || error).slice(0,400) });
    } finally {
      processed++;
      if (processed % 250 === 0) console.log('[imagekit-forensic-version-progress]', JSON.stringify({ processed, total: files.length, failures: versionFailures.length }));
    }
  });

  const historyByCategory = {};
  const historyByFolder = {};
  for (const row of versionRows) {
    const c = historyByCategory[row.category] ||= { filesChecked: 0, historyCount: 0, historyBytes: 0, olderThan30DaysCount: 0, olderThan30DaysBytes: 0, olderThan90DaysCount: 0, olderThan90DaysBytes: 0, unknownDateCount: 0 };
    c.filesChecked++; c.historyCount += row.historyCount; c.historyBytes += row.historyBytes;
    c.olderThan30DaysCount += row.olderThan30DaysCount; c.olderThan30DaysBytes += row.olderThan30DaysBytes;
    c.olderThan90DaysCount += row.olderThan90DaysCount; c.olderThan90DaysBytes += row.olderThan90DaysBytes; c.unknownDateCount += row.unknownDateCount;
    const folder = String(row.path || '/').slice(0, String(row.path || '/').lastIndexOf('/')) || '/';
    const f = historyByFolder[folder] ||= { filesChecked: 0, historyCount: 0, historyBytes: 0, olderThan30DaysBytes: 0, olderThan90DaysBytes: 0 };
    f.filesChecked++; f.historyCount += row.historyCount; f.historyBytes += row.historyBytes;
    f.olderThan30DaysBytes += row.olderThan30DaysBytes; f.olderThan90DaysBytes += row.olderThan90DaysBytes;
  }

  const historicalBytes = versionRows.reduce((s,r)=>s+r.historyBytes,0);
  const reconciledBytes = currentBytes + historicalBytes;
  const posterExcessCount = versionRows.reduce((s,r)=>s+r.posterHistoricalBeyondNewestOneCount,0);
  const posterExcessBytes = versionRows.reduce((s,r)=>s+r.posterHistoricalBeyondNewestOneBytes,0);
  const complete = audit.folderListingFailures.length === 0 && audit.fileListingFailures.length === 0 &&
    audit.truncatedFolders.length === 0 && versionFailures.length === 0 && files.length > 0 &&
    versionIntegrity.currentVersionMissing.length === 0 && versionIntegrity.currentVersionSizeMismatch.length === 0 && versionIntegrity.duplicateVersionIds.length === 0;
  const report = {
    generatedAt: new Date(now).toISOString(),
    mode: 'imagekit-forensic-read-only-v1',
    destructiveRequestsIssued: 0,
    mutationMethodsUsed: [],
    completeness: { complete, fileCount: files.length, foldersVisited: audit.folderCount, versionFilesChecked: versionRows.length, versionFailures: versionFailures.length, versionIntegrity, ...audit },
    accountUsage: usage,
    inventory: {
      currentFileBytes: currentBytes, historicalVersionBytes: historicalBytes,
      reconciledListedBytes: reconciledBytes,
      accountMediaLibraryStorageBytes: usage.metrics?.mediaLibraryStorageBytes ?? null,
      accountMinusListedBytes: usage.metrics?.mediaLibraryStorageBytes == null ? null : Number(usage.metrics.mediaLibraryStorageBytes) - reconciledBytes,
      fileCount: files.length, versionFilesChecked: versionRows.length,
      allFiles: files.map(f => ({ fileId: f.fileId, path: f.filePath || null, name: f.name || null, sizeBytes: bytes(f.size), fileType: f.fileType || null, mime: f.mime || null, createdAt: f.createdAt || null, updatedAt: f.updatedAt || null, category: categoryFor(f.filePath) })),
      allFileVersionInventory: versionRows,
      versionFailures, versionIntegrity, categoryCurrentAndHistory: categoryStats, historyByCategory,
      folderCurrent: folderStats, historyByFolder,
      largestCurrentFiles: [...files].sort((a,b)=>bytes(b.size)-bytes(a.size)).slice(0,200).map(f=>({fileId:f.fileId,path:f.filePath,name:f.name,bytes:bytes(f.size),category:categoryFor(f.filePath),createdAt:f.createdAt,updatedAt:f.updatedAt})),
      largestHistoricalFiles: [...versionRows].sort((a,b)=>b.historyBytes-a.historyBytes).slice(0,300),
      oldestHistoricalVersions: versionRows.flatMap(r=>r.versions.filter(v=>!v.isCurrent)).sort((a,b)=>(b.ageDays||0)-(a.ageDays||0)).slice(0,500).map(v=>v)
    },
    retentionAnalysis: {
      policyNote: 'Age alone does not prove irrelevance. This is a review estimate, not a deletion instruction.',
      historicalPosterVersionsBeyondNewestOneCount: posterExcessCount,
      historicalPosterVersionsBeyondNewestOneBytes: posterExcessBytes,
      allHistoricalVersionsOlderThan30DaysCount: Object.values(historyByCategory).reduce((s,v)=>s+v.olderThan30DaysCount,0),
      allHistoricalVersionsOlderThan30DaysBytes: Object.values(historyByCategory).reduce((s,v)=>s+v.olderThan30DaysBytes,0),
      allHistoricalVersionsOlderThan90DaysCount: Object.values(historyByCategory).reduce((s,v)=>s+v.olderThan90DaysCount,0),
      allHistoricalVersionsOlderThan90DaysBytes: Object.values(historyByCategory).reduce((s,v)=>s+v.olderThan90DaysBytes,0),
      unknownDateHistoricalVersions: Object.values(historyByCategory).reduce((s,v)=>s+v.unknownDateCount,0),
      nonPosterCategoriesRequireManualClassification: true
    },
    safety: { noDeleteRequests: true, noUploads: true, noMoves: true, noUpdates: true, noAssetsChanged: true }
  };
  const outputPath = resolve(process.env.IMAGEKIT_FORENSIC_REPORT_PATH || '../reports/imagekit-storage-forensic-audit-live.json');
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log('[imagekit-forensic-audit-complete]', JSON.stringify({
    outputPath, complete, files: files.length, folders: audit.folderCount,
    versionFilesChecked: versionRows.length, versionFailures: versionFailures.length,
    currentBytes, historicalBytes, accountBytes: usage.metrics?.mediaLibraryStorageBytes ?? null,
    accountMinusListedBytes: report.inventory.accountMinusListedBytes,
    posterExcessBytes, destructiveRequestsIssued: 0
  }));
  if (!complete) process.exitCode = 2;
}
await main();
