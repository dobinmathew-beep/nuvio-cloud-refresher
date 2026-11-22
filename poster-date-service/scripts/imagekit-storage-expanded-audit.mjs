import { Buffer } from 'node:buffer';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { buildImageKitDeletionReport, imageKitConfig, listImageKitFiles } from '../lib/imagekit-storage.mjs';
import { categoryFor, summarizeVersions } from '../lib/imagekit-expanded-audit-utils.mjs';

const API = 'https://api.imagekit.io/v1';
const CONCURRENCY = Math.max(1, Math.min(8, Number(process.env.IMAGEKIT_AUDIT_VERSION_CONCURRENCY) || 4));
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const now = Date.now();

function bytes(value) { return Math.max(0, Number(value) || 0); }
function dateOf(value) {
  const n = Date.parse(value || '');
  return Number.isFinite(n) ? n : null;
}
function authHeaders(config) {
  return { Authorization: 'Basic ' + Buffer.from(config.privateKey + ':').toString('base64'), Accept: 'application/json' };
}
async function requestJson(config, url) {
  let lastError;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const response = await fetch(url, { headers: authHeaders(config), signal: AbortSignal.timeout(20000) });
      if (response.status === 429 || response.status >= 500) {
        const wait = Math.min(30000, Math.max(1000, Number(response.headers.get('retry-after')) * 1000 || 1500 * (attempt + 1)));
        lastError = new Error('HTTP ' + response.status + ': ' + (await response.text()).slice(0, 240));
        if (attempt < 4) { await new Promise(r => setTimeout(r, wait)); continue; }
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
  throw lastError || new Error('ImageKit request failed');
}
async function mapLimit(items, limit, fn) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      await fn(items[index], index);
    }
  });
  await Promise.all(workers);
}
async function readAccountUsage(config) {
  const startDate = new Date(now - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const endDate = new Date(now + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const url = new URL(API + '/accounts/usage');
  url.searchParams.set('startDate', startDate);
  url.searchParams.set('endDate', endDate);
  const payload = await requestJson(config, url);
  const usage = Array.isArray(payload) ? payload[0] : (payload?.data?.[0] || payload);
  const value = Number(usage?.mediaLibraryStorageBytes);
  if (!Number.isFinite(value) || value < 0) throw new Error('mediaLibraryStorageBytes missing from account usage response');
  return value;
}
async function readVersions(config, file) {
  const url = API + '/files/' + encodeURIComponent(file.fileId) + '/versions';
  const result = await requestJson(config, url);
  if (!Array.isArray(result)) throw new Error('Unexpected versions response (expected array)');
  const currentId = file.versionInfo?.id || null;
  return {
    fileId: file.fileId,
    path: file.filePath || null,
    category: categoryFor(file.filePath),
    currentVersionId: currentId,
    versionsReturned: result.length,
    ...summarizeVersions(result, currentId, now, RETENTION_MS)
  };
}

const config = imageKitConfig();
if (!config) throw new Error('ImageKit credentials are not configured');
console.log('[expanded-imagekit-audit] starting full inventory');
const files = await listImageKitFiles();
const currentFileBytes = files.reduce((sum, f) => sum + bytes(f.size), 0);
const folderStats = new Map();
const largestFiles = [...files].sort((a, b) => bytes(b.size) - bytes(a.size)).slice(0, 100);
const fileById = new Map();
for (const file of files) {
  const category = categoryFor(file.filePath);
  const entry = folderStats.get(category) || { fileCount: 0, currentBytes: 0 };
  entry.fileCount++;
  entry.currentBytes += bytes(file.size);
  folderStats.set(category, entry);
  if (file.fileId) fileById.set(file.fileId, file);
}

let accountUsageBytes = null;
let accountUsageError = null;
try { accountUsageBytes = await readAccountUsage(config); }
catch (error) { accountUsageError = error.message; }

const versionResults = [];
const versionFailures = [];
let processed = 0;
await mapLimit([...fileById.values()], CONCURRENCY, async file => {
  try {
    versionResults.push(await readVersions(config, file));
  } catch (error) {
    versionFailures.push({
      fileId: file.fileId,
      path: file.filePath || null,
      category: categoryFor(file.filePath),
      error: String(error.message || error).slice(0, 400)
    });
  } finally {
    processed++;
    if (processed % 250 === 0) console.log('[expanded-imagekit-audit-progress]', JSON.stringify({ processed, total: fileById.size, failures: versionFailures.length }));
  }
});

const versionsByCategory = {};
for (const item of versionResults) {
  const entry = versionsByCategory[item.category] || {
    filesChecked: 0, historicalVersionCount: 0, historicalVersionBytes: 0,
    versionsOlderThan30Days: 0, bytesOlderThan30Days: 0
  };
  entry.filesChecked++;
  entry.historicalVersionCount += item.historicalVersionCount;
  entry.historicalVersionBytes += item.historicalVersionBytes;
  entry.versionsOlderThan30Days += item.historicalVersionsOlderThan30Days.length;
  entry.bytesOlderThan30Days += item.historicalVersionsOlderThan30Days.reduce((s, v) => s + v.bytes, 0);
  versionsByCategory[item.category] = entry;
}
for (const [category, entry] of folderStats) {
  entry.versionChecksSucceeded = versionsByCategory[category]?.filesChecked || 0;
  entry.versionChecksFailed = versionFailures.filter(v => v.category === category).length;
  entry.historicalVersionCount = versionsByCategory[category]?.historicalVersionCount || 0;
  entry.historicalVersionBytes = versionsByCategory[category]?.historicalVersionBytes || 0;
  entry.versionsOlderThan30Days = versionsByCategory[category]?.versionsOlderThan30Days || 0;
  entry.bytesOlderThan30Days = versionsByCategory[category]?.bytesOlderThan30Days || 0;
}
const historicalVersionCount = versionResults.reduce((s, v) => s + v.historicalVersionCount, 0);
const historicalVersionBytes = versionResults.reduce((s, v) => s + v.historicalVersionBytes, 0);
const reconciledInventoryBytes = currentFileBytes + historicalVersionBytes;
const expandedReport = {
  generatedAt: new Date(now).toISOString(),
  mode: 'expanded-read-only-dry-run',
  deletionEnabled: false,
  destructiveRequestsIssued: 0,
  accountUsageBytes,
  accountUsageGiB: accountUsageBytes === null ? null : Number((accountUsageBytes / 1024 ** 3).toFixed(4)),
  accountUsageError,
  accountFileCount: files.length,
  currentFileBytes,
  currentFileGiB: Number((currentFileBytes / 1024 ** 3).toFixed(4)),
  versionFilesChecked: versionResults.length,
  versionChecksFailed: versionFailures.length,
  historicalVersionCount,
  historicalVersionBytes,
  reconciledInventoryBytes,
  reconciliationDeltaBytes: accountUsageBytes === null ? null : accountUsageBytes - reconciledInventoryBytes,
  reconciliationDeltaGiB: accountUsageBytes === null ? null : Number(((accountUsageBytes - reconciledInventoryBytes) / 1024 ** 3).toFixed(4)),
  versionScanConcurrency: CONCURRENCY,
  retentionDays: 30,
  folderStats: Object.fromEntries(folderStats),
  versionsByCategory,
  versionFailures,
  oldestVersionDetails: versionResults.flatMap(v => v.historicalVersionsOlderThan30Days.map(x => ({
    fileId: v.fileId, path: v.path, category: v.category, ...x
  }))),
  largestCurrentFiles: largestFiles.map(f => ({
    fileId: f.fileId, name: f.name, path: f.filePath || null, category: categoryFor(f.filePath),
    bytes: bytes(f.size), currentVersionId: f.versionInfo?.id || null
  })),
  scopeProtection: {
    nonPosterFilesDeleted: 0,
    nonPosterFilesNominatedForDeletion: 0,
    nonPosterFilesInspectedSeparately: true,
    protectedCategories: ['catalog-state', 'backdrops', 'hero-reels', 'epg', 'other'],
    note: 'Non-poster files and their versions are inventory-only. No candidate or deletion action is generated for these categories.'
  }
};

const baseReport = await buildImageKitDeletionReport({ now });
const output = {
  ...baseReport,
  expandedAudit: expandedReport,
  note: 'Expanded read-only audit. No ImageKit files or versions were deleted. All non-poster categories are inventory-only; any deletion requires separate review and approval of exact IDs.'
};
const outputPath = resolve(process.env.IMAGEKIT_AUDIT_REPORT_PATH || '../reports/imagekit-storage-expanded-audit-live.json');
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(output, null, 2) + '\n', 'utf8');
console.log('[expanded-imagekit-audit-complete]', JSON.stringify({
  outputPath, accountFileCount: files.length, accountUsageBytes,
  currentFileBytes, historicalVersionCount, historicalVersionBytes,
  versionChecksFailed: versionFailures.length,
  candidateCount: baseReport.candidateCount, candidateBytes: baseReport.candidateBytes,
  deletionEnabled: false
}));
