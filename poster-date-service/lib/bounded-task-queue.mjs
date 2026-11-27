// Bound background poster work so a burst of catalogue requests cannot
// retain hundreds of source-image buffers or overwhelm the small Render instance.
export function createBoundedTaskQueue({ concurrency = 2, maxQueued = 4096, onError = () => {} } = {}) {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new TypeError('concurrency must be a positive integer');
  if (!Number.isInteger(maxQueued) || maxQueued < 0) throw new TypeError('maxQueued must be a non-negative integer');
  const queue = [];
  const pending = new Set();
  let active = 0;

  function drain() {
    while (active < concurrency && queue.length) {
      const item = queue.shift();
      active++;
      Promise.resolve().then(item.task)
        .catch(error => {
          try { onError(error, item.key); } catch {}
        })
        .finally(() => {
          active--;
          pending.delete(item.key);
          drain();
        });
    }
  }

  return {
    enqueue(key, task) {
      const id = String(key || '').trim();
      if (!id || typeof task !== 'function' || pending.has(id)) return false;
      if (active >= concurrency && queue.length >= maxQueued) return false;
      pending.add(id);
      queue.push({ key: id, task });
      drain();
      return true;
    },
    stats() {
      return { active, queued: queue.length, pending: pending.size };
    }
  };
}
