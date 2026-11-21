import test from 'node:test';
import assert from 'node:assert/strict';
import { validCatalogPosterFallback } from '../lib/catalog-poster-fallback.mjs';
import { imageKitStorageSnapshotUrl } from '../lib/imagekit-storage.mjs';
import { needsResumeVerification } from '../lib/catalog-prewarm-policy.mjs';

test('catalog poster fallback accepts only approved HTTPS image hosts', () => {
  assert.equal(validCatalogPosterFallback('https://image.tmdb.org/t/p/w500/poster.jpg'), true);
  assert.equal(validCatalogPosterFallback('https://m.media-amazon.com/images/poster.webp'), true);
  assert.equal(validCatalogPosterFallback('https://evil.example/poster.jpg'), false);
  assert.equal(validCatalogPosterFallback('http://image.tmdb.org/poster.jpg'), false);
  assert.equal(validCatalogPosterFallback('https://user:pass@image.tmdb.org/poster.jpg'), false);
  assert.equal(validCatalogPosterFallback('https://image.tmdb.org:8443/poster.jpg'), false);
  assert.equal(validCatalogPosterFallback('https://image.tmdb.org/poster.svg'), false);
});

test('ImageKit storage snapshot restore URL busts stale CDN 404 cache', () => {
  assert.equal(
    imageKitStorageSnapshotUrl('https://ik.imagekit.io/demo/', 12345),
    'https://ik.imagekit.io/demo/catalog-state/imagekit-storage-snapshot.json?v=12345'
  );
});

test('interrupted upload-pending and recently failed records are verified before regeneration', () => {
  const fingerprint = 'movie|catalog';
  assert.equal(needsResumeVerification({ status: 'upload-pending', fingerprint }, fingerprint, 1000), true);
  assert.equal(needsResumeVerification({
    status: 'failed', fingerprint, retryAfter: new Date(5000).toISOString()
  }, fingerprint, 1000), true);
  assert.equal(needsResumeVerification({
    status: 'failed', fingerprint, retryAfter: new Date(500).toISOString()
  }, fingerprint, 1000), false);
  assert.equal(needsResumeVerification({ status: 'upload-pending', fingerprint: 'other' }, fingerprint, 1000), false);
});
