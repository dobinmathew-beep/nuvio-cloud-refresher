const INDEX_URL = String(process.env.CATALOG_ADDED_INDEX_URL || 'https://raw.githubusercontent.com/dobinmathew-beep/nuvio-cloud-refresher/dobins-catalog/dobins-indian-catalog/data/catalog-added.json').trim();
const INDEX_TTL_MS = 5 * 60 * 1000;
const ELIGIBILITY_MS = 14 * 24 * 60 * 60 * 1000;
let cachedIndex = null;
let cachedAt = 0;
let pendingIndex = null;
let cachedIds = null;

function buildIdIndex(value) {
  const index = new Map();
  for (const [key, timestamp] of Object.entries(value || {})) {
    const separator = key.lastIndexOf('|');
    const id = separator >= 0 ? key.slice(separator + 1) : key;
    if (!index.has(id)) index.set(id, []);
    index.get(id).push(timestamp);
  }
  return index;
}

async function loadIndex(fetcher) {
  if (cachedIndex && Date.now() - cachedAt < INDEX_TTL_MS) return cachedIndex;
  if (pendingIndex) return pendingIndex;
  pendingIndex = (async () => {
    try {
      const response = await fetcher(INDEX_URL, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(5000)
      });
      if (!response.ok) throw new Error('catalog-added index HTTP ' + response.status);
      const value = await response.json();
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('catalog-added index has an invalid shape');
      }
      cachedIndex = value;
      cachedIds = buildIdIndex(value);
      cachedAt = Date.now();
      return cachedIndex;
    } catch (error) {
      console.warn('[catalog-just-added-index-failed]', JSON.stringify({
        error: error?.message || 'unknown error',
        action: 'fall back to BetterPosters tag detection'
      }));
      cachedIndex = {};
      cachedIds = new Map();
      cachedAt = Date.now() - INDEX_TTL_MS + 60 * 1000;
      return null;
    } finally {
      pendingIndex = null;
    }
  })();
  return pendingIndex;
}

export async function isCatalogRecentlyAdded(ids, options = {}) {
  const values = new Set((Array.isArray(ids) ? ids : [ids])
    .map(value => String(value || '').trim())
    .filter(Boolean));
  if (!values.size) return false;
  const fetcher = options.fetch || globalThis.fetch;
  if (typeof fetcher !== 'function') return false;
  const index = await loadIndex(fetcher);
  if (!index) return false;
  const now = options.now instanceof Date ? options.now.getTime() : Number(options.now || Date.now());
  const idIndex = cachedIds || buildIdIndex(index);
  for (const id of values) {
    for (const rawTimestamp of idIndex.get(id) || []) {
      const addedAt = Date.parse(rawTimestamp);
      if (!Number.isFinite(addedAt)) continue;
      const age = now - addedAt;
      if (age >= 0 && age <= ELIGIBILITY_MS) return true;
    }
  }
  return false;
}

export function resetCatalogAddedIndexForTest() {
  cachedIndex = null;
  cachedIds = null;
  cachedAt = 0;
  pendingIndex = null;
}
