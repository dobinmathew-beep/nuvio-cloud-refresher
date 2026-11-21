import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoundedTaskQueue, refreshResourcePolicy } from '../lib/refresh-backpressure.mjs';

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

test('bounded queue never exceeds its configured pending task count', async () => {
  const queue = createBoundedTaskQueue(2);
  const a = deferred();
  const b = deferred();
  const c = deferred();
  const { completion: first } = await queue.enqueue(() => a.promise);
  const { completion: second } = await queue.enqueue(() => b.promise);
  assert.equal(queue.pendingCount, 2);
  let thirdStarted = false;
  const third = queue.enqueue(() => { thirdStarted = true; return c.promise; });
  await Promise.resolve();
  assert.equal(thirdStarted, false);
  a.resolve('a');
  await first;
  const { completion: thirdCompletion } = await third;
  assert.equal(thirdStarted, true);
  assert.equal(queue.pendingCount, 2);
  b.resolve('b');
  c.resolve('c');
  await queue.drain();
  await second;
  assert.equal(queue.pendingCount, 0);
});

test('queue captures task failures and continues draining', async () => {
  const queue = createBoundedTaskQueue(1);
  const { completion } = await queue.enqueue(() => { throw new Error('verify failed'); });
  const result = await completion;
  assert.equal(result.status, 'rejected');
  assert.match(result.error.message, /verify failed/);
  assert.equal(queue.pendingCount, 0);
});

test('resource policy keeps image work serial and throttles verifier as RSS rises', () => {
  assert.deepEqual(refreshResourcePolicy(200), {
    pauseImageWork: false, verificationConcurrency: 2, maxPendingBatches: 4, runGc: false
  });
  assert.equal(refreshResourcePolicy(320).verificationConcurrency, 2);
  assert.equal(refreshResourcePolicy(390).verificationConcurrency, 1);
  assert.equal(refreshResourcePolicy(430).maxPendingBatches, 1);
  assert.equal(refreshResourcePolicy(450).pauseImageWork, true);
  assert.throws(() => refreshResourcePolicy(NaN), /finite/);
});
