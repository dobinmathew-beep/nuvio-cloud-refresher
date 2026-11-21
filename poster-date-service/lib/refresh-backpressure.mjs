// A small promise-only queue: verification tasks retain IDs and status, never image buffers.
export function createBoundedTaskQueue(maxPending = 2) {
  if (!Number.isInteger(maxPending) || maxPending < 1) throw new RangeError('maxPending must be a positive integer');
  const pending = new Set();

  async function waitForCapacity() {
    while (pending.size >= maxPending) await Promise.race(pending);
  }

  async function enqueue(task) {
    if (typeof task !== 'function') throw new TypeError('task must be a function');
    await waitForCapacity();
    let tracked;
    tracked = Promise.resolve()
      .then(task)
      .then(value => ({ status: 'fulfilled', value }), error => ({ status: 'rejected', error }))
      .finally(() => pending.delete(tracked));
    pending.add(tracked);
    return tracked;
  }

  async function drain() {
    while (pending.size) await Promise.all([...pending]);
  }

  return {
    enqueue,
    drain,
    get pendingCount() { return pending.size; }
  };
}

// Image/OCR work remains serial. Only the lightweight, network-bound verifier
// is allowed limited concurrency, and that allowance contracts as RSS rises.
export function refreshResourcePolicy(rssMiB) {
  const rss = Number(rssMiB);
  if (!Number.isFinite(rss) || rss < 0) throw new RangeError('rssMiB must be a finite non-negative number');
  if (rss >= 450) return { pauseImageWork: true, verificationConcurrency: 1, maxPendingBatches: 1, runGc: true };
  if (rss >= 420) return { pauseImageWork: false, verificationConcurrency: 1, maxPendingBatches: 1, runGc: true };
  if (rss >= 380) return { pauseImageWork: false, verificationConcurrency: 1, maxPendingBatches: 2, runGc: true };
  if (rss >= 300) return { pauseImageWork: false, verificationConcurrency: 2, maxPendingBatches: 2, runGc: true };
  return { pauseImageWork: false, verificationConcurrency: 2, maxPendingBatches: 4, runGc: false };
}
