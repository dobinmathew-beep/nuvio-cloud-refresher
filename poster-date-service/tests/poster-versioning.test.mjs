import test from 'node:test';
import assert from 'node:assert/strict';
import {
  posterFingerprint, versionedPosterPath, isValidPosterPointer,
  publishVersionedPoster, resolvePosterAsset
} from '../lib/poster-versioning.mjs';

const imdbId = 'tt1234567';
const bytes = Buffer.from('poster-image-bytes');
const fingerprint = posterFingerprint(bytes);
const uploaded = {
  url: 'https://ik.imagekit.io/demo/poster-versions/tt1234567/' + fingerprint + '.jpg',
  fileId: 'file-version-1'
};
function adapter(overrides = {}) {
  const state = { pointer: null, pointerWrites: 0, ...overrides };
  return {
    state,
    legacyUrl: id => 'https://ik.imagekit.io/demo/posters/' + id + '.jpg',
    uploadImmutable: async () => uploaded,
    verifyAsset: async () => true,
    writePointer: async (id, value) => { state.pointer = value; state.pointerWrites++; },
    readPointer: async () => state.pointer
  };
}

test('fingerprints and immutable paths are deterministic', () => {
  assert.equal(posterFingerprint(bytes), fingerprint);
  assert.equal(versionedPosterPath(imdbId, fingerprint), '/poster-versions/' + imdbId + '/' + fingerprint + '.jpg');
  assert.throws(() => versionedPosterPath('bad-id', fingerprint), /Invalid IMDb/);
});

test('pointer validation rejects path traversal and mismatched IDs', () => {
  const valid = {
    version: 1, imdbId, fingerprint,
    assetPath: versionedPosterPath(imdbId, fingerprint),
    assetUrl: uploaded.url, contentType: 'image/jpeg',
    sizeBytes: bytes.length, uploadedAt: new Date().toISOString()
  };
  assert.equal(isValidPosterPointer(valid, imdbId), true);
  assert.equal(isValidPosterPointer({ ...valid, assetPath: '/posters/other.jpg' }, imdbId), false);
  assert.equal(isValidPosterPointer(valid, 'tt7654321'), false);
});

test('pointer is not switched unless immutable asset CDN verification passes', async () => {
  const store = adapter({ pointer: { version: 1, imdbId, marker: 'old' } });
  store.verifyAsset = async () => false;
  await assert.rejects(publishVersionedPoster(imdbId, { bytes, contentType: 'image/jpeg' }, store), /readback verification failed/);
  assert.deepEqual(store.state.pointer, { version: 1, imdbId, marker: 'old' });
  assert.equal(store.state.pointerWrites, 0);
});

test('successful publication switches pointer only after verified upload', async () => {
  const store = adapter();
  const events = [];
  store.uploadImmutable = async () => { events.push('upload'); return uploaded; };
  store.verifyAsset = async () => { events.push('verify'); return { ok: true }; };
  store.writePointer = async (id, value) => { events.push('pointer'); store.state.pointer = value; };
  const pointer = await publishVersionedPoster(imdbId, { bytes }, store);
  assert.deepEqual(events, ['upload', 'verify', 'pointer']);
  assert.equal(store.state.pointer.fingerprint, fingerprint);
  assert.equal(pointer.checksum, fingerprint);
});

test('missing pointer resolves to the stable legacy asset', async () => {
  const store = adapter();
  const result = await resolvePosterAsset(imdbId, store);
  assert.equal(result.source, 'legacy-invalid-pointer');
  assert.equal(result.url, store.legacyUrl(imdbId));
});

test('invalid pointer resolves to legacy without trusting its URL', async () => {
  const store = adapter({ pointer: { version: 1, imdbId, assetUrl: 'https://evil.invalid/a.jpg' } });
  const result = await resolvePosterAsset(imdbId, store);
  assert.equal(result.source, 'legacy-invalid-pointer');
  assert.equal(result.url, store.legacyUrl(imdbId));
});

test('verified pointer resolves to immutable asset', async () => {
  const store = adapter();
  await publishVersionedPoster(imdbId, { bytes }, store);
  const result = await resolvePosterAsset(imdbId, store);
  assert.equal(result.source, 'versioned');
  assert.equal(result.url, uploaded.url);
});

test('unavailable immutable version falls back to legacy', async () => {
  const store = adapter();
  await publishVersionedPoster(imdbId, { bytes }, store);
  store.verifyAsset = async () => false;
  const result = await resolvePosterAsset(imdbId, store);
  assert.equal(result.source, 'legacy-unverified-pointer');
  assert.equal(result.url, store.legacyUrl(imdbId));
});

test('fingerprint mismatch is rejected before upload', async () => {
  const store = adapter();
  await assert.rejects(publishVersionedPoster(imdbId, { bytes, fingerprint: 'a'.repeat(64) }, store), /does not match/);
  assert.equal(store.state.pointerWrites, 0);
});
