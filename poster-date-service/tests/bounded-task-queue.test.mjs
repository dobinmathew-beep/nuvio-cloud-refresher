import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoundedTaskQueue } from '../lib/bounded-task-queue.mjs';

test('background queue bounds active tasks and drains accepted work', async () => {
  const queue = createBoundedTaskQueue({ concurrency: 2, maxQueued: 5 });
  let active = 0;
  let peak = 0;
  let completed = 0;
  const task = async () => {
    active++;
    peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 5));
    active--;
    completed++;
  };
  for (let i = 0; i < 7; i++) assert.equal(queue.enqueue('id-' + i, task), true);
  assert.equal(queue.enqueue('overflow', task), false);
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(peak, 2);
  assert.equal(completed, 7);
  assert.deepEqual(queue.stats(), { active: 0, queued: 0, pending: 0 });
});

test('background queue deduplicates IDs while queued or running', async () => {
  const queue = createBoundedTaskQueue({ concurrency: 1, maxQueued: 2 });
  let release;
  const blocker = new Promise(resolve => { release = resolve; });
  assert.equal(queue.enqueue('same', async () => blocker), true);
  assert.equal(queue.enqueue('same', async () => {}), false);
  release();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(queue.enqueue('same', async () => {}), true);
});

test('background queue reports task errors and continues draining', async () => {
  const errors = [];
  const queue = createBoundedTaskQueue({ concurrency: 1, onError: (error, key) => errors.push(key + ':' + error.message) });
  assert.equal(queue.enqueue('bad', async () => { throw new Error('failed'); }), true);
  assert.equal(queue.enqueue('good', async () => {}), true);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(errors, ['bad:failed']);
  assert.equal(queue.stats().pending, 0);
});
