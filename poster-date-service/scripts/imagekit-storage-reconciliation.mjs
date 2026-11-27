import { Buffer } from 'node:buffer';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { imageKitConfig, listImageKitFiles } from '../lib/imagekit-storage.mjs';
import { reconcileVersionRecords, compareByteMeasurements } from '../lib/imagekit-storage-reconciliation-utils.mjs';
import { categoryFor } from '../lib/imagekit-expanded-audit-utils.mjs';

const API = 'https://api.imagekit.io/v1';
const CONCURRENCY = Math.max(1, Math.min(4, Number(process.env.IMAGEKIT_RECONCILIATION_CONCURRENCY) || 2));
const DETAIL_READBACK_LIMIT = Math.max(0, Math.min(250, Number(process.env.IMAGEKIT_RECONCILIATION_DETAIL_LIMIT) || 100));
const RETENTION_MS = 30 * 86400000;
const now = Date.now();
const bytes = value => Math.max(0, Number(value) || 0);

function headers(config) {
  return { Authorization: 'Basic ' + Buffer.from(config.privateKey + ':').toString('base64'), Accept: 'application/json' };
}
async function getJson(config, url) {
  let lastError;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const response = await fetch(url, { method: 'GET', headers: headers(config), signal: AbortSignal.timeout(20000) });
      if (response.status === 429 || response.status >= 500) {
        lastError = new Error('HTTP ' + response.status + ': ' + (await response.text()).slice(0, 240));
        if (attempt < 4) {
          const retryAfter = Number(response.headers.get('retry-after')) * 1000;
          await new Promise(r => setTimeout(r, Math.min(30000, Math.max(1000, retryAfter || 1500 * (attempt + 1)))));
          continue;
        }
      }
      if (!response.ok) throw new Error('HTTP ' + response.status + ': ' + (await response.text()).slice(0, 240));
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < 4 && /fetch failed|timeout|network|HTTP 429|HTTP 5\d\d/i.test(error.message)) {
        await new Promise(r => setTimeout(r, Math.min(30000, 1000 * (attempt + 1))));
        continue;
      }
      throw error;
    }
  }
  throw lastError || new Error('ImageKit GET failed');
}
async function mapLimit(items, limit, fn) {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      await fn(items[index], index);
    }
  }));
}
async function readAccountUsage(config) {
  const startDate = new Date(now - 86400000).toISOString().slice(0, 10);
  const endDate = new Date(now + 86400000).toISOString().slice(0, 10);
  const url = new URL(API + '/accounts/usage');
  url.searchParams.set('startDate', startDate);
  url.searchParams.set('endDate', endDate);
  const payload = await getJson(config, url);
  const usage = Array.isArray(payload) ? payload[0] : (payload?.data?.[0] || payload);
  const value = Number(usage?.mediaLibraryStorageBytes);
  if (!Number.isFinite(value) || value < 0) throw new Error('mediaLibraryStorageBytes missing from account usage response');
  return { bytes: value, startDate, endDate, responseKeys: Object.keys(usage || {}) };
}
async function readVersions(config, file) {
  const url = API + '/files/' + encodeURIComponent(file.fileId) + '/versions';
  const result = await getJson(config, url);
  if (!Array.isArray(result)) throw new Error('Unexpected versions response; expected an array');
  return {
    file,
    currentVersionId: file.versionInfo?.id || null,
    ...reconcileVersionRecords(result, file.versionInfo?.id || null, now, RETENTION_MS)
  };
}
async function readVersionDetail(config, fileId, versionId) {
  return getJson(config, API + '/files/' + encodeURIComponent(fileId) + '/versions/' + encodeURIComponent(versionId));
}

const config = imageKitConfig();
if (!config) throw new Error('ImageKit credentials are not configured');
console.log('[imagekit-reconciliation] starting independent read-only scan');
const files = await listImageKitFiles();
const uniqueFiles = [...new Map(files.filter(f => f.fileId).map(f => [f.fileId, f])).values()];
const currentFileBytes = uniqueFiles.reduce((sum, f) => sum + bytes(f.size), 0);
const account = await readAccountUsage(config).catch(error => ({ bytes: null, error: error.message }));
const perFile = [];
const failures = [];
let processed = 0;
await mapLimit(uniqueFiles, CONCURRENCY, async file => {
  try { perFile.push(await readVersions(config, file)); }
  catch (error) { failures.push({ fileId: file.fileId, path: file.filePath || null, category: categoryFor(file.filePath), error: String(error.message || error).slice(0, 400) }); }
  finally {
    processed++;
    if (processed % 250 === 0) console.log('[imagekit-reconciliation-progress]', JSON.stringify({ processed, total: uniqueFiles.length, failures: failures.length }));
  }
});

const flat = perFile.flatMap(item => item.records.map(version => ({
  fileId: item.file.fileId, path: item.file.filePath || null, category: categoryFor(item.file.filePath),
  currentFileBytes: bytes(item.file.size), currentVersionId: item.currentVersionId, ...version
})));
const currentVersionMismatches = [];
for (const item of perFile) {
  const current = item.records.find(v => v.isCurrent);
  if (!current) {
    currentVersionMismatches.push({ fileId: item.file.fileId, path: item.file.filePath || null, issue: 'current-version-not-found-in-version-list', listedCurrentVersionId: item.currentVersionId, currentFileBytes: bytes(item.file.size) });
  } else if (current.bytes !== null && current.bytes !== bytes(item.file.size)) {
    currentVersionMismatches.push({ fileId: item.file.fileId, path: item.file.filePath || null, issue: 'current-version-size-differs-from-file-list', versionBytes: current.bytes, currentFileBytes: bytes(item.file.size), differenceBytes: current.bytes - bytes(item.file.size) });
  }
}
const versionBytesComplete = failures.length === 0 && flat.every(v => v.bytes !== null) && currentVersionMismatches.length === 0 && perFile.every(v => !v.missingCurrentVersionMatch && v.duplicateVersionIds.length === 0 && v.missingVersionIdCount === 0);
const versionInventoryBytes = versionBytesComplete ? flat.reduce((sum, v) => sum + v.bytes, 0) : null;
const versionInventoryBytesPartial = flat.reduce((sum, v) => sum + (v.bytes ?? 0), 0);
const categoryStats = {};
for (const item of perFile) {
  const category = categoryFor(item.file.filePath);
  const stat = categoryStats[category] ||= { filesChecked: 0, versions: 0, historicalVersions: 0, historicalBytesPartial: 0, olderThan30Days: 0, olderThan30DaysBytes: 0, unknownDates: 0, futureDates: 0, currentVersionMissing: 0 };
  stat.filesChecked++;
  stat.versions += item.uniqueVersionCount;
  stat.historicalVersions += item.historicalVersionCount;
  stat.historicalBytesPartial += item.historicalVersionBytes;
  stat.olderThan30Days += item.versionsOlderThanRetentionCount;
  stat.olderThan30DaysBytes += item.bytesOlderThanRetention;
  stat.unknownDates += item.unknownTimestampCount;
  stat.futureDates += item.futureTimestampCount;
  if (item.missingCurrentVersionMatch) stat.currentVersionMissing++;
}
const detailTargets = [...flat].filter(v => !v.isCurrent && v.bytes !== null)
  .sort((a,b) => b.bytes - a.bytes).slice(0, DETAIL_READBACK_LIMIT);
const detailReadbacks = [];
const detailFailures = [];
await mapLimit(detailTargets, Math.min(2, CONCURRENCY), async target => {
  try {
    const detail = await readVersionDetail(config, target.fileId, target.versionId);
    const detailSize = Number(detail?.size);
    const detailDate = detail?.createdAt || detail?.updatedAt || null;
    detailReadbacks.push({
      fileId: target.fileId, versionId: target.versionId, path: target.path,
      listSizeBytes: target.bytes, detailSizeBytes: Number.isFinite(detailSize) ? detailSize : null,
      sizeMatches: Number.isFinite(detailSize) && detailSize === target.bytes,
      listCreatedAt: target.createdAt, detailCreatedAt: detailDate,
      dateMatches: Boolean(target.createdAt && detailDate && Date.parse(target.createdAt) === Date.parse(detailDate))
    });
  } catch (error) {
    detailFailures.push({ fileId: target.fileId, versionId: target.versionId, error: String(error.message || error).slice(0, 400) });
  }
});
const detailSizeMismatches = detailReadbacks.filter(v => !v.sizeMatches);
const historical = flat.filter(v => !v.isCurrent);
const historicalDateStats = {
  total: historical.length,
  olderThan30Days: historical.filter(v => v.ageClass === 'older-than-retention').length,
  within30Days: historical.filter(v => v.ageClass === 'within-retention').length,
  unknown: historical.filter(v => v.ageClass === 'unknown').length,
  future: historical.filter(v => v.ageClass === 'future').length,
  oldestKnownTimestamp: historical.filter(v => v.timestamp !== null).reduce((min,v) => min === null || v.timestamp < min ? v.timestamp : min, null),
  newestKnownTimestamp: historical.filter(v => v.timestamp !== null).reduce((max,v) => max === null || v.timestamp > max ? v.timestamp : max, null)
};
const report = {
  generatedAt: new Date(now).toISOString(),
  mode: 'read-only-storage-reconciliation',
  deletionEnabled: false,
  destructiveRequestsIssued: 0,
  mutationMethodsUsed: [],
  accountUsage: account.bytes === null ? { bytes: null, error: account.error } : account,
  inventory: { listedFiles: files.length, uniqueFiles: uniqueFiles.length, currentFileBytes, versionFilesChecked: perFile.length, versionListFailures: failures.length },
  versionInventory: {
    complete: versionBytesComplete, uniqueVersionRecords: flat.length,
    historicalVersionCount: historical.length,
    allVersionBytes: versionInventoryBytes,
    allVersionBytesPartial: versionInventoryBytesPartial,
    currentVersionMissingCount: currentVersionMismatches.filter(v => v.issue === 'current-version-not-found-in-version-list').length,
    currentVersionSizeMismatchCount: currentVersionMismatches.filter(v => v.issue === 'current-version-size-differs-from-file-list').length,
    duplicateVersionIdCount: perFile.reduce((s,v) => s + v.duplicateVersionIds.length, 0),
    missingVersionIdCount: perFile.reduce((s,v) => s + v.missingVersionIdCount, 0),
    invalidSizeCount: perFile.reduce((s,v) => s + v.invalidSizeVersionIds.length, 0),
    dateStats: historicalDateStats,
    retentionDays: 30,
    categoryStats,
    historicalVersionRecords: historical.map(v => ({ fileId: v.fileId, path: v.path, category: v.category, versionId: v.versionId, bytes: v.bytes, timestamp: v.timestamp, timestampSource: v.timestampSource, timestampRaw: v.timestampRaw, ageClass: v.ageClass, createdAt: v.createdAt, updatedAt: v.updatedAt }))
  },
  comparison: compareByteMeasurements({
    accountUsageBytes: account.bytes, currentFileBytes,
    versionInventoryBytes, versionInventoryComplete: versionBytesComplete
  }),
  detailReadback: {
    requested: detailTargets.length, succeeded: detailReadbacks.length, failed: detailFailures.length,
    sizeMismatchCount: detailSizeMismatches.length,
    dateMatchCount: detailReadbacks.filter(v => v.dateMatches).length,
    sizeMismatches: detailSizeMismatches, results: detailReadbacks, failures: detailFailures
  },
  currentVersionMismatches,
  versionListFailures: failures,
  scopeProtection: {
    allCategoriesInventoryOnly: true,
    protectedCategories: ['posters','poster-versions','catalog-state','backdrops','hero-reels','epg','other'],
    deletionCandidatesGenerated: 0,
    note: 'This reconciliation is strictly read-only. No files, versions, pointers, or metadata are changed.'
  },
  interpretation: {
    accountUsageAndVersionInventoryAreNotAssumedComparable: true,
    note: 'The all-version total is marked complete only when every listed file has a successful version scan, unique version IDs, valid sizes, and a matching current-version ID. Even then, account usage may use a different billing/measurement scope; the delta is diagnostic, not reclaimable storage.'
  }
};
const outputPath = resolve(process.env.IMAGEKIT_RECONCILIATION_REPORT_PATH || '../reports/imagekit-storage-reconciliation-live.json');
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log('[imagekit-reconciliation-complete]', JSON.stringify({
  outputPath, files: uniqueFiles.length, versionFilesChecked: perFile.length,
  versionListFailures: failures.length, versionInventoryComplete: versionBytesComplete,
  allVersionBytes: versionInventoryBytes, historicalVersions: historical.length,
  olderThan30Days: historicalDateStats.olderThan30Days, unknownDates: historicalDateStats.unknown,
  detailReadbacks: detailReadbacks.length, detailFailures: detailFailures.length,
  destructiveRequestsIssued: 0
}));
