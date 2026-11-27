import test from 'node:test';
import assert from 'node:assert/strict';
import {
  posterIdentityFromName,
  classifyDuplicatePosterCandidates,
  classifyUnpointedVersionCandidates,
  accountBytesAfterDeletion
} from '../lib/imagekit-storage-audit.mjs';

test('recognises IMDb, TMDB and TVMaze fallback poster filenames', () => {
  assert.equal(posterIdentityFromName('tt1234567.jpg'), 'tt1234567');
  assert.equal(posterIdentityFromName('TMDB-12345.jpg'), 'tmdb-12345');
  assert.equal(posterIdentityFromName('tvmaze-987654_extra.jpg'), 'tvmaze-987654');
  assert.equal(posterIdentityFromName('unrelated.jpg'), null);
});

test('only reports byte-identical non-canonical poster copies and protects canonical path', () => {
  const files = [
    { fileId: 'keep', name: 'tmdb-123.jpg', filePath: '/posters/tmdb-123.jpg', size: 100 },
    { fileId: 'same', name: 'tmdb-123_copy.jpg', filePath: '/posters/tmdb-123_copy.jpg', size: 100 },
    { fileId: 'different', name: 'tmdb-123_old.jpg', filePath: '/posters/tmdb-123_old.jpg', size: 90 }
  ];
  const result = classifyDuplicatePosterCandidates(files, {
    checksums: { keep: 'abc', same: 'abc', different: 'xyz' }
  });
  assert.deepEqual(result.candidates.map(item => item.fileId), ['same']);
  assert.equal(result.candidates[0].protectedFileId, 'keep');
  assert.ok(result.retained.some(item => item.reason === 'different-content-retained'));
});

test('does not nominate duplicates when canonical checksum is unknown', () => {
  const result = classifyDuplicatePosterCandidates([
    { fileId: 'a', name: 'tt1234567.jpg', filePath: '/posters/tt1234567.jpg' },
    { fileId: 'b', name: 'tt1234567_copy.jpg', filePath: '/posters/tt1234567_copy.jpg' }
  ]);
  assert.equal(result.candidates.length, 0);
});

test('unpointed versions require a verified pointer and age beyond retention', () => {
  const old = new Date('2025-01-01T00:00:00Z').toISOString();
  const files = [
    { fileId: 'old', filePath: '/poster-versions/tt1234567/' + 'a'.repeat(64) + '.jpg', createdAt: old, size: 200 },
    { fileId: 'active', filePath: '/poster-versions/tt1234567/' + 'b'.repeat(64) + '.jpg', createdAt: old, size: 200 },
    { fileId: 'unknown', filePath: '/poster-versions/tt7654321/' + 'c'.repeat(64) + '.jpg', createdAt: old, size: 200 }
  ];
  const result = classifyUnpointedVersionCandidates(files, {
    activePaths: new Set([files[1].filePath]),
    unknownPointerIds: new Set(['tt7654321']),
    now: Date.parse('2026-11-22T00:00:00Z')
  });
  assert.deepEqual(result.candidates.map(item => item.fileId), ['old']);
  assert.equal(result.retained.length, 2);
});

test('storage byte accounting subtracts reclaimed version bytes', () => {
  assert.equal(accountBytesAfterDeletion(1000, 250), 750);
  assert.equal(accountBytesAfterDeletion(100, 250), 0);
});
