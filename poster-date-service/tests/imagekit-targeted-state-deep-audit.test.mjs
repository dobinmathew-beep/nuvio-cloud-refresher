import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeTargetVersions, summarizeCurrentContent, TARGET_FILES } from '../lib/imagekit-targeted-state-audit-utils.mjs';

const paths = TARGET_FILES.map(v => v.path);
function fixture() {
  return {
    versionInventory: {
      historicalVersionRecords: [
        { fileId: 'file-a', path: paths[0], versionId: 'a1', bytes: 100, timestamp: 1000, timestampRaw: '1970-01-01T00:00:01Z', ageClass: 'within-retention' },
        { fileId: 'file-a', path: paths[0], versionId: 'a2', bytes: 200, timestamp: 61000, timestampRaw: '1970-01-01T00:01:01Z', ageClass: 'within-retention' },
        { fileId: 'file-b', path: paths[1], versionId: 'b1', bytes: 300, timestamp: 121000, timestampRaw: '1970-01-01T00:02:01Z', ageClass: 'within-retention' },
      ],
    },
  };
}
const current = {
  [paths[0]]: { fileId: 'file-a', currentVersionId: 'a-current', currentSizeBytes: 400, currentUpdatedAt: '2026-11-22T00:00:00Z', currentContent: { validJson: true, bytes: 12, sha256: 'abc', rootShape: { type: 'object', keyCount: 1, fields: { tasks: { type: 'array', length: 2, itemShape: { type: 'object', keyCount: 1, fields: { id: { type: 'string' } }, omittedFieldCount: 0 } }, }, omittedFieldCount: 0 } } },
  [paths[1]]: { fileId: 'file-b', currentVersionId: 'b-current', currentSizeBytes: 500, currentUpdatedAt: '2026-11-22T00:00:00Z', currentContent: { validJson: true, bytes: 15, sha256: 'def', rootShape: { type: 'object', keyCount: 0, fields: {}, omittedFieldCount: 0 } } },
};

test('current content summary reports structure and hash without exposing scalar values', () => {
  const summary = summarizeCurrentContent(Buffer.from(JSON.stringify({ secret: 'do-not-leak', tasks: [{ id: '123' }] })));
  assert.equal(summary.validJson, true);
  assert.equal(summary.rootShape.fields.secret.type, 'string');
  assert.equal(JSON.stringify(summary).includes('do-not-leak'), false);
  assert.equal(summary.rootShape.fields.tasks.length, 1);
});

test('target analysis creates exact non-current version proposal and distribution', () => {
  const result = analyzeTargetVersions({ reconciliation: fixture(), fileDetailsByPath: current, generatedAt: '2026-11-22T00:00:00Z' });
  assert.equal(result.targets[0].historicalVersionCount, 2);
  assert.equal(result.targets[0].historicalBytes, 300);
  assert.equal(result.targets[0].updateFrequency.medianGapSeconds, 60);
  assert.deepEqual(result.proposal.targets[0].versions.map(v => v.versionId), ['a1', 'a2']);
  assert.equal(result.proposal.totalProposedHistoricalVersions, 3);
  assert.equal(result.proposal.totalProposedHistoricalBytes, 600);
  assert.equal(result.proposal.destructiveRequestsIssued, 0);
  assert.equal(result.proposal.approvalStatus, 'NOT APPROVED');
});

test('analysis refuses mismatched file IDs and current-version IDs', () => {
  const bad = fixture();
  bad.versionInventory.historicalVersionRecords[0].fileId = 'wrong-file';
  assert.throws(() => analyzeTargetVersions({ reconciliation: bad, fileDetailsByPath: current, generatedAt: 'x' }), /File ID mismatch/);
  const badCurrent = fixture();
  badCurrent.versionInventory.historicalVersionRecords[0].versionId = 'a-current';
  assert.throws(() => analyzeTargetVersions({ reconciliation: badCurrent, fileDetailsByPath: current, generatedAt: 'x' }), /missing, current, or duplicated/);
});
