import { getTodayInTimeZone } from './release-dates.mjs';

const INDEX_URL = 'https://raw.githubusercontent.com/dobinmathew-beep/nuvio-cloud-refresher/dobins-catalog/dobins-indian-catalog/data/upcoming.json';
const INDEX_TTL_MS = 5 * 60 * 1000;
let cachedIndex = null;
let cachedAt = 0;
let pendingIndex = null;
let cachedAliasIndex = null;

function buildAliasIndex(items) {
  const index = new Map();
  for (const item of items) {
    const aliases = [item?.id, ...(Array.isArray(item?.aliases) ? item.aliases : [])]
      .map(value => String(value || '').trim()).filter(Boolean);
    for (const alias of aliases) {
      if (!index.has(alias)) index.set(alias, []);
      index.get(alias).push(item);
    }
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
      if (!response.ok) throw new Error('upcoming index HTTP ' + response.status);
      const payload = await response.json();
      const items = Array.isArray(payload?.items) ? payload.items : null;
      if (!items) throw new Error('upcoming index has an invalid shape');
      cachedIndex = items;
      cachedAliasIndex = buildAliasIndex(items);
      cachedAt = Date.now();
      return cachedIndex;
    } catch (error) {
      console.warn('[catalog-upcoming-index-failed]', JSON.stringify({
        error: error?.message || 'unknown error',
        action: 'fall back to TMDB/TVmaze release lookup'
      }));
      cachedIndex = [];
      cachedAliasIndex = new Map();
      cachedAt = Date.now() - INDEX_TTL_MS + 60 * 1000;
      return cachedIndex;
    } finally {
      pendingIndex = null;
    }
  })();
  return pendingIndex;
}

export async function upcomingReleaseFromCatalog(ids, options = {}) {
  const values = new Set((Array.isArray(ids) ? ids : [ids])
    .map(value => String(value || '').trim())
    .filter(Boolean));
  if (!values.size) return null;
  const fetcher = options.fetch || globalThis.fetch;
  if (typeof fetcher !== 'function') return null;
  await loadIndex(fetcher);
  const aliasIndex = cachedAliasIndex || new Map();
  const today = options.today || getTodayInTimeZone(options.now || new Date());
  const matches = [];
  const matchedItems = new Set();
  for (const value of values) for (const item of aliasIndex.get(value) || []) matchedItems.add(item);
  for (const item of matchedItems) {
    const date = String(item?.releaseDate || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date <= today) continue;
    matches.push({
      date,
      region: item.region || 'IN',
      source: item.source || 'great-indian-catalog-upcoming-index',
      kind: item.kind || (item.type === 'series' ? 'episode' : 'premiere'),
      catalog: item.catalog || null
    });
  }
  matches.sort((a, b) => a.date.localeCompare(b.date));
  return matches[0] || null;
}

export function resetCatalogUpcomingIndexForTest() {
  cachedIndex = null;
  cachedAliasIndex = null;
  cachedAt = 0;
  pendingIndex = null;
}
