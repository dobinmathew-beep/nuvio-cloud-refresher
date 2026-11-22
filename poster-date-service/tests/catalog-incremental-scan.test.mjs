import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeIncrementalMetadata,
  mergeIncrementalMetadataItem,
  validateMetadataIndexChunk
} from '../lib/catalog-manifest-refresh.mjs';

test('incremental merge preserves the complete baseline and adds new titles', () => {
  const baseline = [
    { id: 'tt1234567', title: 'Existing', catalogSource: 'MidnightIgnite', catalogId: 'popular', catalogSources: [{ source: 'MidnightIgnite', id: 'popular' }], fingerprint: 'old' },
    { id: 'tt1234568', title: 'Historical', catalogSource: 'ElfHosted', catalogId: 'all', catalogSources: [{ source: 'ElfHosted', id: 'all' }], fingerprint: 'historic' }
  ];
  const incoming = [
    { id: 'tt1234567', title: 'Existing', catalogSource: 'Xperience', catalogId: 'new', catalogSources: [{ source: 'Xperience', id: 'new' }] },
    { id: 'tt1234569', title: 'Brand new', catalogSource: 'MidnightIgnite', catalogId: 'popular' }
  ];
  const result = mergeIncrementalMetadata(baseline, incoming);
  assert.equal(result.items.length, 3);
  assert.equal(result.added, 1);
  assert.equal(result.changed, 1);
  assert.ok(result.items.some(item => item.id === 'tt1234568'));
  const existing = result.items.find(item => item.id === 'tt1234567');
  assert.deepEqual(existing.catalogSources, [
    { source: 'MidnightIgnite', id: 'popular' },
    { source: 'Xperience', id: 'new' }
  ]);
});

test('incremental metadata updates changed fields without erasing source identities', () => {
  const merged = mergeIncrementalMetadataItem(
    { id: 'tt1234567', title: 'Old title', poster: 'https://old', catalogSources: [{ source: 'A', id: 'one' }] },
    { id: 'tt1234567', title: 'Corrected title', poster: '', catalogSource: 'B', catalogId: 'two' }
  );
  assert.equal(merged.title, 'Corrected title');
  assert.equal(merged.poster, 'https://old');
  assert.deepEqual(merged.catalogSources, [{ source: 'A', id: 'one' }, { source: 'B', id: 'two' }]);
});

test('metadata index chunk validator rejects count, generation and checksum mismatches', async () => {
  const records = [{ id: 'tt1234567' }];
  const { createHash } = await import('node:crypto');
  const sha256 = createHash('sha256').update(JSON.stringify(records)).digest('hex');
  const chunk = { version: 1, scanGeneration: 'g1', index: 0, count: 1, sha256, records };
  assert.equal(validateMetadataIndexChunk(chunk, { scanGeneration: 'g1', index: 0, count: 1, sha256 }), true);
  assert.equal(validateMetadataIndexChunk(chunk, { scanGeneration: 'g2', index: 0, count: 1, sha256 }), false);
  assert.equal(validateMetadataIndexChunk({ ...chunk, count: 2 }, { scanGeneration: 'g1', index: 0, count: 1, sha256 }), false);
  assert.equal(validateMetadataIndexChunk({ ...chunk, sha256: '0'.repeat(64) }, { scanGeneration: 'g1', index: 0, count: 1, sha256 }), false);
});

test('incremental scanner samples all three manifests with a strict per-catalogue page bound', async () => {
  const { collectIncrementalCatalogues } = await import('../lib/catalog-manifest-refresh.mjs');
  const manifests = ['MidnightIgnite', 'ElfHosted', 'Xperience'].map(name => ({
    name, catalogs: [{ type: 'movie', id: 'popular', extra: [], required: [] }]
  }));
  const calls = [];
  const result = await collectIncrementalCatalogues(manifests, {
    pageLimit: 1,
    baselineIds: new Set(),
    fetchPage: async (manifest, catalog, skip) => {
      calls.push({ source: manifest.name, catalog: catalog.id, skip });
      return { metas: [{ id: 'tt1234567', name: 'Shared title', poster: 'https://image.example/poster.jpg' }] };
    }
  });
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map(call => call.source), ['MidnightIgnite', 'ElfHosted', 'Xperience']);
  assert.ok(calls.every(call => call.skip === 0));
  assert.equal(result.pagesFetched, 3);
  assert.equal(result.observed.length, 1);
  assert.deepEqual(result.observed[0].catalogSources, [
    { source: 'ElfHosted', id: 'popular' },
    { source: 'MidnightIgnite', id: 'popular' },
    { source: 'Xperience', id: 'popular' }
  ]);
});

test('incremental scanner fails closed when catalogue inventory exceeds its bound', async () => {
  const { collectIncrementalCatalogues } = await import('../lib/catalog-manifest-refresh.mjs');
  const manifests = [{ name: 'MidnightIgnite', catalogs: Array.from({ length: 3 }, (_, i) => ({
    type: 'movie', id: 'catalog-' + i, extra: [], required: []
  })) }];
  await assert.rejects(
    collectIncrementalCatalogues(manifests, { maxCatalogues: 2, fetchPage: async () => ({ metas: [] }) }),
    /catalogue limit exceeded/
  );
});

test('incremental metadata merge is idempotent after source identities are learned', () => {
  const first = mergeIncrementalMetadata(
    [{ id: 'tt1234567', title: 'Existing', catalogSource: 'A', catalogId: 'one', catalogSources: [{ source: 'A', id: 'one' }] }],
    [{ id: 'tt1234567', title: 'Existing', catalogSource: 'B', catalogId: 'two' }]
  );
  const second = mergeIncrementalMetadata(first.items, [
    { id: 'tt1234567', title: 'Existing', catalogSource: 'B', catalogId: 'two' }
  ]);
  assert.equal(second.added, 0);
  assert.equal(second.changed, 0);
  assert.equal(second.delta.length, 0);
});
