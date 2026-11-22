import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createImageKitPosterAdapter } from '../lib/imagekit-versioned-storage.mjs';

const config = { endpoint: 'https://ik.imagekit.io/demo', privateKey: 'test-key' };
const bytes = Buffer.from('immutable-poster-bytes');
const fingerprint = createHash('sha256').update(bytes).digest('hex');
const assetPath = '/poster-versions/tt1234567/' + fingerprint + '.jpg';

test('immutable upload uses a content-addressed path and disables overwrite', async () => {
  let uploadForm;
  const calls = [];
  const adapter = createImageKitPosterAdapter({
    config,
    canStore: size => size < 1000,
    recordUpload: (...args) => calls.push(args),
    fetchImpl: async (url, options = {}) => {
      if (String(url).startsWith('https://api.imagekit.io/v1/files?')) return new Response('[]', { status: 200 });
      if (String(url) === 'https://upload.imagekit.io/api/v1/files/upload') {
        uploadForm = options.body;
        return Response.json({
          url: config.endpoint + assetPath,
          fileId: 'immutable-file-1'
        });
      }
      throw new Error('Unexpected request: ' + url);
    }
  });
  const uploaded = await adapter.uploadImmutable({
    imdbId: 'tt1234567', fingerprint, assetPath, bytes, contentType: 'image/jpeg'
  });
  assert.equal(uploadForm.get('overwriteFile'), 'false');
  assert.equal(uploadForm.get('useUniqueFileName'), 'false');
  assert.equal(uploaded.fileId, 'immutable-file-1');
  assert.deepEqual(calls[0], [assetPath, 'immutable-file-1', bytes.length]);
});

test('immutable upload fails closed when quota headroom is unavailable', async () => {
  let requests = 0;
  const adapter = createImageKitPosterAdapter({
    config, canStore: () => false,
    fetchImpl: async () => { requests++; throw new Error('must not request'); }
  });
  await assert.rejects(adapter.uploadImmutable({
    imdbId: 'tt1234567', fingerprint, assetPath, bytes, contentType: 'image/jpeg'
  }), /storage safety ceiling/);
  assert.equal(requests, 0);
});

test('CDN verification rejects non-ImageKit origins before making a request', async () => {
  let requests = 0;
  const adapter = createImageKitPosterAdapter({
    config,
    fetchImpl: async () => { requests++; throw new Error('must not request'); }
  });
  const ok = await adapter.verifyAsset({
    url: 'https://evil.example/poster-versions/tt1234567/' + fingerprint + '.jpg',
    expectedBytes: bytes.length, expectedContentType: 'image/jpeg', fingerprint
  });
  assert.equal(ok, false);
  assert.equal(requests, 0);
});

test('CDN verification checks content type, byte count and SHA-256 readback', async () => {
  const adapter = createImageKitPosterAdapter({
    config,
    fetchImpl: async () => new Response(bytes, {
      status: 200, headers: { 'content-type': 'image/jpeg' }
    })
  });
  const ok = await adapter.verifyAsset({
    url: config.endpoint + assetPath,
    expectedBytes: bytes.length, expectedContentType: 'image/jpeg', fingerprint
  });
  assert.equal(ok, true);
});

test('existing verified immutable asset is reused even when quota is full', async () => {
  let uploads = 0;
  const adapter = createImageKitPosterAdapter({
    config, canStore: () => false,
    fetchImpl: async (url, options = {}) => {
      if (String(url).startsWith('https://api.imagekit.io/v1/files?')) {
        return Response.json([{
          name: fingerprint + '.jpg',
          filePath: assetPath,
          fileId: 'existing-immutable-file',
          size: bytes.length,
          mime: 'image/jpeg'
        }]);
      }
      if (String(url).startsWith(config.endpoint + assetPath)) {
        return new Response(bytes, { status: 200, headers: { 'content-type': 'image/jpeg' } });
      }
      if (String(url) === 'https://upload.imagekit.io/api/v1/files/upload') uploads++;
      throw new Error('Unexpected request: ' + url);
    }
  });
  const result = await adapter.uploadImmutable({
    imdbId: 'tt1234567', fingerprint, assetPath, bytes, contentType: 'image/jpeg'
  });
  assert.equal(result.fileId, 'existing-immutable-file');
  assert.equal(uploads, 0);
});
