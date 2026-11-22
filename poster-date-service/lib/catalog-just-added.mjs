const INDEX_URL = String(process.env.CATALOG_ADDED_INDEX_URL || 'https://raw.githubusercontent.com/dobinmathew-beep/nuvio-cloud-refresher/dobins-catalog/dobins-indian-catalog/data/catalog-added.json').trim();
const DIGITAL_RELEASE_AUDIT_URL = String(process.env.CATALOG_DIGITAL_RELEASE_AUDIT_URL || 'https://raw.githubusercontent.com/dobinmathew-beep/nuvio-cloud-refresher/dobins-catalog/dobins-indian-catalog/data/recent-release-audit.json').trim();
const INDEX_TTL_MS = 5 * 60 * 1000;
const ELIGIBILITY_MS = 14 * 24 * 60 * 60 * 1000;

let cachedIndex = null;
let cachedAt = 0;
let pendingIndex = null;
let cachedIds = null;
let unavailableUntil = 0;

let cachedDigitalAudit = null;
let cachedDigitalAt = 0;
let pendingDigitalAudit = null;
let cachedDigitalIds = null;
let digitalUnavailableUntil = 0;

function buildSeriesIdIndex(value) {
  const index = new Map();
  for (const [key, timestamp] of Object.entries(value || {})) {
    const separator = key.lastIndexOf('|');
    const catalogKey = separator >= 0 ? key.slice(0, separator) : '';
    if (!catalogKey.endsWith('_series')) continue;
    const id = separator >= 0 ? key.slice(separator + 1) : key;
    if (!index.has(id)) index.set(id, []);
    index.get(id).push(timestamp);
  }
  return index;
}

function buildDigitalReleaseIndex(value) {
  const index = new Map();
  const items = Array.isArray(value?.items) ? value.items : [];
  for (const item of items) {
    if (String(item?.type || '').toLowerCase() !== 'movie') continue;
    if (String(item?.matchState || '').toLowerCase() !== 'published') continue;
    const id = String(item?.id || '').trim();
    const releaseDate = String(item?.releaseDate || '').slice(0, 10);
    if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(releaseDate)) continue;
    if (!index.has(id)) index.set(id, []);
    index.get(id).push(releaseDate);
  }
  return index;
}

async function loadIndex(fetcher) {
  if (cachedIndex && Date.now() - cachedAt < INDEX_TTL_MS) return cachedIndex;
  if (Date.now() < unavailableUntil) return null;
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
      cachedIds = buildSeriesIdIndex(value);
      cachedAt = Date.now();
      unavailableUntil = 0;
      return cachedIndex;
    } catch (error) {
      console.warn('[catalog-just-added-index-failed]', JSON.stringify({
        error: error?.message || 'unknown error',
        action: 'series eligibility unavailable'
      }));
      cachedIndex = null;
      cachedIds = null;
      cachedAt = 0;
      unavailableUntil = Date.now() + 60 * 1000;
      return null;
    } finally {
      pendingIndex = null;
    }
  })();
  return pendingIndex;
}

async function loadDigitalReleaseAudit(fetcher) {
  if (cachedDigitalAudit && Date.now() - cachedDigitalAt < INDEX_TTL_MS) return cachedDigitalAudit;
  if (Date.now() < digitalUnavailableUntil) return null;
  if (pendingDigitalAudit) return pendingDigitalAudit;
  pendingDigitalAudit = (async () => {
    try {
      const response = await fetcher(DIGITAL_RELEASE_AUDIT_URL, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(5000)
      });
      if (!response.ok) throw new Error('recent digital release audit HTTP ' + response.status);
      const value = await response.json();
      if (!value || typeof value !== 'object' || !Array.isArray(value.items)) {
        throw new Error('recent digital release audit has an invalid shape');
      }
      cachedDigitalAudit = value;
      cachedDigitalIds = buildDigitalReleaseIndex(value);
      cachedDigitalAt = Date.now();
      digitalUnavailableUntil = 0;
      return cachedDigitalAudit;
    } catch (error) {
      console.warn('[catalog-digital-release-audit-failed]', JSON.stringify({
        error: error?.message || 'unknown error',
        action: 'movie eligibility unavailable'
      }));
      cachedDigitalAudit = null;
      cachedDigitalIds = null;
      cachedDigitalAt = 0;
      digitalUnavailableUntil = Date.now() + 60 * 1000;
      return null;
    } finally {
      pendingDigitalAudit = null;
    }
  })();
  return pendingDigitalAudit;
}

export async function isCatalogRecentlyAdded(ids, options = {}) {
  const values = new Set((Array.isArray(ids) ? ids : [ids])
    .map(value => String(value || '').trim())
    .filter(Boolean));
  if (!values.size) return false;
  const fetcher = options.fetch || globalThis.fetch;
  if (typeof fetcher !== 'function') return false;

  const [seriesIndex, digitalAudit] = await Promise.all([
    loadIndex(fetcher),
    loadDigitalReleaseAudit(fetcher)
  ]);
  if (!seriesIndex && !digitalAudit) return null;

  const now = options.now instanceof Date ? options.now.getTime() : Number(options.now || Date.now());
  const seriesIds = cachedIds || (seriesIndex ? buildSeriesIdIndex(seriesIndex) : null);
  const movieIds = cachedDigitalIds || (digitalAudit ? buildDigitalReleaseIndex(digitalAudit) : null);

  for (const id of values) {
    for (const rawTimestamp of seriesIds?.get(id) || []) {
      const addedAt = Date.parse(rawTimestamp);
      if (!Number.isFinite(addedAt)) continue;
      const age = now - addedAt;
      if (age >= 0 && age <= ELIGIBILITY_MS) return true;
    }
    for (const rawDate of movieIds?.get(id) || []) {
      const releasedAt = Date.parse(rawDate + 'T00:00:00Z');
      if (!Number.isFinite(releasedAt)) continue;
      const age = now - releasedAt;
      if (age >= 0 && age <= ELIGIBILITY_MS) return true;
    }
  }

  // A negative decision is authoritative only when both series first-seen
  // history and movie digital-release data were successfully read.
  return seriesIndex && digitalAudit ? false : null;
}

export function resetCatalogAddedIndexForTest() {
  cachedIndex = null;
  cachedAt = 0;
  pendingIndex = null;
  cachedIds = null;
  unavailableUntil = 0;
  cachedDigitalAudit = null;
  cachedDigitalAt = 0;
  pendingDigitalAudit = null;
  cachedDigitalIds = null;
  digitalUnavailableUntil = 0;
}
