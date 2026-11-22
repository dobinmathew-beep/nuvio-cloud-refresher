import test from 'node:test';
import assert from 'node:assert/strict';
import { chunkDurableQueue, validateDurableQueueChunk } from '../lib/imagekit-durable-queue.mjs';
import { createHash } from 'node:crypto';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

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
