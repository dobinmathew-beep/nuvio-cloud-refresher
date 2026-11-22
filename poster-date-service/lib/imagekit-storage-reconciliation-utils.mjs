export function parseVersionTimestamp(version = {}) {
  const candidates = [
    ['createdAt', version.createdAt],
    ['updatedAt', version.updatedAt],
    ['embeddedMetadata.dateTimeCreated', version.embeddedMetadata?.dateTimeCreated],
    ['embeddedMetadata.dateCreated', version.embeddedMetadata?.dateCreated],
  ];
  for (const [source, raw] of candidates) {
    if (raw === null || raw === undefined || raw === '') continue;
    let timestamp = null;
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      timestamp = raw < 1e12 ? raw * 1000 : raw;
    } else if (typeof raw === 'string') {
      const parsed = Date.parse(raw);
      if (Number.isFinite(parsed)) timestamp = parsed;
    }
    if (timestamp !== null && Number.isFinite(timestamp)) {
      return { timestamp, source, raw: String(raw) };
    }
  }
  return { timestamp: null, source: null, raw: null };
}

function validBytes(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= 0) return Number(value);
  return null;
}

export function reconcileVersionRecords(versions, currentVersionId, now = Date.now(), retentionMs = 30 * 86400000) {
  const input = Array.isArray(versions) ? versions : [];
  const seen = new Set();
  const records = [];
  const duplicateVersionIds = [];
  const missingVersionIds = [];
  const invalidSizeVersionIds = [];
  for (const version of input) {
    const id = version?.versionInfo?.id;
    if (!id) { missingVersionIds.push(null); continue; }
    if (seen.has(id)) { duplicateVersionIds.push(id); continue; }
    seen.add(id);
    const size = validBytes(version.size);
    if (size === null) invalidSizeVersionIds.push(id);
    const date = parseVersionTimestamp(version);
    const isCurrent = currentVersionId ? id === currentVersionId : false;
    const ageMs = date.timestamp === null ? null : now - date.timestamp;
    records.push({
      versionId: id,
      isCurrent,
      bytes: size,
      timestamp: date.timestamp,
      timestampSource: date.source,
      timestampRaw: date.raw,
      ageClass: ageMs === null ? 'unknown' : ageMs < 0 ? 'future' : ageMs >= retentionMs ? 'older-than-retention' : 'within-retention',
      createdAt: version.createdAt || null,
      updatedAt: version.updatedAt || null,
    });
  }
  const historical = records.filter(v => !v.isCurrent);
  const knownDates = historical.filter(v => v.timestamp !== null);
  const sum = rows => rows.reduce((total, row) => total + (row.bytes ?? 0), 0);
  const validHistoricalBytes = historical.filter(v => v.bytes !== null);
  return {
    versionsReturned: input.length,
    uniqueVersionCount: records.length,
    historicalVersionCount: historical.length,
    historicalVersionBytes: sum(validHistoricalBytes),
    historicalVersionBytesWithCompleteSizes: historical.every(v => v.bytes !== null) ? sum(historical) : null,
    currentVersionMatches: records.filter(v => v.isCurrent).length,
    missingCurrentVersionMatch: Boolean(currentVersionId) && !records.some(v => v.isCurrent),
    missingVersionIdCount: missingVersionIds.length,
    duplicateVersionIds,
    invalidSizeVersionIds,
    unknownTimestampCount: historical.filter(v => v.ageClass === 'unknown').length,
    futureTimestampCount: historical.filter(v => v.ageClass === 'future').length,
    versionsOlderThanRetentionCount: historical.filter(v => v.ageClass === 'older-than-retention').length,
    bytesOlderThanRetention: sum(historical.filter(v => v.ageClass === 'older-than-retention' && v.bytes !== null)),
    bytesOlderThanRetentionComplete: historical.filter(v => v.ageClass === 'older-than-retention').every(v => v.bytes !== null),
    oldestHistoricalTimestamp: knownDates.length ? Math.min(...knownDates.map(v => v.timestamp)) : null,
    newestHistoricalTimestamp: knownDates.length ? Math.max(...knownDates.map(v => v.timestamp)) : null,
    records,
  };
}

export function compareByteMeasurements({ accountUsageBytes, currentFileBytes, versionInventoryBytes, versionInventoryComplete }) {
  const allVersionDeltaBytes = accountUsageBytes === null || !versionInventoryComplete
    ? null : accountUsageBytes - versionInventoryBytes;
  return {
    accountUsageMinusCurrentFilesBytes: accountUsageBytes === null ? null : accountUsageBytes - currentFileBytes,
    accountUsageMinusAllVersionsBytes: allVersionDeltaBytes,
    allVersionsExceedAccountUsage: allVersionDeltaBytes !== null && allVersionDeltaBytes < 0,
    comparableAllVersionsMeasurement: Boolean(versionInventoryComplete && accountUsageBytes !== null),
  };
}
