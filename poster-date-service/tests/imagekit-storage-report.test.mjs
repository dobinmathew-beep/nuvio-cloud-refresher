import test from 'node:test';
import assert from 'node:assert/strict';
import { buildImageKitDeletionReport } from '../lib/imagekit-storage.mjs';

test('storage report is read-only and reports empty inventory safely', async () => {
  const oldEndpoint = process.env.IMAGEKIT_URL_ENDPOINT;
  const oldKey = process.env.IMAGEKIT_PRIVATE_KEY;
  const oldFetch = globalThis.fetch;
  const calls = [];
  process.env.IMAGEKIT_URL_ENDPOINT = 'https://ik.imagekit.io/testaccount';
  process.env.IMAGEKIT_PRIVATE_KEY = 'test-private-key';
  globalThis.fetch = async (input, options = {}) => {
    const url = String(input);
    calls.push({ url, method: options.method || 'GET' });
    const body = url.includes('/accounts/usage')
      ? JSON.stringify({ mediaLibraryStorageBytes: 1234 })
      : '[]';
    return new Response(body, {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };
  try {
    const report = await buildImageKitDeletionReport();
    assert.equal(report.mode, 'read-only-dry-run');
    assert.equal(report.deletionEnabled, false);
    assert.equal(report.accountFileCount, 0);
    assert.equal(report.accountBytes, 1234);
    assert.equal(report.accountBytesSource, 'imagekit-account-usage-api');
    assert.equal(report.candidateCount, 0);
    assert.equal(report.candidateBytes, 0);
    assert.ok(calls.length >= 2);
    assert.ok(calls.every(call => call.method !== 'DELETE'));
  } finally {
    globalThis.fetch = oldFetch;
    if (oldEndpoint === undefined) delete process.env.IMAGEKIT_URL_ENDPOINT;
    else process.env.IMAGEKIT_URL_ENDPOINT = oldEndpoint;
    if (oldKey === undefined) delete process.env.IMAGEKIT_PRIVATE_KEY;
    else process.env.IMAGEKIT_PRIVATE_KEY = oldKey;
  }
});
