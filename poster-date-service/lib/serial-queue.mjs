// A tiny FIFO queue for operations that must not overlap a shared resource lifecycle.
export function createSerialQueue() {
  let tail = Promise.resolve();
  return {
    run(task) {
      const result = tail.then(task);
      // Keep the queue usable after a rejected task while preserving the
      // rejection for the caller that submitted it.
      tail = result.then(() => undefined, () => undefined);
      return result;
    }
  };
}
