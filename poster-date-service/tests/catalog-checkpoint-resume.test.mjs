import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canReuseCatalogueCheckpoint, isExplicitlyDeferredCatalogueCheckpoint,
  isCatalogueScanComplete, excludeHistoricalUnresolvedQueueItems
} from '../lib/catalog-manifest-refresh.mjs';

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


test('explicitly deferred catalogues are complete only for the same generation and required extras', () => {
  const catalogue = {
    type: 'series', id: 'calendar-videos',
    required: ['genre'], extra: []
  };
  const saved = {
    status: 'deferred',
    reason: 'required-extra-options-unavailable',
    requiredExtras: ['genre'],
    scanGeneration: 'generation-a'
  };
  assert.equal(isExplicitlyDeferredCatalogueCheckpoint(saved, catalogue, 'generation-a'), true);
  assert.equal(isExplicitlyDeferredCatalogueCheckpoint({ ...saved, scanGeneration: 'generation-b' }, catalogue, 'generation-a'), false);
  assert.equal(isExplicitlyDeferredCatalogueCheckpoint({ ...saved, requiredExtras: ['search'] }, catalogue, 'generation-a'), false);
  assert.equal(isExplicitlyDeferredCatalogueCheckpoint({ ...saved, reason: 'fetch-failed' }, catalogue, 'generation-a'), false);
  assert.equal(isExplicitlyDeferredCatalogueCheckpoint(null, catalogue, 'generation-a'), false);
});

test('catalogue discovery completion accepts explicit deferrals but rejects incomplete scanned catalogues', () => {
  assert.equal(isCatalogueScanComplete([
    { source: 'A', pages: 3, records: 20 },
    { source: 'B', skipped: true, deferred: true },
    { source: 'C', skipped: true, skippedDuplicate: true }
  ]), true);
  assert.equal(isCatalogueScanComplete([{ source: 'A', error: 'provider unavailable' }]), false);
  assert.equal(isCatalogueScanComplete([{ source: 'A', truncated: true }]), false);
  assert.equal(isCatalogueScanComplete([{ source: 'A', skipped: true }]), false);
});


test('normal queue drains exclude historical failed, retry and upload-pending records without mutating the durable snapshot', () => {
  const snapshot = [
    { id: 'tt1000001' }, { id: 'tt1000002' }, { id: 'tt1000003' },
    { id: 'tt1000004' }
  ];
  const original = structuredClone(snapshot);
  const eligible = excludeHistoricalUnresolvedQueueItems(snapshot, new Set(['tt1000002', 'tt1000004']));
  assert.deepEqual(eligible.map(item => item.id), ['tt1000001', 'tt1000003']);
  assert.deepEqual(snapshot, original);
  assert.equal(snapshot.length, 4);
});
