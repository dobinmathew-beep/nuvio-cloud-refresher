import test from 'node:test';
import assert from 'node:assert/strict';
import {
  IMAGEKIT_STORAGE_LIMIT_BYTES,
  imageKitConfig,
  getImageKitStorageSnapshot,
  canStoreImageKitPoster
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
