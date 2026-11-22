import test from 'node:test';
import assert from 'node:assert/strict';
import { canReuseCatalogueCheckpoint } from '../lib/catalog-manifest-refresh.mjs';

const checkpoint = (overrides = {}) => ({
  version: 1, nextPage: 3, pages: 3, records: 250,
  seenPageIds: ['a'], titles: { tt1234567: { id: 'tt1234567' } },
  updatedAt: new Date().toISOString(), scanGeneration: 'old', complete: true,
  ...overrides
});

test('completed catalogue snapshots are refetched in a new daily generation', () => {
  assert.equal(canReuseCatalogueCheckpoint(checkpoint({ complete: true }), 'new'), false);
});

test('incomplete page checkpoints are reusable within the resume window', () => {
  assert.equal(canReuseCatalogueCheckpoint(checkpoint({ complete: false }), 'new'), true);
});

test('incomplete checkpoints outside the resume window are not adopted', () => {
  assert.equal(canReuseCatalogueCheckpoint(checkpoint({
    complete: false, updatedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
  }), 'new'), false);
});

test('same-generation checkpoints remain resumable, including completed catalogues', () => {
  assert.equal(canReuseCatalogueCheckpoint(checkpoint(), 'old'), true);
});

test('forced scans never reuse page checkpoints', () => {
  assert.equal(canReuseCatalogueCheckpoint(checkpoint({ complete: false }), 'new', true), false);
});
