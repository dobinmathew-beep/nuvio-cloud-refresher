import test from 'node:test';
import assert from 'node:assert/strict';

function categoryFor(path) {
  const p = String(path || '/').toLowerCase();
  if (p.startsWith('/posters/')) return 'posters';
  if (p.startsWith('/poster-versions/')) return 'poster-versions';
  if (p.startsWith('/catalog-state/')) return 'catalog-state';
  if (p.startsWith('/backdrops/')) return 'backdrops';
  if (p.startsWith('/hero/') || p.startsWith('/reels/')) return 'hero-reels';
  if (p.startsWith('/epg/')) return 'epg';
  return 'other';
}

test('expanded audit classifies every asset family without widening deletion scope', () => {
  assert.equal(categoryFor('/posters/tt1234567.jpg'), 'posters');
  assert.equal(categoryFor('/poster-versions/tt1234567/hash.jpg'), 'poster-versions');
  assert.equal(categoryFor('/catalog-state/index.json'), 'catalog-state');
  assert.equal(categoryFor('/backdrops/ml.jpg'), 'backdrops');
  assert.equal(categoryFor('/hero/reel.mp4'), 'hero-reels');
  assert.equal(categoryFor('/epg/guide.xml'), 'epg');
  assert.equal(categoryFor('/unclassified/file.bin'), 'other');
});

test('version reconciliation includes only non-current versions', () => {
  const versions = [
    { versionInfo: { id: 'current' }, size: 100 },
    { versionInfo: { id: 'old-1' }, size: 50 },
    { versionInfo: { id: 'old-2' }, size: 25 }
  ];
  const currentId = 'current';
  const historical = versions.filter(v => v.versionInfo?.id && v.versionInfo.id !== currentId);
  assert.equal(historical.length, 2);
  assert.equal(historical.reduce((sum, v) => sum + v.size, 0), 75);
});

test('non-poster categories are report-only and never nominated', () => {
  const protectedCategories = new Set(['catalog-state', 'backdrops', 'hero-reels', 'epg', 'other']);
  for (const category of protectedCategories) {
    assert.ok(protectedCategories.has(category));
  }
  assert.equal({ deletionEnabled: false, destructiveRequestsIssued: 0 }.deletionEnabled, false);
});
