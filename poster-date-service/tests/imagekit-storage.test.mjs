import test from 'node:test';
import assert from 'node:assert/strict';
import {
  IMAGEKIT_STORAGE_LIMIT_BYTES,
  imageKitConfig,
  getImageKitStorageSnapshot,
  canStoreImageKitPoster,
  canStoreImmutableImageKitPoster,
  hasImmutablePosterStorageCapacity,
  shouldDeleteUnpointedVersion,
  VERSIONED_POSTER_RETENTION_MS
} from '../lib/imagekit-storage.mjs';

test('ImageKit storage safety ceiling leaves a 25 percent reserve', () => {
  assert.equal(IMAGEKIT_STORAGE_LIMIT_BYTES, 2_250_000_000);
});

test('ImageKit config rejects missing and malformed credentials', () => {
  const previousEndpoint = process.env.IMAGEKIT_URL_ENDPOINT;
  const previousKey = process.env.IMAGEKIT_PRIVATE_KEY;
  try {
    delete process.env.IMAGEKIT_URL_ENDPOINT;
    delete process.env.IMAGEKIT_PRIVATE_KEY;
    assert.equal(imageKitConfig(), null);
    process.env.IMAGEKIT_URL_ENDPOINT = 'http://ik.imagekit.io/example';
    process.env.IMAGEKIT_PRIVATE_KEY = 'not-a-real-key';
    assert.equal(imageKitConfig(), null);
    process.env.IMAGEKIT_URL_ENDPOINT = 'https://ik.imagekit.io/example';
    assert.deepEqual(imageKitConfig(), { endpoint: 'https://ik.imagekit.io/example', privateKey: 'not-a-real-key' });
  } finally {
    if (previousEndpoint === undefined) delete process.env.IMAGEKIT_URL_ENDPOINT;
    else process.env.IMAGEKIT_URL_ENDPOINT = previousEndpoint;
    if (previousKey === undefined) delete process.env.IMAGEKIT_PRIVATE_KEY;
    else process.env.IMAGEKIT_PRIVATE_KEY = previousKey;
  }
});

test('uploads fail closed until a verified storage inventory exists', () => {
  const snapshot = getImageKitStorageSnapshot();
  assert.equal(snapshot.known, false);
  assert.equal(canStoreImageKitPoster('tt0111161', 1024), false);
});

test('retryable ImageKit upload responses are limited to transient HTTP statuses', async () => {
  const { isRetryableImageKitUploadStatus } = await import('../lib/imagekit-storage.mjs');
  for (const status of [408, 425, 429, 500, 502, 503, 504]) {
    assert.equal(isRetryableImageKitUploadStatus(status), true, String(status));
  }
  for (const status of [400, 401, 403, 404, 413]) {
    assert.equal(isRetryableImageKitUploadStatus(status), false, String(status));
  }
});

test('immutable poster quota counts the new version without subtracting the legacy asset', () => {
  const headroom = 32 * 1024 * 1024;
  const accountBytes = IMAGEKIT_STORAGE_LIMIT_BYTES - headroom - 512;
  assert.equal(hasImmutablePosterStorageCapacity(accountBytes, 1024), false);
  assert.equal(canStoreImmutableImageKitPoster(1024), false);
});

test('version cleanup always retains the currently pointed-to immutable asset', () => {
  const file = {
    filePath: '/poster-versions/tt1234567/' + 'a'.repeat(64) + '.jpg',
    createdAt: new Date(Date.now() - VERSIONED_POSTER_RETENTION_MS * 2).toISOString()
  };
  assert.equal(shouldDeleteUnpointedVersion(file, { activePaths: new Set([file.filePath]) }), false);
});

test('version cleanup retains all versions when pointer state is unknown', () => {
  const file = {
    filePath: '/poster-versions/tt1234567/' + 'b'.repeat(64) + '.jpg',
    createdAt: new Date(Date.now() - VERSIONED_POSTER_RETENTION_MS * 2).toISOString()
  };
  assert.equal(shouldDeleteUnpointedVersion(file, { unknownPointerIds: new Set(['tt1234567']) }), false);
});

test('version cleanup removes only unpointed versions older than retention', () => {
  const oldFile = {
    filePath: '/poster-versions/tt1234567/' + 'c'.repeat(64) + '.jpg',
    createdAt: new Date(Date.now() - VERSIONED_POSTER_RETENTION_MS - 1000).toISOString()
  };
  const recentFile = {
    ...oldFile, createdAt: new Date(Date.now() - 1000).toISOString()
  };
  assert.equal(shouldDeleteUnpointedVersion(oldFile), true);
  assert.equal(shouldDeleteUnpointedVersion(recentFile), false);
  assert.equal(shouldDeleteUnpointedVersion({ ...oldFile, filePath: '/posters/tt1234567.jpg' }), false);
});
