import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chunkDurableQueue, validateDurableQueueChunk,
  persistDurableQueueSnapshot, loadDurableQueueSnapshot,
  initializeDurableQueueState, claimDurableQueueBatch,
  settleDurableQueueBatch, getDurableQueueState
} from '../lib/imagekit-durable-queue.mjs';
import { createHash } from 'node:crypto';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function mockImageKit(t) {
  const files = new Map();
  files.uploadCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.hostname === 'upload.imagekit.io') {
      files.uploadCount++;
      const form = init.body;
      const path = form.get('folder') + '/' + form.get('fileName');
      const file = form.get('file');
      files.set(path, await file.text());
      return new Response(JSON.stringify({ filePath: path }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    const path = url.pathname;
    if (!files.has(path)) return new Response('not found', { status: 404 });
    return new Response(files.get(path), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  return files;
}

test('durable queue chunks are bounded and preserve item order', () => {
  const items = Array.from({ length: 7 }, (_, index) => ({ id: 'tt' + index }));
  const chunks = chunkDurableQueue(items, 3);
  assert.deepEqual(chunks.map(chunk => chunk.length), [3, 3, 1]);
  assert.deepEqual(chunks.flat(), items);
});

test('durable queue accepts only chunks matching count and checksum', () => {
  const chunk = [{ id: 'tt1234567' }, { id: 'tt7654321' }];
  const expected = { count: 2, sha256: digest(chunk) };
  assert.equal(validateDurableQueueChunk(chunk, expected), true);
  assert.equal(validateDurableQueueChunk(chunk.slice(0, 1), expected), false);
  assert.equal(validateDurableQueueChunk([{ id: 'tt0000001' }, chunk[1]], expected), false);
  assert.equal(validateDurableQueueChunk(null, expected), false);
});

test('durable queue rejects invalid chunk sizes', () => {
  assert.throws(() => chunkDurableQueue([], 0), /between 1 and 500/);
  assert.throws(() => chunkDurableQueue([], 501), /between 1 and 500/);
});

test('ImageKit queue snapshot is immutable and reloads with checksum verification', async t => {
  mockImageKit(t);
  const config = { endpoint: 'https://ik.example.test', privateKey: 'test' };
  const items = [{ id: 'tt1234567', queueFingerprint: 'abc' }, { id: 'tt7654321', queueFingerprint: 'def' }];
  const manifest = await persistDurableQueueSnapshot(items, 'generation-a', { config, chunkSize: 1 });
  const loaded = await loadDurableQueueSnapshot('generation-a', { config });
  assert.equal(manifest.itemCount, 2);
  assert.deepEqual(loaded.items, items);
  const second = await persistDurableQueueSnapshot([{ id: 'tt9999999' }], 'generation-a', { config });
  assert.equal(second.itemCount, 2);
  assert.deepEqual((await loadDurableQueueSnapshot('generation-a', { config })).items, items);
});

test('claims are exclusive, acknowledged jobs stay completed, and expired claims recover', async t => {
  const files = mockImageKit(t);
  const config = { endpoint: 'https://ik.example.test', privateKey: 'test' };
  const generation = 'generation-claims';
  await initializeDurableQueueState(generation, ['tt1234567', 'tt7654321'], { config });
  const first = await claimDurableQueueBatch(generation, ['tt1234567'], 'worker-a', { config });
  assert.deepEqual(first, ['tt1234567']);
  assert.deepEqual(await claimDurableQueueBatch(generation, ['tt1234567'], 'worker-b', { config }), []);
  await settleDurableQueueBatch(generation, ['tt1234567'], 'worker-a', 'recorded', { config });
  const writesAfterFirstSettle = files.uploadCount;
  await settleDurableQueueBatch(generation, ['tt1234567'], 'worker-a', 'recorded', { config });
  assert.equal(files.uploadCount, writesAfterFirstSettle, 're-settling an already recorded item must not create a new ImageKit version');
  assert.deepEqual(await claimDurableQueueBatch(generation, ['tt1234567', 'tt7654321'], 'worker-b', { config }), ['tt7654321']);

  const statePath = [...files.keys()].find(path => path.endsWith('/queue-state.json'));
  const state = JSON.parse(files.get(statePath));
  state.items['tt7654321'].claimExpiresAt = new Date(Date.now() - 1000).toISOString();
  files.set(statePath, JSON.stringify(state));
  assert.deepEqual(await claimDurableQueueBatch(generation, ['tt7654321'], 'worker-c', { config }), ['tt7654321']);
  const summary = await getDurableQueueState(generation, { config });
  assert.equal(summary.total, 2);
  assert.equal(summary.counts.recorded, 1);
  assert.equal(summary.counts.claimed, 1);
});


test('reinitializing a durable queue preserves recorded and claimed work and rejects membership changes', async t => {
  mockImageKit(t);
  const config = { endpoint: 'https://ik.example.test', privateKey: 'test' };
  const generation = 'generation-preservation';
  const ids = ['tt1234567', 'tt7654321'];
  await initializeDurableQueueState(generation, ids, { config });
  await claimDurableQueueBatch(generation, ['tt1234567'], 'worker-a', { config });
  await settleDurableQueueBatch(generation, ['tt1234567'], 'worker-a', 'recorded', { config });
  await claimDurableQueueBatch(generation, ['tt7654321'], 'worker-b', { config });

  const before = await getDurableQueueState(generation, { config });
  await initializeDurableQueueState(generation, ids, { config });
  const after = await getDurableQueueState(generation, { config });
  assert.deepEqual(after.counts, before.counts);
  assert.equal(after.counts.recorded, 1);
  assert.equal(after.counts.claimed, 1);
  assert.equal(after.counts.queued, 0);
  await assert.rejects(
    initializeDurableQueueState(generation, ['tt1234567'], { config }),
    /membership differs from immutable manifest/
  );
  const finalState = await getDurableQueueState(generation, { config });
  assert.deepEqual(finalState.counts, after.counts);
});
