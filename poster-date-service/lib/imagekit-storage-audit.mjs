// Read-only ImageKit cleanup analysis. This module never performs network or delete operations.
export const DEFAULT_POSTER_VERSION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export function posterIdentityFromName(name) {
  const match = String(name || '').match(/^(tt\d{7,10}|tmdb-\d{1,12}|tvmaze-\d{1,12})(?:_[^.]+)?\.jpg$/i);
  return match?.[1]?.toLowerCase() || null;
}

function newestFirst(a, b) {
  return Date.parse(b.updatedAt || b.createdAt || 0) - Date.parse(a.updatedAt || a.createdAt || 0);
}

export function classifyDuplicatePosterCandidates(files, { checksums = {} } = {}) {
  const groups = new Map();
  for (const file of files || []) {
    const path = String(file.filePath || '');
    if (!path.startsWith('/posters/')) continue;
    const id = posterIdentityFromName(file.name);
    if (!id || !file.fileId) continue;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(file);
  }

  const candidates = [];
  const retained = [];
  for (const [id, copies] of groups) {
    if (copies.length < 2) continue;
    const canonical = copies.filter(file => String(file.name).toLowerCase() === id + '.jpg').sort(newestFirst);
    if (!canonical.length) {
      retained.push({ id, reason: 'canonical-public-path-missing', fileIds: copies.map(file => file.fileId) });
      continue;
    }
    const keep = canonical[0];
    const keepHash = checksums[keep.fileId];
    if (!keepHash) {
      retained.push({ id, reason: 'canonical-checksum-unavailable', fileIds: copies.map(file => file.fileId) });
      continue;
    }
    for (const file of copies) {
      if (file.fileId === keep.fileId) continue;
      const hash = checksums[file.fileId];
      if (hash && hash === keepHash) {
        candidates.push({
          kind: 'duplicate-poster-file',
          id,
          fileId: file.fileId,
          path: file.filePath,
          bytes: Math.max(0, Number(file.size) || 0),
          reason: 'byte-identical-to-canonical-public-poster',
          protectedFileId: keep.fileId
        });
      } else {
        retained.push({
          id,
          reason: hash ? 'different-content-retained' : 'checksum-unavailable-retained',
          fileIds: [file.fileId, keep.fileId]
        });
      }
    }
  }
  return { candidates, retained };
}

export function classifyUnpointedVersionCandidates(files, {
  activePaths = new Set(),
  unknownPointerIds = new Set(),
  now = Date.now(),
  retentionMs = DEFAULT_POSTER_VERSION_RETENTION_MS
} = {}) {
  const candidates = [];
  const retained = [];
  for (const file of files || []) {
    const path = String(file.filePath || '');
    const match = path.match(/^\/poster-versions\/(tt\d{7,10})\/([a-f0-9]{64})\.jpg$/i);
    if (!match || !file.fileId) continue;
    const id = match[1].toLowerCase();
    if (unknownPointerIds.has(id)) {
      retained.push({ id, fileId: file.fileId, path, reason: 'pointer-missing-or-unverifiable' });
      continue;
    }
    if (activePaths.has(path)) {
      retained.push({ id, fileId: file.fileId, path, reason: 'currently-pointed-version' });
      continue;
    }
    const createdAt = Date.parse(file.createdAt || file.updatedAt || '');
    if (!Number.isFinite(createdAt) || now - createdAt < retentionMs) {
      retained.push({ id, fileId: file.fileId, path, reason: 'inside-retention-window-or-date-unknown' });
      continue;
    }
    candidates.push({
      kind: 'unpointed-versioned-poster',
      id,
      fileId: file.fileId,
      path,
      bytes: Math.max(0, Number(file.size) || 0),
      reason: 'pointer-verified-and-older-than-retention-window'
    });
  }
  return { candidates, retained };
}

export function accountBytesAfterDeletion(accountBytes, deletedBytes) {
  return Math.max(0, Number(accountBytes) - Math.max(0, Number(deletedBytes) || 0));
}
