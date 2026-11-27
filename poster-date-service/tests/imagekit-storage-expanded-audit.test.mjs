import test from 'node:test';
import assert from 'node:assert/strict';
import { categoryFor, summarizeVersions } from '../lib/imagekit-expanded-audit-utils.mjs';

test('expanded audit classifies every asset family without widening deletion scope', () => {
  assert.equal(categoryFor('/posters/tt1234567.jpg'), 'posters');
  assert.equal(categoryFor('/poster-versions/tt1234567/hash.jpg'), 'poster-versions');
  assert.equal(categoryFor('/catalog-state/index.json'), 'catalog-state');
  assert.equal(categoryFor('/backdrops/ml.jpg'), 'backdrops');
  assert.equal(categoryFor('/hero/reel.mp4'), 'hero-reels');
  assert.equal(categoryFor('/reels/reel.mp4'), 'hero-reels');
  assert.equal(categoryFor('/epg/guide.xml'), 'epg');
  assert.equal(categoryFor('/unclassified/file.bin'), 'other');
});

test('version reconciliation counts only non-current versions and their exact bytes', () => {
  const now = Date.parse('2026-11-22T00:00:00Z');
  const versions = [
    { versionInfo: { id: 'current' }, size: 100, createdAt: '2026-11-21T00:00:00Z' },
    { versionInfo: { id: 'old-1' }, size: 50, createdAt: '2026-10-01T00:00:00Z' },
    { versionInfo: { id: 'old-2' }, size: 25, createdAt: '2026-11-10T00:00:00Z' }
  ];
  const result = summarizeVersions(versions, 'current', now);
  assert.equal(result.historicalVersionCount, 2);
  assert.equal(result.historicalVersionBytes, 75);
  assert.deepEqual(result.historicalVersionsOlderThan30Days.map(v => v.versionId), ['old-1']);
});

test('unknown dates are retained, not treated as reclaimable history', () => {
  const result = summarizeVersions([
    { versionInfo: { id: 'old' }, size: 20 },
    { versionInfo: { id: 'undated' }, size: 10, createdAt: 'not-a-date' }
  ], 'current', Date.parse('2026-11-22T00:00:00Z'));
  assert.equal(result.historicalVersionCount, 2);
  assert.equal(result.historicalVersionBytes, 30);
  assert.equal(result.historicalVersionsOlderThan30Days.length, 0);
});

test('non-poster categories are classified for inventory-only reporting', () => {
  for (const path of ['/catalog-state/a.json', '/backdrops/a.jpg', '/hero/a.mp4', '/epg/a.xml', '/other/a.bin']) {
    assert.notEqual(categoryFor(path), 'posters');
    assert.notEqual(categoryFor(path), 'poster-versions');
  }
});
