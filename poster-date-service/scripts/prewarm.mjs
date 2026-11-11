import { appendFile } from 'node:fs/promises';

const CATALOG_BASE = process.env.INDIANREGIONAL_CATALOG_BASE || 'https://83e20802dcf1-indian-streams.baby-beamup.club';
const POSTER_SERVICE = (process.env.POSTER_SERVICE_URL || 'https://great-indian-upcoming-posters.onrender.com').replace(/\/$/, '');
const IMAGEKIT_ENDPOINT = (process.env.IMAGEKIT_URL_ENDPOINT || 'https://ik.imagekit.io/dobin1994').replace(/\/$/, '');
const LANGUAGES = ['ml', 'ta', 'te', 'hi'];
const TYPES = ['movie', 'series'];
const PAGE_SIZE = 100;
const MAX_PAGES_PER_CATALOG = 20;
const CONCURRENCY = Math.max(1, Math.min(4, Number(process.env.PREWARM_CONCURRENCY || 2)));
const REQUEST_TIMEOUT_MS = 120_000;
const UPLOAD_WAIT_MS = 45_000;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function validImdbId(value) {
  return typeof value === 'string' && /^tt\d{7,10}$/.test(value);
}

async function request(url, options = {}, timeoutMs = 30_000) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'user-agent': 'TheGreatIndianAddon-PosterPrewarmer/1.0', ...(options.headers || {}) }
  });
  return response;
}

async function fetchJson(url) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await request(url, { headers: { accept: 'application/json' } }, 30_000);
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const data = await response.json();
      if (!data || !Array.isArray(data.metas)) throw new Error('Catalogue response has no metas array');
      return data;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleep(attempt * 1500);
    }
  }
  throw lastError;
}

async function collectCatalog(language, type) {
  const ids = new Set();
  let totalRecords = 0;
  let pagesRead = 0;
  for (let page = 0; page < MAX_PAGES_PER_CATALOG; page++) {
    const skip = page * PAGE_SIZE;
    const url = new URL(`${CATALOG_BASE}/catalog/${type}/${language}${type === 'series' ? '_series' : ''}.json`);
    if (skip) url.searchParams.set('skip', String(skip));
    const data = await fetchJson(url);
    pagesRead++;
    const metas = data.metas;
    totalRecords += metas.length;
    let added = 0;
    for (const meta of metas) {
      if (validImdbId(meta?.id)) {
        const before = ids.size;
        ids.add(meta.id);
        if (ids.size > before) added++;
      }
    }
    if (metas.length < PAGE_SIZE || added === 0) break;
  }
  return { key: language + '-' + type, ids: [...ids], totalRecords, pagesRead };
}

async function checkImageKit(imdbId) {
  const url = `${IMAGEKIT_ENDPOINT}/posters/${encodeURIComponent(imdbId)}.jpg`;
  try {
    const response = await request(url, { method: 'HEAD', redirect: 'follow' }, 10_000);
    return response.ok && (response.headers.get('content-type') || '').toLowerCase().startsWith('image/');
  } catch {
    return false;
  }
}

async function waitForImageKit(imdbId) {
  const deadline = Date.now() + UPLOAD_WAIT_MS;
  while (Date.now() < deadline) {
    if (await checkImageKit(imdbId)) return true;
    await sleep(2500);
  }
  return false;
}

async function prewarm(imdbId) {
  const url = `${POSTER_SERVICE}/poster/${encodeURIComponent(imdbId)}.jpg`;
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await request(url, { method: 'GET', redirect: 'manual', headers: { accept: 'image/*' } }, REQUEST_TIMEOUT_MS);
      if (response.status === 302 || response.status === 301) {
        const location = response.headers.get('location') || '';
        if (!location.startsWith(IMAGEKIT_ENDPOINT + '/posters/')) {
          throw new Error('Poster service fell back to the source provider instead of ImageKit');
        }
        const verified = await checkImageKit(imdbId);
        if (!verified) throw new Error('ImageKit redirect target did not pass its image HEAD check');
        return { id: imdbId, status: 'cdn-hit' };
      }
      if (!response.ok) throw new Error('Poster service HTTP ' + response.status);
      const type = (response.headers.get('content-type') || '').toLowerCase();
      if (!type.startsWith('image/')) throw new Error('Poster service returned a non-image response');
      const posterStatus = response.headers.get('x-poster-date-status') || 'unknown';
      const storageStatus = response.headers.get('x-imagekit-storage') || 'not-stored';
      await response.arrayBuffer();
      if (posterStatus !== 'upcoming-date-overlay') {
        return { id: imdbId, status: 'not-stored-no-active-overlay' };
      }
      if (storageStatus !== 'pending') {
        return { id: imdbId, status: 'not-stored-storage-guard' };
      }
      if (await waitForImageKit(imdbId)) return { id: imdbId, status: 'generated-and-cached' };
      throw new Error('Upcoming poster was rendered, but ImageKit upload was not visible within ' + (UPLOAD_WAIT_MS / 1000) + ' seconds');
    } catch (error) {
      lastError = error;
      if (attempt < 2) await sleep(3000);
    }
  }
  return { id: imdbId, status: 'failed', error: lastError?.message || 'Unknown error' };
}

async function runPool(items, worker, concurrency) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
      const done = index + 1;
      if (done % 25 === 0 || done === items.length) {
        console.log(`Progress: ${done}/${items.length}`);
      }
    }
  }));
  return results;
}

async function writeSummary(summary) {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path) return;
  const lines = [
    '# Great Indian poster pre-generation',
    '',
    `- Started: ${summary.startedAt}`,
    `- Finished: ${summary.finishedAt}`,
    `- Catalogues: ${summary.catalogues.length}`,
    `- Unique IMDb IDs: ${summary.totalIds}`,
    `- Processed successfully: ${summary.ready}`,
    `- ImageKit assets verified: ${summary.stored}`,
    `- Skipped to conserve storage: ${summary.skipped}`,
    `- Failed: ${summary.failed}`,
    '',
    '## Catalogue scan',
    '',
    '| Catalogue | Pages | Records | IMDb IDs |',
    '|---|---:|---:|---:|',
    ...summary.catalogues.map(c => `| ${c.key} | ${c.pagesRead} | ${c.totalRecords} | ${c.ids.length} |`),
    '',
    '## Failed IDs',
    '',
    ...(summary.failures.length ? summary.failures.map(x => `- ${x.id}: ${x.error}`) : ['None'])
  ];
  await appendFile(path, lines.join('\n') + '\n');
}

async function main() {
  const startedAt = new Date().toISOString();
  console.log('Starting The Great Indian poster pre-generation');
  console.log('Poster service:', POSTER_SERVICE);
  console.log('ImageKit endpoint:', IMAGEKIT_ENDPOINT);
  console.log('Concurrency:', CONCURRENCY);

  const catalogues = [];
  const catalogueResults = await Promise.all(
    LANGUAGES.flatMap(language => TYPES.map(type => collectCatalog(language, type)))
  );
  catalogues.push(...catalogueResults);

  const allIds = [...new Set(catalogues.flatMap(c => c.ids))].sort();
  if (!allIds.length) throw new Error('All eight catalogues returned zero valid IMDb IDs; refusing an empty successful run.');
  console.log('Unique IMDb IDs discovered:', allIds.length);

  const results = await runPool(allIds, prewarm, CONCURRENCY);
  const failures = results.filter(x => x.status === 'failed');
  const summary = {
    startedAt,
    finishedAt: new Date().toISOString(),
    catalogues,
    totalIds: allIds.length,
    ready: results.filter(x => x.status !== 'failed').length,
    stored: results.filter(x => x.status === 'generated-and-cached' || x.status === 'cdn-hit').length,
    skipped: results.filter(x => x.status.startsWith('not-stored')).length,
    failed: failures.length,
    failures
  };
  console.log(JSON.stringify(summary, null, 2));
  await writeSummary(summary);

  if (failures.length) {
    const ratio = failures.length / results.length;
    if (ratio > 0.10) throw new Error(`Pre-generation failed for ${failures.length}/${results.length} posters (>10%); check the summary and Render logs.`);
    console.warn(`Some posters failed: ${failures.length}/${results.length}. Successful assets remain available.`);
  }
}

main().catch(error => {
  console.error('Poster pre-generation failed:', error);
  process.exitCode = 1;
});
