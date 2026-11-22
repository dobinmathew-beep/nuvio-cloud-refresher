import test from 'node:test';
import assert from 'node:assert/strict';
import { canReuseCatalogueCheckpoint } from '../lib/catalog-manifest-refresh.mjs';

const now = Date.parse('2026-11-21T15:30:00.000Z');
const snapshot = overrides => ({
  version: 1,
  scanGeneration: 'old-generation',
  complete: true,
  nextPage: 1,
  pages: 1,
  records: 50,
  seenPageIds: ['tt0111161'],
  titles: { 'tt0111161': { id: 'tt0111161', type: 'movies', title: 'Example', poster: '' } },
  updatedAt: new Date(now - 60_000).toISOString(),
  ...overrides
});

test('refetches completed catalogue snapshots in a new daily generation', () => {
  assert.equal(canReuseCatalogueCheckpoint(snapshot(), 'new-generation', false, now), false);
});

test('adopts a recent partial page checkpoint from an earlier generation', () => {
  assert.equal(canReuseCatalogueCheckpoint(snapshot({ complete: false, nextPage: 3, pages: 3 }), 'new-generation', false, now), true);
});

test('rejects stale cross-generation checkpoints', () => {
  assert.equal(canReuseCatalogueCheckpoint(snapshot({ updatedAt: new Date(now - 4 * 24 * 60 * 60 * 1000).toISOString() }), 'new-generation', false, now), false);
});

test('does not adopt old checkpoints during an explicit forced rescan', () => {
  assert.equal(canReuseCatalogueCheckpoint(snapshot(), 'new-generation', true, now), false);
});

test('continues a matching-generation checkpoint even when incomplete', () => {
  assert.equal(canReuseCatalogueCheckpoint(snapshot({ complete: false, nextPage: 2 }), 'old-generation', false, now), true);
});

test('rejects malformed checkpoint snapshots', () => {
  assert.equal(canReuseCatalogueCheckpoint({ version: 1, complete: true }, 'new-generation', false, now), false);
});
