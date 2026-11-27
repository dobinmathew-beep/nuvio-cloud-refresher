// Small per-process cooldown gate for expensive background work.
// It bounds repeat origin downloads when downstream storage is unavailable.
export function createBackgroundBuildGate({ ttlMs = 30 * 60 * 1000, maxEntries = 2048, now = () => Date.now() } = {}) {
  if (!Number.isFinite(ttlMs) || ttlMs < 0) throw new TypeError('ttlMs must be a non-negative number');
  if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new TypeError('maxEntries must be a positive integer');
  const lastStarted = new Map();
  return function allow(key) {
    const id = String(key || '').trim();
    if (!id) return false;
    const current = Number(now());
    const previous = lastStarted.get(id);
    if (Number.isFinite(previous) && current - previous < ttlMs) return false;
    lastStarted.set(id, current);
    while (lastStarted.size > maxEntries) lastStarted.delete(lastStarted.keys().next().value);
    return true;
  };
}
