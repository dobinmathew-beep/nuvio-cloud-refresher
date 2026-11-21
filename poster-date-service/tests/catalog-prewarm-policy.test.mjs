import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyPrewarmResponse, isFreshVerifiedRecord, VERIFIED_ASSET_RECHECK_TTL_MS } from '../lib/catalog-prewarm-policy.mjs';

test('ImageKit redirects are deferred to asynchronous verification instead of repeating generation', () => {
  assert.deepEqual(classifyPrewarmResponse({
    status: 302, location: 'https://ik.imagekit.io/demo/posters/tt1234567.jpg',
    imageKitBase: 'https://ik.imagekit.io/demo/posters/'
  }), { status: 'upload-pending', verificationTimeoutMs: 20000, reason: 'imagekit-redirect' });
});

test('source-provider redirects are classified without another poster request', () => {
  assert.equal(classifyPrewarmResponse({
    status: 302, location: 'https://m.media-amazon.com/poster.jpg',
    imageKitBase: 'https://ik.imagekit.io/demo/posters/'
  }).status, 'source-redirect');
});

test('ambiguous 5xx outcomes are verified asynchronously, not regenerated immediately', () => {
  for (const status of [500, 502, 503, 504]) {
    const result = classifyPrewarmResponse({ status });
    assert.equal(result.status, 'upload-pending');
    assert.equal(result.verificationTimeoutMs, 20000);
  }
});

test('rate-limit and request-rejection responses are deferred to a later run', () => {
  for (const status of [408, 425, 429]) {
    assert.equal(classifyPrewarmResponse({ status }).status, 'retry');
  }
});

test('accepted uploads get a longer CDN visibility window', () => {
  assert.deepEqual(classifyPrewarmResponse({
    status: 200, contentType: 'image/jpeg', storage: 'pending'
  }), { status: 'upload-pending', verificationTimeoutMs: 90000, reason: 'imagekit-upload-pending' });
});

test('recent verified ledger records avoid redundant HEAD checks but expire for revalidation', () => {
  const now = Date.now();
  const fingerprint = 'same-poster';
  const record = { status: 'verified', fingerprint, verifiedAt: new Date(now - 1000).toISOString() };
  assert.equal(isFreshVerifiedRecord(record, fingerprint, now), true);
  assert.equal(isFreshVerifiedRecord(record, 'changed-poster', now), false);
  assert.equal(isFreshVerifiedRecord({
    ...record, verifiedAt: new Date(now - VERIFIED_ASSET_RECHECK_TTL_MS - 1000).toISOString()
  }, fingerprint, now), false);
  assert.equal(isFreshVerifiedRecord({ ...record, status: 'failed' }, fingerprint, now), false);
});
