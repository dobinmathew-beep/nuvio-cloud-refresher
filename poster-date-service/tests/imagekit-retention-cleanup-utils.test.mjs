import test from 'node:test';
import assert from 'node:assert/strict';
import {
  planCurrentPlusOneHistorical,
  planTitlePosterAssetRetention,
  planCanonicalAndOneBackup,
  isCatalogStateJsonPath
} from '../lib/imagekit-retention-cleanup-utils.mjs';

const version = (id, date, size = 100) => ({
  versionInfo: { id }, createdAt: date, size
});
const asset = (fileId, filePath, date, size = 100) => ({
  fileId, filePath, name: filePath.split('/').at(-1), createdAt: date, size
});

test('keeps current plus only the newest valid historical version', () => {
  const plan = planCurrentPlusOneHistorical([
    version('v1', '2026-11-20T00:00:00Z'),
    version('v2', '2026-11-22T00:00:00Z'),
    version('current', '2026-11-23T00:00:00Z')
  ], 'current');
  assert.equal(plan.safe, true);
  assert.deepEqual(plan.keep.map(v => v.versionInfo.id), ['current', 'v2']);
  assert.deepEqual(plan.remove.map(v => v.versionInfo.id), ['v1']);
});

test('refuses version deletion when IDs, dates, or current match are ambiguous', () => {
  assert.equal(planCurrentPlusOneHistorical([version('v1', '2026-11-20')], 'missing').safe, false);
  assert.equal(planCurrentPlusOneHistorical([version('v1', 'bad'), version('current', '2026-11-23')], 'current').safe, false);
  assert.equal(planCurrentPlusOneHistorical([version('v1', '2026-11-20'), version('v1', '2026-11-21')], 'v1').safe, false);
});

test('keeps active poster and one newest previous poster; removes only older title assets', () => {
  const files = [
    asset('active', '/poster-versions/tt1234567/active.jpg', '2026-11-23T00:00:00Z'),
    asset('old', '/poster-versions/tt1234567/old.jpg', '2026-11-20T00:00:00Z'),
    asset('newest-old', '/poster-versions/tt1234567/newest-old.jpg', '2026-11-22T00:00:00Z')
  ];
  const plan = planTitlePosterAssetRetention(files, '/poster-versions/tt1234567/active.jpg');
  assert.equal(plan.safe, true);
  assert.deepEqual(plan.keep.map(v => v.fileId), ['active', 'newest-old']);
  assert.deepEqual(plan.remove.map(v => v.fileId), ['old']);
});

test('protects all title assets when active pointer or dates are uncertain', () => {
  assert.equal(planTitlePosterAssetRetention([asset('a','/poster-versions/tt1234567/a.jpg','2026-11-23')], '/missing').safe, false);
  const files = [
    asset('active', '/poster-versions/tt1234567/active.jpg', '2026-11-23'),
    asset('unknown', '/poster-versions/tt1234567/unknown.jpg', 'unknown')
  ];
  assert.equal(planTitlePosterAssetRetention(files, '/poster-versions/tt1234567/active.jpg').safe, false);
});

test('keeps canonical public poster plus one newest backup file', () => {
  const files = [
    asset('canonical','/posters/tt1234567.jpg','2026-11-23'),
    asset('older','/posters/tt1234567_old.jpg','2026-11-20'),
    asset('newer','/posters/tt1234567_alt.jpg','2026-11-22')
  ];
  const plan = planCanonicalAndOneBackup(files,'tt1234567');
  assert.equal(plan.safe,true);
  assert.deepEqual(plan.keep.map(v=>v.fileId),['canonical','newer']);
  assert.deepEqual(plan.remove.map(v=>v.fileId),['older']);
});

test('does not prune title poster files without a unique canonical public asset', () => {
  const files=[asset('a','/posters/tt1234567_alt.jpg','2026-11-23')];
  assert.equal(planCanonicalAndOneBackup(files,'tt1234567').safe,false);
});

test('catalogue-state retention is limited to JSON state files, never poster assets', () => {
  assert.equal(isCatalogStateJsonPath('/catalog-state/poster-processing/a.json'), true);
  assert.equal(isCatalogStateJsonPath('/catalog-state/catalogues/catalog-1.json'), true);
  assert.equal(isCatalogStateJsonPath('/catalog-state/metadata-index/deltas/change.json'), true);
  assert.equal(isCatalogStateJsonPath('/posters/tt1234567.jpg'), false);
  assert.equal(isCatalogStateJsonPath('/poster-versions/tt1234567/hash.jpg'), false);
  assert.equal(isCatalogStateJsonPath('/catalog-state/readme.txt'), false);
});
