import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyPrewarmResponse, isFreshVerifiedRecord, isSourceProbeCoolingDown, isSourceUnavailableCoolingDown, SOURCE_PROBE_RETRY_COOLDOWN_MS, SOURCE_UNAVAILABLE_COOLDOWN_MS, VERIFIED_ASSET_RECHECK_TTL_MS, needsResumeVerification } from '../lib/catalog-prewarm-policy.mjs';

test('ImageKit redirects are deferred to asynchronous verification instead of repeating generation', () => {
  assert.deepEqual(classifyPrewarmResponse({
    status: 302, location: 'https://ik.imagekit.io/demo/posters/tt1234567.jpg',
    imageKitBase: 'https://ik.imagekit.io/demo/posters/', storage: 'pending'
  }), { status: 'upload-pending', verificationTimeoutMs: 150000, reason: 'imagekit-upload-pending' });
  assert.deepEqual(classifyPrewarmResponse({
    status: 302, location: 'https://ik.imagekit.io/demo/posters/tt1234567.jpg',
    imageKitBase: 'https://ik.imagekit.io/demo/posters/', storage: 'stored'
  }), { status: 'upload-pending', verificationTimeoutMs: 20000, reason: 'imagekit-redirect' });
});

test('source-provider redirects are classified without another poster request', () => {
  assert.equal(classifyPrewarmResponse({
    status: 302, location: 'https://m.media-amazon.com/poster.jpg',
    imageKitBase: 'https://ik.imagekit.io/demo/posters/'
  }).status, 'source-redirect');
});

test('transient 5xx outcomes are deferred without pointless ImageKit polling', () => {
  for (const status of [500, 502, 503, 504]) {
    const result = classifyPrewarmResponse({ status });
    assert.equal(result.status, 'source-probe-failed');
    assert.equal(result.cooldownMs, SOURCE_PROBE_RETRY_COOLDOWN_MS);
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
  }), { status: 'upload-pending', verificationTimeoutMs: 150000, reason: 'imagekit-upload-pending' });
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

test('interrupted upload-pending records require a HEAD check before regeneration', () => {
  assert.equal(needsResumeVerification({ status: 'upload-pending', fingerprint: 'f' }, 'f'), true);
  assert.equal(needsResumeVerification({ status: 'upload-pending', fingerprint: 'other' }, 'f'), false);
});


test('explicit no-poster-source 503 responses are terminal for this pass, not upload-pending', () => {
  const result = classifyPrewarmResponse({
    status: 503,
    fallbackReason: 'No poster provider returned a usable image for tt1234567 (BetterPosters: HTTP 404)'
  });
  assert.deepEqual(result, {
    status: 'source-unavailable',
    cooldownMs: SOURCE_UNAVAILABLE_COOLDOWN_MS,
    reason: 'definitive-no-poster-source'
  });
  assert.equal(classifyPrewarmResponse({ status: 503 }).status, 'source-probe-failed');
});

test('source-unavailable records are skipped until their cooldown expires', () => {
  const now = Date.now();
  const record = {
    status: 'source-unavailable',
    fingerprint: 'poster-v1',
    retryAfter: new Date(now + 60_000).toISOString()
  };
  assert.equal(isSourceUnavailableCoolingDown(record, 'poster-v1', now), true);
  assert.equal(isSourceUnavailableCoolingDown(record, 'changed-poster', now), false);
  assert.equal(isSourceUnavailableCoolingDown({
    ...record, retryAfter: new Date(now - 1).toISOString()
  }, 'poster-v1', now), false);
  assert.equal(isSourceUnavailableCoolingDown({
    ...record, status: 'failed'
  }, 'poster-v1', now), false);
});



test('transient poster-service 5xx responses defer source probing, not ImageKit verification', () => {
  assert.deepEqual(classifyPrewarmResponse({
    status: 503,
    fallbackReason: 'TMDB request failed: upstream timeout'
  }), {
    status: 'source-probe-failed',
    cooldownMs: SOURCE_PROBE_RETRY_COOLDOWN_MS,
    reason: 'poster-service-transient-error'
  });
  assert.equal(classifyPrewarmResponse({ status: 502 }).status, 'source-probe-failed');
});

test('source-probe failures are skipped only while their short cooldown is active', () => {
  const now = Date.now();
  const record = {
    status: 'source-probe-failed',
    fingerprint: 'poster-v1',
    retryAfter: new Date(now + 60_000).toISOString()
  };
  assert.equal(isSourceProbeCoolingDown(record, 'poster-v1', now), true);
  assert.equal(isSourceProbeCoolingDown(record, 'other', now), false);
  assert.equal(isSourceProbeCoolingDown({
    ...record, retryAfter: new Date(now - 1).toISOString()
  }, 'poster-v1', now), false);
});
