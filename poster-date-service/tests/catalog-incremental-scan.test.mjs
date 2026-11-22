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

test('metadata index chunk validator rejects count, generation and checksum mismatches', () => {
  const records = [{ id: 'tt1234567' }];
  const { createHash } = await import('node:crypto');
  const sha256 = createHash('sha256').update(JSON.stringify(records)).digest('hex');
  const chunk = { version: 1, scanGeneration: 'g1', index: 0, count: 1, sha256, records };
  assert.equal(validateMetadataIndexChunk(chunk, { scanGeneration: 'g1', index: 0, count: 1, sha256 }), true);
  assert.equal(validateMetadataIndexChunk(chunk, { scanGeneration: 'g2', index: 0, count: 1, sha256 }), false);
  assert.equal(validateMetadataIndexChunk({ ...chunk, count: 2 }, { scanGeneration: 'g1', index: 0, count: 1, sha256 }), false);
  assert.equal(validateMetadataIndexChunk({ ...chunk, sha256: '0'.repeat(64) }, { scanGeneration: 'g1', index: 0, count: 1, sha256 }), false);
});
