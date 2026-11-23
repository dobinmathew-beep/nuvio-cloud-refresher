import { collectIncrementalCatalogues } from '../lib/catalog-manifest-refresh.mjs';

const keys = [
  'CATALOG_MANIFEST_ELFHOSTED_URL',
  'CATALOG_MANIFEST_MIDNIGHTIGNITE_URL',
  'CATALOG_MANIFEST_XPERIENCE_URL'
];
const timeout = 20000;

async function fetchJson(url) {
  const maxAttempts = 3;
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { accept: 'application/json', 'user-agent': 'GreatIndianReadOnlyManifestAudit/1.0' },
        signal: AbortSignal.timeout(timeout)
      });
      if (!response.ok) {
        const error = new Error('HTTP ' + response.status + ' while reading ' + new URL(url).host);
        // Retry only transient throttling/server responses; permanent 4xx errors
        // should fail quickly and remain visible to the workflow.
        if (response.status !== 429 && response.status < 500) throw error;
        const retryAfter = Number(response.headers.get('retry-after'));
        const delay = Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter * 1000, 10000)
          : 500 * (2 ** (attempt - 1));
        throw Object.assign(error, { retryable: true, delay });
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      const retryable = error?.retryable === true ||
        error?.name === 'TimeoutError' || error?.name === 'AbortError' ||
        error?.cause?.code === 'ECONNRESET' || error?.cause?.code === 'ETIMEDOUT' ||
        error?.cause?.code === 'EAI_AGAIN' || error?.cause?.code === 'ECONNREFUSED';
      if (!retryable || attempt === maxAttempts) break;
      const delay = error.delay || 500 * (2 ** (attempt - 1));
      console.warn('[manifest-read-retry]', JSON.stringify({
        host: new URL(url).host, attempt, nextAttempt: attempt + 1, delayMs: delay,
        reason: error?.message || 'transient fetch failure'
      }));
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

function baseFromManifestUrl(value) {
  const url = new URL(value);
  url.pathname = url.pathname.replace(/\/manifest\.json$/i, '');
  url.search = '';
  url.hash = '';
  return url.origin + url.pathname.replace(/\/$/, '');
}

const missing = keys.filter(key => !String(process.env[key] || '').trim());
if (missing.length) {
  console.log(JSON.stringify({
    status: 'skipped',
    reason: 'Add the three manifest URL values as GitHub Actions secrets to enable the live read-only scan',
    missingSecrets: missing
  }));
  process.exit(0);
}

const manifests = [];
for (const key of keys) {
  const url = String(process.env[key] || '').trim();
  const document = await fetchJson(url);
  if (!Array.isArray(document.catalogs) || document.catalogs.length === 0) {
    throw new Error(key + ' returned no catalogue definitions');
  }
  manifests.push({
    key,
    name: String(document.name || key.replace('CATALOG_MANIFEST_', '').replace('_URL', '')),
    base: baseFromManifestUrl(url),
    catalogs: document.catalogs.filter(catalog => catalog && catalog.type && catalog.id).map(catalog => ({
      type: String(catalog.type),
      id: String(catalog.id),
      name: String(catalog.name || catalog.id),
      extra: Array.isArray(catalog.extra) ? catalog.extra : [],
      required: Array.isArray(catalog.extraRequired) ? catalog.extraRequired : []
    }))
  });
}

const result = await collectIncrementalCatalogues(manifests, {
  baselineIds: new Set(),
  pageLimit: 1,
  maxCatalogues: 1000,
  fetchPage: async (manifest, catalog, skip) => {
    const url = new URL(
      manifest.base + '/catalog/' + encodeURIComponent(catalog.type) + '/' +
      encodeURIComponent(catalog.id) + '.json'
    );
    if (skip) url.searchParams.set('skip', String(skip));
    for (const requirement of catalog.required) {
      const name = typeof requirement === 'string' ? requirement : String(requirement?.name || '');
      if (!name || name === 'skip') continue;
      const descriptor = catalog.extra.find(item => item && typeof item === 'object' && item.name === name);
      const options = Array.isArray(descriptor?.options) ? descriptor.options
        : Array.isArray(requirement?.options) ? requirement.options : [];
      if (options.length) url.searchParams.set(name, String(options[0]));
    }
    return fetchJson(url);
  }
});

const sourcesScanned = new Set(result.sourceStats.filter(source => source.catalogues > 0).map(source => source.source));
if (sourcesScanned.size !== 3 || result.pagesFetched < 3) {
  throw new Error('Read-only manifest scan did not fetch at least one static catalogue from each of the three sources');
}
console.log(JSON.stringify({
  status: 'passed',
  mode: 'read-only',
  sources: manifests.map(manifest => ({
    name: manifest.name,
    catalogueDefinitions: manifest.catalogs.length,
    scannedCatalogues: result.sourceStats.find(source => source.source === manifest.name)?.catalogues || 0,
    skippedDynamicCatalogues: result.sourceStats.find(source => source.source === manifest.name)?.skippedDynamic || 0
  })),
  pagesFetched: result.pagesFetched,
  recordsFetched: result.recordsFetched,
  uniqueSupportedIds: result.observed.length,
  imagekitWrites: 0,
  posterRequests: 0
}));
