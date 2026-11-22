import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeCatalogSourceItem } from '../lib/catalog-manifest-refresh.mjs';

test('catalogue merge retains all distinct source identities across overlapping manifests', () => {
  const first = {
    id: 'tt1234567', title: 'Example', catalogSource: 'MidnightIgnite', catalogId: 'popular',
    catalogSources: [{ source: 'MidnightIgnite', id: 'popular' }]
  };
  const second = {
    id: 'tt1234567', title: 'Example (alternate)', catalogSource: 'ElfHosted', catalogId: 'trending'
  };
  const merged = mergeCatalogSourceItem(first, second);
  assert.deepEqual(merged.catalogSources, [
    { source: 'ElfHosted', id: 'trending' },
    { source: 'MidnightIgnite', id: 'popular' }
  ]);
  assert.equal(merged.title, 'Example');
});

test('catalogue merge is idempotent and removes duplicate/empty source identities', () => {
  const item = {
    id: 'tt1234567',
    catalogSource: 'Xperience',
    catalogId: 'series',
    catalogSources: [
      { source: 'Xperience', id: 'series' },
      { source: 'Xperience', id: 'series' },
      { source: '', id: '' }
    ]
  };
  const once = mergeCatalogSourceItem(null, item);
  const twice = mergeCatalogSourceItem(once, item);
  assert.deepEqual(twice.catalogSources, [{ source: 'Xperience', id: 'series' }]);
});


test('metadata index preserves a canonical IMDb ID from the catalogue item ID', async () => {
  const { metadataIndexImdbId } = await import('../lib/catalog-manifest-refresh.mjs');
  assert.equal(metadataIndexImdbId({ id: 'tt1234567' }), 'tt1234567');
  assert.equal(metadataIndexImdbId({ id: 'TT12345678' }), 'tt12345678');
  assert.equal(metadataIndexImdbId({ id: 'tmdb:12345' }), '');
});

test('metadata index prefers a valid explicit IMDb ID and rejects malformed values', async () => {
  const { metadataIndexImdbId } = await import('../lib/catalog-manifest-refresh.mjs');
  assert.equal(metadataIndexImdbId({ id: 'tmdb:12345', imdbId: 'tt7654321' }), 'tt7654321');
  assert.equal(metadataIndexImdbId({ id: 'tt1234567', imdbId: 'not-an-imdb-id' }), 'tt1234567');
});
