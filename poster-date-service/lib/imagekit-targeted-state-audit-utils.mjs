import { createHash } from 'node:crypto';

export const TARGET_FILES = [
  { path: '/catalog-state/durable-queue/741382b785709edc43efd65a4ce0b14b/queue-state.json', role: 'durable-queue-state' },
  { path: '/catalog-state/manifest-scan-checkpoint.json', role: 'manifest-scan-checkpoint' },
];

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
}
function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'object';
  return typeof value;
}
function shapeOf(value, depth = 0) {
  if (depth >= 4) return { type: typeOf(value), truncated: true };
  if (Array.isArray(value)) {
    return {
      type: 'array', length: value.length,
      itemShape: value.length ? shapeOf(value[0], depth + 1) : null,
    };
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    return {
      type: 'object',
      keyCount: entries.length,
      fields: Object.fromEntries(entries.slice(0, 100).map(([key, item]) => [key, shapeOf(item, depth + 1)])),
      omittedFieldCount: Math.max(0, entries.length - 100),
    };
  }
  return { type: typeOf(value) };
}

export function summarizeCurrentContent(buffer) {
  const raw = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const text = raw.toString('utf8');
  let parsed;
  try { parsed = JSON.parse(text); }
  catch {
    return {
      validJson: false, bytes: raw.length,
      sha256: createHash('sha256').update(raw).digest('hex'),
      textPreview: text.slice(0, 300).replace(/[\u0000-\u001f]/g, ' '),
    };
  }
  return {
    validJson: true,
    bytes: raw.length,
    sha256: createHash('sha256').update(raw).digest('hex'),
    rootShape: shapeOf(parsed),
  };
}

export function analyzeTargetVersions({ reconciliation, fileDetailsByPath, generatedAt }) {
  const historical = reconciliation?.versionInventory?.historicalVersionRecords;
  if (!Array.isArray(historical)) throw new Error('Reconciliation report has no historicalVersionRecords array');
  const targets = TARGET_FILES.map(target => {
    const detail = fileDetailsByPath[target.path];
    if (!detail?.fileId || !detail?.currentVersionId) {
      throw new Error('Missing verified current file identity for ' + target.path);
    }
    const records = historical.filter(row => row.path === target.path && row.fileId === detail.fileId);
    const foreign = historical.filter(row => row.path === target.path && row.fileId !== detail.fileId);
    if (foreign.length) throw new Error('File ID mismatch in historical inventory for ' + target.path);
    const ids = new Set();
    for (const row of records) {
      if (!row.versionId || row.versionId === detail.currentVersionId || ids.has(row.versionId)) {
        throw new Error('Historical version identity is missing, current, or duplicated for ' + target.path);
      }
      ids.add(row.versionId);
    }
    const ordered = [...records].sort((a, b) => a.timestamp - b.timestamp);
    const timestamps = ordered.map(row => row.timestamp).filter(Number.isFinite);
    const gaps = timestamps.slice(1).map((value, i) => value - timestamps[i]);
    const byDay = {};
    const byHour = {};
    for (const row of ordered) {
      if (!Number.isFinite(row.timestamp)) continue;
      const date = new Date(row.timestamp);
      const day = date.toISOString().slice(0, 10);
      const hour = date.toISOString().slice(0, 13) + ':00Z';
      byDay[day] = (byDay[day] || 0) + 1;
      byHour[hour] = (byHour[hour] || 0) + 1;
    }
    const sizes = records.map(row => row.bytes).filter(Number.isFinite);
    const bytesTotal = sizes.reduce((sum, value) => sum + value, 0);
    const proposalVersions = ordered.map(row => ({
      fileId: row.fileId,
      path: row.path,
      versionId: row.versionId,
      createdAt: row.createdAt || row.timestampRaw || null,
      sizeBytes: row.bytes,
      ageClass: row.ageClass,
      current: false,
      proposedAction: 'review-for-deletion',
      approvalRequired: true,
    }));
    return {
      ...target,
      fileId: detail.fileId,
      currentVersionId: detail.currentVersionId,
      currentSizeBytes: detail.currentSizeBytes,
      currentUpdatedAt: detail.currentUpdatedAt,
      currentContent: detail.currentContent,
      historicalVersionCount: records.length,
      historicalBytes: bytesTotal,
      timestampCoverage: timestamps.length,
      oldestHistoricalAt: timestamps.length ? new Date(timestamps[0]).toISOString() : null,
      newestHistoricalAt: timestamps.length ? new Date(timestamps.at(-1)).toISOString() : null,
      updateFrequency: {
        observedSpanHours: timestamps.length > 1 ? Number(((timestamps.at(-1) - timestamps[0]) / 3600000).toFixed(3)) : 0,
        meanVersionsPerHour: timestamps.length > 1 ? Number(((timestamps.length - 1) / ((timestamps.at(-1) - timestamps[0]) / 3600000)).toFixed(2)) : null,
        medianGapSeconds: percentile(gaps, 0.5) === null ? null : Number((percentile(gaps, 0.5) / 1000).toFixed(2)),
        p90GapSeconds: percentile(gaps, 0.9) === null ? null : Number((percentile(gaps, 0.9) / 1000).toFixed(2)),
        minGapSeconds: gaps.length ? Number((Math.min(...gaps) / 1000).toFixed(2)) : null,
        maxGapSeconds: gaps.length ? Number((Math.max(...gaps) / 1000).toFixed(2)) : null,
      },
      historicalSizeDistribution: {
        minBytes: sizes.length ? Math.min(...sizes) : null,
        medianBytes: percentile(sizes, 0.5),
        meanBytes: sizes.length ? Math.round(bytesTotal / sizes.length) : null,
        p90Bytes: percentile(sizes, 0.9),
        maxBytes: sizes.length ? Math.max(...sizes) : null,
      },
      versionsPerDay: byDay,
      versionsPerHour: byHour,
      historicalVersions: proposalVersions,
    };
  });
  const proposal = {
    generatedAt,
    mode: 'proposal-only-no-mutations',
    deletionEnabled: false,
    destructiveRequestsIssued: 0,
    mutationMethodsUsed: [],
    approvalStatus: 'NOT APPROVED',
    note: 'Every listed ID is a non-current historical version of one of the two exact target files. This is a review proposal only; no DELETE request was issued. Verify queue/checkpoint recovery requirements and current pointers before approving any deletion.',
    targets: targets.map(target => ({
      path: target.path,
      fileId: target.fileId,
      currentVersionId: target.currentVersionId,
      historicalVersionCount: target.historicalVersions.length,
      proposedHistoricalBytes: target.historicalBytes,
      versions: target.historicalVersions,
    })),
    totalProposedHistoricalVersions: targets.reduce((sum, target) => sum + target.historicalVersions.length, 0),
    totalProposedHistoricalBytes: targets.reduce((sum, target) => sum + target.historicalBytes, 0),
  };
  return { targets, proposal };
}
