import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVersionTimestamp, reconcileVersionRecords, compareByteMeasurements } from '../lib/imagekit-storage-reconciliation-utils.mjs';

test('timestamp parser accepts ISO and epoch seconds/milliseconds and records source', () => {
  assert.equal(parseVersionTimestamp({ createdAt: '2026-10-01T00:00:00.000Z' }).timestamp, Date.parse('2026-10-01T00:00:00.000Z'));
  assert.equal(parseVersionTimestamp({ createdAt: 1790812800 }).timestamp, 1790812800000);
  assert.equal(parseVersionTimestamp({ createdAt: 1790812800000 }).timestamp, 1790812800000);
  assert.equal(parseVersionTimestamp({ createdAt: 'bad', updatedAt: '2026-10-02T00:00:00Z' }).source, 'updatedAt');
});

test('version reconciliation identifies current, old, recent, unknown, future and duplicate records', () => {
  const now = Date.parse('2026-11-22T00:00:00Z');
  const result = reconcileVersionRecords([
    { versionInfo: { id: 'current' }, size: 100, createdAt: '2026-11-21T00:00:00Z' },
    { versionInfo: { id: 'old' }, size: 50, createdAt: '2026-10-01T00:00:00Z' },
    { versionInfo: { id: 'recent' }, size: 25, createdAt: '2026-11-10T00:00:00Z' },
    { versionInfo: { id: 'unknown' }, size: 10 },
    { versionInfo: { id: 'future' }, size: 5, createdAt: '2026-12-01T00:00:00Z' },
    { versionInfo: { id: 'old' }, size: 50, createdAt: '2026-10-01T00:00:00Z' },
    { versionInfo: {}, size: 4 }
  ], 'current', now);
  assert.equal(result.historicalVersionCount, 4);
  assert.equal(result.historicalVersionBytes, 90);
  assert.equal(result.versionsOlderThanRetentionCount, 1);
  assert.equal(result.bytesOlderThanRetention, 50);
  assert.equal(result.unknownTimestampCount, 1);
  assert.equal(result.futureTimestampCount, 1);
  assert.deepEqual(result.duplicateVersionIds, ['old']);
  assert.equal(result.missingVersionIdCount, 1);
});

test('incomplete version sizes are not reported as a complete byte total', () => {
  const result = reconcileVersionRecords([
    { versionInfo: { id: 'current' }, size: 100 },
    { versionInfo: { id: 'historic' }, size: 'invalid' }
  ], 'current');
  assert.equal(result.historicalVersionBytes, 0);
  assert.equal(result.historicalVersionBytesWithCompleteSizes, null);
});

test('missing current-version match remains explicitly unresolved', () => {
  const result = reconcileVersionRecords([{ versionInfo: { id: 'v1' }, size: 10 }], 'current');
  assert.equal(result.missingCurrentVersionMatch, true);
});

test('account usage delta is withheld when version inventory is incomplete', () => {
  const result = compareByteMeasurements({ accountUsageBytes: 1000, currentFileBytes: 100, versionInventoryBytes: null, versionInventoryComplete: false });
  assert.equal(result.accountUsageMinusCurrentFilesBytes, 900);
  assert.equal(result.accountUsageMinusAllVersionsBytes, null);
  assert.equal(result.comparableAllVersionsMeasurement, false);
});

test('complete all-version comparison is explicit and diagnostic only', () => {
  const result = compareByteMeasurements({ accountUsageBytes: 1000, currentFileBytes: 100, versionInventoryBytes: 1500, versionInventoryComplete: true });
  assert.equal(result.accountUsageMinusAllVersionsBytes, -500);
  assert.equal(result.allVersionsExceedAccountUsage, true);
});
