import test from 'node:test';
import assert from 'node:assert/strict';
import { createSerialQueue } from '../lib/serial-queue.mjs';

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

test('worker termination waits until an in-flight OCR operation completes', async () => {
  const queue = createSerialQueue();
  const recognitionStarted = deferred();
  const allowRecognitionToFinish = deferred();
  const order = [];

  const recognition = queue.run(async () => {
    order.push('setParameters');
    recognitionStarted.resolve();
    await allowRecognitionToFinish.promise;
    order.push('recognize');
  });

  await recognitionStarted.promise;
  const termination = queue.run(async () => {
    order.push('terminate');
  });

  // Give the queued termination a chance to run if FIFO serialization breaks.
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(order, ['setParameters']);

  allowRecognitionToFinish.resolve();
  await Promise.all([recognition, termination]);
  assert.deepEqual(order, ['setParameters', 'recognize', 'terminate']);
});

test('a failed OCR operation does not block later worker cleanup', async () => {
  const queue = createSerialQueue();
  const failed = queue.run(async () => { throw new Error('simulated OCR failure'); });
  const cleanup = queue.run(async () => 'cleanup completed');

  await assert.rejects(failed, /simulated OCR failure/);
  assert.equal(await cleanup, 'cleanup completed');
});

test('multiple lifecycle operations run in FIFO order without overlap', async () => {
  const queue = createSerialQueue();
  const order = [];
  await Promise.all([
    queue.run(async () => { order.push('recognition-1-start'); await Promise.resolve(); order.push('recognition-1-end'); }),
    queue.run(async () => { order.push('cleanup'); }),
    queue.run(async () => { order.push('recognition-2'); })
  ]);
  assert.deepEqual(order, ['recognition-1-start', 'recognition-1-end', 'cleanup', 'recognition-2']);
});
