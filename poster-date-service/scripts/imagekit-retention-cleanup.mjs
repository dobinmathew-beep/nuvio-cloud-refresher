import { Buffer } from 'node:buffer';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  imageKitConfig, listImageKitFiles, deleteImageKitFile
} from '../lib/imagekit-storage.mjs';
import { isValidPosterPointer } from '../lib/poster-versioning.mjs';
import { posterIdentityFromName } from '../lib/imagekit-storage-audit.mjs';
import {
  planCurrentPlusOneHistorical,
  planTitlePosterAssetRetention,
  planCanonicalAndOneBackup,
  isCatalogStateJsonPath
} from '../lib/imagekit-retention-cleanup-utils.mjs';

const API = 'https://api.imagekit.io/v1';
const CONFIRMATION = 'KEEP_CURRENT_PLUS_ONE_HISTORIC';
const CONCURRENCY = 4;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const bytes = value => Math.max(0, Number(value) || 0);
const auth = config => ({
  Authorization: 'Basic ' + Buffer.from(config.privateKey + ':').toString('base64'),
  Accept: 'application/json'
});

async function request(url, options = {}, timeout = 20000) {
  let last;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: { ...auth(config), ...(options.headers || {}) },
        signal: AbortSignal.timeout(timeout)
      });
      if (response.status === 429 || response.status >= 500) {
        last = new Error('HTTP ' + response.status + ': ' + (await response.text()).slice(0, 240));
        if (attempt < 5) {
          const reset = Number(response.headers.get('x-ratelimit-reset') || response.headers.get('retry-after')) * 1000;
          await pause(Math.min(30000, Math.max(1000, reset || 1500 * (attempt + 1))));
          continue;
        }
      }
      if (!response.ok) throw new Error('HTTP ' + response.status + ': ' + (await response.text()).slice(0, 300));
      return response;
    } catch (error) {
      last = error;
      if (attempt < 5 && /fetch failed|timeout|network|HTTP 429|HTTP 5\d\d/i.test(error.message)) {
        await pause(Math.min(30000, 1000 * (attempt + 1)));
        continue;
      }
      throw error;
    }
  }
  throw last || new Error('ImageKit request failed');
}
async function getJson(url) {
  return (await request(url)).json();
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
async function readUsage() {
  // ImageKit's usage endpoint can return an empty/zero daily bucket for
  // the current UTC date. Query a window spanning yesterday through tomorrow,
  // matching the broader window used by the read-only storage audit.
  const now = Date.now();
  const startDate = new Date(now - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const endDate = new Date(now + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const url = new URL(API + '/accounts/usage');
  url.searchParams.set('startDate', startDate);
  url.searchParams.set('endDate', endDate);
  const payload = await getJson(url);
  const usage = Array.isArray(payload) ? payload[0] : (payload?.data?.[0] || payload);
  const value = Number(usage?.mediaLibraryStorageBytes);
  return Number.isFinite(value) && value >= 0 ? value : null;
}
async function versionsFor(file) {
  const rows = await getJson(API + '/files/' + encodeURIComponent(file.fileId) + '/versions');
  if (!Array.isArray(rows)) throw new Error('Unexpected version list for ' + file.filePath);
  return rows;
}
async function readVersion(file, versionId, expectedKind) {
  const detail = await getJson(API + '/files/' + encodeURIComponent(file.fileId) +
    '/versions/' + encodeURIComponent(versionId));
  if (detail?.versionInfo?.id && detail.versionInfo.id !== versionId) {
    throw new Error('Version detail ID mismatch for ' + file.filePath);
  }
  const url = typeof detail.url === 'string' && detail.url.startsWith('https://') ? detail.url : null;
  if (!url) throw new Error('Version detail did not provide a verifiable HTTPS URL');
  // Historical version URLs can also carry delivery transformations.
  // Force the original stored rendition before comparing Admin API byte size.
  const originalVersionUrl = new URL(url);
  originalVersionUrl.searchParams.set('tr', 'orig-true');
  originalVersionUrl.searchParams.set('cleanup-readback', String(Date.now()));
  const response = await request(originalVersionUrl.toString(), {}, 20000);
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  const body = Buffer.from(await response.arrayBuffer());
  const expectedSize = Number(detail.size);
  if (!Number.isFinite(expectedSize) || body.length !== expectedSize) {
    throw new Error('Version readback size mismatch for ' + versionId);
  }
  if (expectedKind === 'json') {
    if (!contentType.includes('json')) throw new Error('Historical state version is not JSON');
    JSON.parse(body.toString('utf8'));
  } else if (!contentType.startsWith('image/')) {
    throw new Error('Historical poster version is not an image');
  }
  return { bytes: body.length, contentType };
}
async function readCurrent(file, expectedKind) {
  // The file-list "url" may be a transformed delivery URL. Cleanup must
  // verify the stored original bytes against the Admin API's file.size, so
  // always bypass delivery transformations and cache variants explicitly.
  const originalUrl = new URL(config.endpoint + file.filePath);
  originalUrl.searchParams.set('tr', 'orig-true');
  originalUrl.searchParams.set('cleanup-readback', String(Date.now()));
  const response = await request(originalUrl.toString(), {}, 20000);
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  const body = Buffer.from(await response.arrayBuffer());
  if (file.size !== undefined && body.length !== bytes(file.size)) {
    throw new Error('Current asset readback size mismatch for ' + file.filePath);
  }
  if (expectedKind === 'json') {
    if (!contentType.includes('json')) throw new Error('Current state asset is not JSON');
    JSON.parse(body.toString('utf8'));
  } else if (!contentType.startsWith('image/')) {
    throw new Error('Current poster asset is not an image');
  }
  return { bytes: body.length, contentType };
}
async function deleteVersion(fileId, versionId) {
  await request(API + '/files/' + encodeURIComponent(fileId) + '/versions/' + encodeURIComponent(versionId), {
    method: 'DELETE'
  });
}
async function deleteFile(fileId) {
  await deleteImageKitFile(fileId);
}
function dateOf(file) {
  return Date.parse(file.createdAt || file.updatedAt || '');
}

const config = imageKitConfig();
if (!config) throw new Error('ImageKit credentials are not configured');
if (process.env.IMAGEKIT_CLEANUP_CONFIRMATION !== CONFIRMATION) {
  throw new Error('Destructive cleanup is locked: explicit confirmation token is missing');
}
if (process.env.GITHUB_REF_NAME !== 'imagekit-retention-cleanup') {
  throw new Error('Cleanup is restricted to the dedicated imagekit-retention-cleanup branch');
}

const report = {
  generatedAt: new Date().toISOString(),
  mode: 'verified-current-plus-one-historical-cleanup',
  policy: 'retain-current-plus-one-newest-valid-historical',
  deletionEnabled: true,
  accountUsageBeforeBytes: null,
  accountUsageAfterBytes: null,
  inventoryFiles: 0,
  posterFileVersionsDeleted: [],
  posterFilesDeleted: [],
  immutablePosterFilesDeleted: [],
  stateVersionsDeleted: [],
  skipped: [],
  failures: [],
  deletedBytesEstimate: 0,
  stoppedOnFirstDeleteError: false
};

const outputPath = resolve(process.env.IMAGEKIT_CLEANUP_REPORT_PATH || '../reports/imagekit-retention-cleanup-report.json');
await mkdir(dirname(outputPath), { recursive: true });

try {
  report.accountUsageBeforeBytes = await readUsage().catch(() => null);
  const files = await listImageKitFiles();
  report.inventoryFiles = files.length;
  const byPath = new Map(files.map(file => [file.filePath, file]));
  const deletes = [];
  const deleteKeys = new Set();
  const addDelete = item => {
    const key = item.kind === 'version' ? 'v:' + item.fileId + ':' + item.versionId : 'f:' + item.fileId;
    if (deleteKeys.has(key)) return;
    deleteKeys.add(key);
    deletes.push(item);
  };

  // A. Retain the current and one newest, verified historical version of each
  // canonical poster file. A kept backup poster file is retained as a single
  // current asset, so it does not carry a second layer of old versions.
  const posterFiles = files.filter(file => String(file.filePath || '').startsWith('/posters/'));
  const posterGroups = new Map();
  for (const file of posterFiles) {
    const identity = posterIdentityFromName(file.name);
    if (!identity || !file.fileId) continue;
    if (!posterGroups.has(identity)) posterGroups.set(identity, []);
    posterGroups.get(identity).push(file);
  }
  const duplicatePosterFileIds = new Set();
  const retainedBackupFileIds = new Set();
  for (const [identity, group] of posterGroups) {
    if (group.length < 2) continue;
    const plan = planCanonicalAndOneBackup(group, identity);
    if (!plan.safe) {
      report.skipped.push({ scope: 'poster-title-files', identity, reason: plan.reason });
      continue;
    }
    try {
      await readCurrent(plan.keep[0], 'image');
      if (plan.keep[1]) await readCurrent(plan.keep[1], 'image');
      for (const file of plan.remove) {
        addDelete({ kind: 'file', fileId: file.fileId, path: file.filePath, bytes: bytes(file.size), identity, reason: 'older-extra-poster-file-same-stable-identity' });
        duplicatePosterFileIds.add(file.fileId);
      }
      if (plan.keep[1]) retainedBackupFileIds.add(plan.keep[1].fileId);
    } catch (error) {
      report.skipped.push({ scope: 'poster-title-files', identity, reason: 'canonical-or-backup-readback-failed', detail: error.message });
    }
  }

  const posterVersionTargets = posterFiles.filter(file =>
    file.fileId && file.versionInfo?.id && !duplicatePosterFileIds.has(file.fileId) &&
    !retainedBackupFileIds.has(file.fileId)
  );
  let versionListsProcessed = 0;
  await mapLimit(posterVersionTargets, CONCURRENCY, async file => {
    try {
      const rows = await versionsFor(file);
      const plan = planCurrentPlusOneHistorical(rows, file.versionInfo.id);
      if (!plan.safe) {
        report.skipped.push({ scope: 'poster-file-versions', path: file.filePath, reason: plan.reason });
        return;
      }
      if (plan.remove.length === 0) return;
      await readCurrent(file, 'image');
      if (plan.keep[1]) await readVersion(file, plan.keep[1].versionInfo.id, 'image');
      for (const old of plan.remove) {
        addDelete({
          kind: 'version', fileId: file.fileId, versionId: old.versionInfo.id,
          path: file.filePath, bytes: bytes(old.size), reason: 'older-than-newest-historical-poster-version'
        });
      }
    } catch (error) {
      report.skipped.push({ scope: 'poster-file-versions', path: file.filePath, reason: 'version-list-or-readback-failed', detail: error.message });
    } finally { versionListsProcessed++; }
  });

  // B. Versioned immutable posters: protect every valid active pointer and
  // retain one newest verified historical poster per IMDb identity.
  const versionedFiles = files.filter(file => /^\/poster-versions\/(tt\d{7,10})\/[a-f0-9]{64}\.jpg$/i.test(String(file.filePath || '')));
  const pointerFiles = new Map();
  for (const file of files) {
    const match = String(file.filePath || '').match(/^\/catalog-state\/poster-pointers\/(tt\d{7,10})\.json$/i);
    if (match) pointerFiles.set(match[1].toLowerCase(), file);
  }
  const immutableById = new Map();
  for (const file of versionedFiles) {
    const match = file.filePath.match(/^\/poster-versions\/(tt\d{7,10})\//i);
    const id = match?.[1]?.toLowerCase();
    if (!id || !file.fileId) continue;
    if (!immutableById.has(id)) immutableById.set(id, []);
    immutableById.get(id).push(file);
  }
  for (const [id, group] of immutableById) {
    const pointerFile = pointerFiles.get(id);
    if (!pointerFile) {
      report.skipped.push({ scope: 'immutable-poster-title', identity: id, reason: 'pointer-file-missing-all-assets-protected' });
      continue;
    }
    try {
      const pointerResponse = await request(config.endpoint + pointerFile.filePath + '?cleanup=' + Date.now(), {}, 10000);
      const pointer = await pointerResponse.json();
      if (!isValidPosterPointer(pointer, id)) throw new Error('Pointer schema or checksum is invalid');
      const active = group.filter(file => file.filePath === pointer.assetPath);
      if (active.length !== 1 || (pointer.fileId && pointer.fileId !== active[0].fileId)) {
        throw new Error('Active pointer target is missing or mismatched');
      }
      await readCurrent(active[0], 'image');
      const plan = planTitlePosterAssetRetention(group, pointer.assetPath);
      if (!plan.safe) throw new Error(plan.reason);
      if (plan.keep[1]) await readCurrent(plan.keep[1], 'image');
      for (const file of plan.remove) {
        addDelete({
          kind: 'file', fileId: file.fileId, path: file.filePath, bytes: bytes(file.size),
          identity: id, reason: 'older-than-one-verified-historical-immutable-poster'
        });
      }
    } catch (error) {
      report.skipped.push({ scope: 'immutable-poster-title', identity: id, reason: 'pointer-or-readback-unverified-all-assets-protected', detail: error.message });
    }
  }

  // C. Catalogue state: retain each current JSON object plus its newest
  // verified historical JSON version. The audit found the bulk of version
  // churn in poster-processing shards, catalogue snapshots, and checkpoints.
  // Poster image paths are deliberately excluded by this path predicate.
  const stateFiles = files.filter(file => isCatalogStateJsonPath(file.filePath));
  for (const file of stateFiles) {
    const path = file.filePath;
    if (!file?.fileId || !file.versionInfo?.id) {
      report.skipped.push({ scope: 'durable-state', path, reason: 'current-file-or-version-identity-missing' });
      continue;
    }
    try {
      const rows = await versionsFor(file);
      const plan = planCurrentPlusOneHistorical(rows, file.versionInfo.id);
      if (!plan.safe) throw new Error(plan.reason);
      if (!plan.remove.length) continue;
      await readCurrent(file, 'json');
      if (plan.keep[1]) await readVersion(file, plan.keep[1].versionInfo.id, 'json');
      for (const old of plan.remove) {
        addDelete({
          kind: 'version', fileId: file.fileId, versionId: old.versionInfo.id,
          path, bytes: bytes(old.size), reason: 'older-than-one-verified-durable-state-backup'
        });
      }
    } catch (error) {
      report.skipped.push({ scope: 'durable-state', path, reason: 'current-or-backup-readback-failed-all-versions-protected', detail: error.message });
    }
  }

  report.plannedDeletionCount = deletes.length;
  report.plannedDeletionBytes = deletes.reduce((sum, item) => sum + bytes(item.bytes), 0);
  console.log('[imagekit-cleanup-plan]', JSON.stringify({
    inventoryFiles: report.inventoryFiles,
    plannedDeletionCount: report.plannedDeletionCount,
    plannedDeletionBytes: report.plannedDeletionBytes,
    posterFileVersions: deletes.filter(x => x.kind === 'version' && x.path.startsWith('/posters/')).length,
    immutablePosterFiles: deletes.filter(x => x.kind === 'file' && x.path.startsWith('/poster-versions/')).length,
    duplicatePosterFiles: deletes.filter(x => x.kind === 'file' && x.path.startsWith('/posters/')).length,
    durableStateVersions: deletes.filter(x => x.kind === 'version' && isCatalogStateJsonPath(x.path)).length,
    skippedGroups: report.skipped.length
  }));

  // Stop-on-first-error, low write rate. Every target was derived from this
  // run's fresh inventory and verified keep-set; no old artifact IDs are used.
  for (let i = 0; i < deletes.length; i++) {
    const item = deletes[i];
    try {
      if (item.kind === 'version') await deleteVersion(item.fileId, item.versionId);
      else await deleteFile(item.fileId);
      report.deletedBytesEstimate += bytes(item.bytes);
      if (item.kind === 'version' && isCatalogStateJsonPath(item.path)) report.stateVersionsDeleted.push(item);
      else if (item.kind === 'version') report.posterFileVersionsDeleted.push(item);
      else if (item.path.startsWith('/poster-versions/')) report.immutablePosterFilesDeleted.push(item);
      else report.posterFilesDeleted.push(item);
      if ((i + 1) % 25 === 0 || i === deletes.length - 1) {
        console.log('[imagekit-cleanup-progress]', JSON.stringify({ deleted: i + 1, total: deletes.length, estimatedBytes: report.deletedBytesEstimate }));
      }
      await pause(250);
    } catch (error) {
      report.failures.push({ item, error: error.message });
      report.stoppedOnFirstDeleteError = true;
      break;
    }
  }
} catch (error) {
  report.failures.push({ scope: 'cleanup-run', error: error.message });
} finally {
  report.completedAt = new Date().toISOString();
  report.accountUsageAfterBytes = await readUsage().catch(() => null);
  report.accountUsageDeltaBytes = report.accountUsageBeforeBytes !== null && report.accountUsageAfterBytes !== null
    ? report.accountUsageBeforeBytes - report.accountUsageAfterBytes : null;
  await writeFile(outputPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log('[imagekit-cleanup-complete]', JSON.stringify({
    outputPath,
    plannedDeletionCount: report.plannedDeletionCount || 0,
    posterFileVersionsDeleted: report.posterFileVersionsDeleted.length,
    posterFilesDeleted: report.posterFilesDeleted.length,
    immutablePosterFilesDeleted: report.immutablePosterFilesDeleted.length,
    stateVersionsDeleted: report.stateVersionsDeleted.length,
    deletedBytesEstimate: report.deletedBytesEstimate,
    accountUsageBeforeBytes: report.accountUsageBeforeBytes,
    accountUsageAfterBytes: report.accountUsageAfterBytes,
    accountUsageDeltaBytes: report.accountUsageDeltaBytes,
    skippedGroups: report.skipped.length,
    failures: report.failures.length,
    stoppedOnFirstDeleteError: report.stoppedOnFirstDeleteError
  }));
}
// A skipped group means the requested retention policy was not fully
// verified. Keep the report artifact, but make the workflow visibly fail so
// a green Actions run can never imply that cleanup succeeded when it did not.
if (report.failures.length || report.skipped.length > 0) process.exitCode = 1;
