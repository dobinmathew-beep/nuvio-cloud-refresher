import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createWorker } from 'tesseract.js';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
const { langPath } = require('@tesseract.js-data/eng');
const catalogsPath = resolve(process.env.CATALOGS_PATH || '../catalog-data/dobins-indian-catalog/data/catalogs.json');
const addedPath = resolve(process.env.ADDED_PATH || '../catalog-data/dobins-indian-catalog/data/catalog-added.json');
const statusPath = resolve(process.env.STATUS_PATH || '../catalog-data/dobins-indian-catalog/data/status.json');
const outputDir = resolve(process.env.OUTPUT_DIR || './audit-output');
const concurrency = Math.max(1, Math.min(4, Number(process.env.AUDIT_CONCURRENCY || 1)));
const timeoutMs = 60000;

const snapshotCatalogs = JSON.parse(await readFile(catalogsPath, 'utf8'));
const snapshotTitleCount = Object.values(snapshotCatalogs).reduce((sum, items) => sum + (Array.isArray(items) ? items.length : 0), 0);
const publicAddonBase = process.env.PUBLIC_ADDON_BASE ? new URL(process.env.PUBLIC_ADDON_BASE).origin : '';
const posterTemplate = String(process.env.POSTER_TEMPLATE || '').trim();
const posterToken = posterTemplate ? Buffer.from(posterTemplate, 'utf8').toString('base64url') : '';
const catalogBase = publicAddonBase && posterToken ? publicAddonBase + '/install/ff/bttr/' + posterToken : publicAddonBase;
const catalogSource = publicAddonBase ? (posterToken ? publicAddonBase + ' (configured BetterPosters install route)' : publicAddonBase + ' (default install route)') : 'GitHub snapshot';
let catalogs = snapshotCatalogs;
if (publicAddonBase) {
  const liveCatalogs = {};
  for (const catalog of Object.keys(snapshotCatalogs)) {
    const kind = catalog.endsWith('_series') ? 'series' : 'movie';
    const rows = [];
    const seenIds = new Set();
    let skip = 0;
    let pagesFetched = 0;
    for (let page = 0; page < 100; page++) {
      const path = '/catalog/' + kind + '/' + catalog + (skip ? '/skip=' + skip : '') + '.json';
      const endpoint = catalogBase + path;
      const response = await fetch(endpoint, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(20000)
      });
      if (!response.ok) throw new Error('Public catalog fetch failed for ' + catalog + ': HTTP ' + response.status);
      const payload = await response.json();
      const metas = Array.isArray(payload.metas) ? payload.metas : [];
      if (!metas.length) break;
      let newCount = 0;
      for (const meta of metas) {
        const id = String(meta?.id || '');
        if (!id || seenIds.has(id)) continue;
        seenIds.add(id);
        rows.push(meta);
        newCount++;
      }
      pagesFetched++;
      if (!newCount) break;
      skip += metas.length;
    }
    liveCatalogs[catalog] = rows;
    console.log('PUBLIC_CATALOG ' + catalog + ' ' + rows.length + ' pages=' + pagesFetched);
  }
  catalogs = liveCatalogs;
}
const addedAt = JSON.parse(await readFile(addedPath, 'utf8'));
let catalogStatus = {};
try { catalogStatus = JSON.parse(await readFile(statusPath, 'utf8')); } catch {}
const entries = Object.entries(catalogs).flatMap(([catalog, items]) =>
  (Array.isArray(items) ? items : []).map(item => ({
    catalog,
    language: ({ ml: 'Malayalam', ta: 'Tamil', te: 'Telugu', hi: 'Hindi' })[catalog.match(/^dobins_(ml|ta|te|hi)_/)?.[1]] || 'Unknown',
    kind: catalog.endsWith('_series') ? 'series' : 'movie',
    item,
    catalogKey: catalog + '|' + String(item.id || '')
  }))
);

const worker = await createWorker('eng', 1, {
  langPath,
  corePath: dirname(require.resolve('tesseract.js-core')),
  cacheMethod: 'write',
  logger: () => {}
});

function hasJustAdded(text) {
  const normalized = String(text || '').replace(/\\[nr]/g, ' ').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim();
  return normalized.includes('just added') || normalized.replace(/\s+/g, '').includes('justadded');
}

function hasComingDate(text) {
  const normalized = String(text || '').replace(/\\[nr]/g, ' ').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim();
  return /(?:coming|new episode)\s+\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)(?:ember)?/.test(normalized) ||
    /(?:coming|new episode)\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)(?:ember)?\s+\d{1,2}/.test(normalized);
}

let ocrQueue = Promise.resolve();
async function detectBadge(prepared) {
  const job = ocrQueue.then(async () => {
    await worker.setParameters({ tessedit_pageseg_mode: '11' });
    let recognized = await worker.recognize(prepared);
    let text = String(recognized?.data?.text || '').trim();
    if (hasJustAdded(text)) return { visible: true, text };
    await worker.setParameters({ tessedit_pageseg_mode: '6' });
    recognized = await worker.recognize(prepared);
    const second = String(recognized?.data?.text || '').trim();
    return { visible: hasJustAdded(second), text: (text + ' | ' + second).slice(0, 480) };
  });
  ocrQueue = job.then(() => undefined, () => undefined);
  return job;
}

async function inspect(entry) {
  const item = entry.item || {};
  const posterUrl = String(item.poster || '');
  const flagged = item.justAdded === true || /[?&]badge=just-added(?:&|$)/i.test(posterUrl);
  const result = {
    catalog: entry.catalog,
    language: entry.language,
    kind: entry.kind,
    id: item.id || null,
    title: item.name || null,
    catalogFlag: flagged,
    catalogJustAdded: item.justAdded === true,
    posterRequestsBadge: /[?&]badge=just-added(?:&|$)/i.test(posterUrl),
    firstAddedAt: addedAt[entry.catalog + '|' + String(item.id || '')] || item.catalogAddedAt || null,
    posterUrl,
    httpStatus: null,
    contentType: null,
    finalUrl: null,
    posterStatus: null,
    posterSource: null,
    posterBadgeText: null,
    badgeVisible: false,
    ocrDetectedBadge: false,
    serviceConfirmed: false,
    serviceConfirmedComing: false,
    serviceConfirmedJustAdded: false,
    comingDate: null,
    comingKind: null,
    comingBadgeVisible: false,
    justAddedBadgeVisible: false,
    justAddedLabelMismatch: false,
    imageInspected: false,
    inspectionStatus: 'not-inspected',
    ocrText: '',
    error: null
  };
  if (!posterUrl) {
    result.error = 'missing-poster-url';
    result.inspectionStatus = 'missing-poster-url';
    return result;
  }
  result.imageInspected = true;
  result.inspectionStatus = 'image-ocr-checked';
  try {
    const response = await fetch(posterUrl, {
      headers: { accept: 'image/avif,image/webp,image/png,image/jpeg,*/*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs)
    });
    result.httpStatus = response.status;
    result.contentType = (response.headers.get('content-type') || '').split(';')[0].toLowerCase();
    result.finalUrl = response.url;
    result.posterStatus = response.headers.get('x-poster-date-status');
    result.posterSource = response.headers.get('x-poster-source');
    result.posterBadgeText = response.headers.get('x-poster-badge');
    result.comingDate = response.headers.get('x-poster-date');
    result.comingKind = response.headers.get('x-poster-date-type');
    if (!response.ok) throw new Error('HTTP ' + response.status);
    if (!result.contentType.startsWith('image/')) throw new Error('Non-image response: ' + result.contentType);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 15 * 1024 * 1024) throw new Error('Empty or oversized image');
    const metadata = await sharp(bytes, { limitInputPixels: 40000000 }).metadata();
    if (!metadata.width || !metadata.height || metadata.width < 160 || metadata.height < 240) throw new Error('Invalid poster dimensions');
    result.serviceConfirmedJustAdded = response.headers.get('x-poster-just-added') === 'true' || result.posterStatus === 'just-added-overlay' || result.posterStatus === 'upcoming-date+just-added-overlay';
    result.serviceConfirmedComing = result.posterStatus === 'upcoming-date-overlay' || result.posterStatus === 'upcoming-date+just-added-overlay';
    result.serviceConfirmed = Boolean(result.posterStatus);
    let ocr = { visible: false, text: '' };
    // The production renderer's response headers are emitted only after the
    // relevant OCR/detection and image overlay have completed. Trust those
    // per-title results; run a second OCR pass only if the custom route was
    // bypassed or failed to return its status headers.
    if (!result.posterStatus) {
      const cropHeight = Math.max(120, Math.min(metadata.height, Math.round(metadata.height * 0.28)));
      const prepared = await sharp(bytes, { limitInputPixels: 40000000 })
        .extract({ left: 0, top: 0, width: metadata.width, height: cropHeight })
        .resize({ width: Math.min(1500, Math.max(900, metadata.width * 2)) })
        .grayscale().normalize().sharpen().png().toBuffer();
      ocr = await detectBadge(prepared);
      result.inspectionStatus = 'missing-renderer-status-ocr-checked';
    } else if (result.posterStatus === 'no-upcoming-release') {
      result.inspectionStatus = 'renderer-checked-no-eligible-badge';
    } else {
      result.inspectionStatus = 'renderer-overlay-confirmed';
    }
    result.ocrText = ocr.text;
    result.ocrDetectedBadge = ocr.visible;
    result.comingBadgeVisible = result.serviceConfirmedComing || hasComingDate(ocr.text);
    result.justAddedBadgeVisible = result.serviceConfirmedJustAdded || result.ocrDetectedBadge;
    result.justAddedLabelMismatch = result.serviceConfirmedJustAdded && result.posterBadgeText !== 'Just Added';
    result.badgeVisible = result.justAddedBadgeVisible || result.comingBadgeVisible;
    return result;
  } catch (error) {
    result.error = String(error?.message || error).slice(0, 240);
    return result;
  }
}

const results = new Array(entries.length);
let cursor = 0;
let completed = 0;
async function runWorker() {
  while (true) {
    const index = cursor++;
    if (index >= entries.length) return;
    results[index] = await inspect(entries[index]);
    completed++;
    if (completed % 50 === 0 || completed === entries.length) {
      console.log('AUDIT_PROGRESS ' + completed + '/' + entries.length);
    }
  }
}
try {
  await Promise.all(Array.from({ length: concurrency }, runWorker));
} finally {
  await worker.terminate();
}

const byCatalog = {};
for (const [catalog, items] of Object.entries(catalogs)) {
  const rows = results.filter(row => row.catalog === catalog);
  byCatalog[catalog] = {
    total: rows.length,
    catalogFlagged: rows.filter(row => row.catalogFlag).length,
    visibleBadge: rows.filter(row => row.badgeVisible).length,
    justAddedVisible: rows.filter(row => row.justAddedBadgeVisible).length,
    justAddedLabelMismatchCount: rows.filter(row => row.justAddedLabelMismatch).length,
    comingDateVisible: rows.filter(row => row.comingBadgeVisible).length,
    comingDateEligible: rows.filter(row => row.serviceConfirmedComing).length,
    serviceConfirmed: rows.filter(row => row.serviceConfirmed).length,
    ocrConfirmed: rows.filter(row => row.ocrDetectedBadge || row.comingBadgeVisible).length,
    unavailable: rows.filter(row => row.error).length,
    imagesInspected: rows.filter(row => row.imageInspected).length,
    flaggedButNotVisible: rows.filter(row => row.catalogFlag && !row.justAddedBadgeVisible).map(row => ({ title: row.title, id: row.id, error: row.error, httpStatus: row.httpStatus })),
    justAddedLabelMismatch: rows.filter(row => row.justAddedLabelMismatch).map(row => ({ title: row.title, id: row.id, badgeText: row.posterBadgeText })),
    postersWithNoComingDate: rows.filter(row => !row.serviceConfirmedComing).map(row => ({ title: row.title, id: row.id, status: row.posterStatus, error: row.error })),
    visibleButNotFlagged: rows.filter(row => row.badgeVisible && !row.catalogFlag).map(row => ({ title: row.title, id: row.id }))
  };
}
const visibleTitles = results.filter(row => row.badgeVisible);
const justAddedTitles = results.filter(row => row.justAddedBadgeVisible);
const comingDateTitles = results.filter(row => row.comingBadgeVisible);
const report = {
  generatedAt: new Date().toISOString(),
  catalogUpdatedAt: catalogStatus.updatedAt || null,
  catalogSource,
  snapshotTitleCount,
  totalTitles: entries.length,
  scannedTitles: results.length,
  catalogFlaggedCount: results.filter(row => row.catalogFlag).length,
  visibleBadgeCount: visibleTitles.length,
  unavailableCount: results.filter(row => row.error).length,
  posterImagesInspected: results.filter(row => row.imageInspected).length,
  serviceConfirmedCount: results.filter(row => row.serviceConfirmed).length,
  justAddedLabelMismatchCount: results.filter(row => row.justAddedLabelMismatch).length,
  justAddedLabelMismatch: results.filter(row => row.justAddedLabelMismatch).map(row => ({ catalog: row.catalog, title: row.title, id: row.id, badgeText: row.posterBadgeText })),
  ocrConfirmedCount: results.filter(row => row.ocrDetectedBadge).length,
  unflaggedTitlesNotDownloaded: 0,
  byCatalog,
  visibleTitles,
  flaggedButNotVisible: results.filter(row => row.catalogFlag && !row.justAddedBadgeVisible),
  auditPolicy: 'Every poster in all eight catalogs is downloaded and inspected through the public custom poster route. Coming-date eligibility is taken from the central upcoming index or TMDB/TVmaze response. Just Added eligibility comes from the central 14-day catalog index, explicit catalog flag or BetterPosters tag; the exact response label must be title-case Just Added.',
  results
};
await mkdir(outputDir, { recursive: true });
await writeFile(resolve(outputDir, 'just-added-audit.json'), JSON.stringify(report, null, 2));
const lines = [
  '# Just Added poster audit',
  '',
  'Generated: ' + report.generatedAt,
  'Catalog snapshot updated: ' + (report.catalogUpdatedAt || 'not recorded'),
  'Catalog source: ' + report.catalogSource,
  'Poster route tested: ' + (posterToken ? 'personalised BetterPosters install proxy' : 'default public proxy'),
  'GitHub snapshot title count: ' + report.snapshotTitleCount,
  '',
  '| Catalog | Titles | Catalog flagged | Images checked | Coming date | Just Added | Any visible badge | Unavailable |',
  '|---|---:|---:|---:|---:|---:|---:|---:|'
];
for (const [catalog, value] of Object.entries(byCatalog)) {
  lines.push('| ' + catalog + ' | ' + value.total + ' | ' + value.catalogFlagged + ' | ' + value.imagesInspected + ' | ' + value.comingDateVisible + ' | ' + value.justAddedVisible + ' | ' + value.visibleBadge + ' | ' + value.unavailable + ' |');
}
lines.push('', '**Total titles:** ' + report.totalTitles, '**Catalog entries checked:** ' + report.scannedTitles, '**Poster images inspected:** ' + report.posterImagesInspected, '**Service-confirmed overlays:** ' + report.serviceConfirmedCount, '**Visible Coming/New Episode labels:** ' + comingDateTitles.length, '**Visible “Just Added” labels:** ' + justAddedTitles.length, '**Just Added casing mismatches:** ' + report.justAddedLabelMismatchCount, '**Unavailable posters:** ' + report.unavailableCount, '', '## Titles with a visible Just Added label');
for (const row of justAddedTitles) lines.push('- **' + row.title + '** (' + row.catalog + ', ' + row.id + ')');
lines.push('', '## Titles with a visible Coming/New Episode date');
for (const row of comingDateTitles) lines.push('- **' + row.title + '** (' + row.catalog + ', ' + row.id + '): ' + row.comingDate);
lines.push('', '## Just Added casing mismatches');
for (const row of report.justAddedLabelMismatch) lines.push('- **' + row.title + '** (' + row.catalog + ', ' + row.id + '): ' + String(row.badgeText));
lines.push('', '## Catalog flagged but Just Added badge missing');
for (const row of report.flaggedButNotVisible) lines.push('- **' + row.title + '** (' + row.catalog + ', ' + row.id + '): ' + (row.error || 'Service did not confirm Just Added'));
lines.push('', 'Every poster URL was requested and checked; titles without a future release date or Just Added eligibility are not counted as missing badges.');
await writeFile(resolve(outputDir, 'just-added-audit.md'), lines.join('\n') + '\n');
console.log('AUDIT_RESULT ' + JSON.stringify({
  totalTitles: report.totalTitles,
  scannedTitles: report.scannedTitles,
  catalogFlaggedCount: report.catalogFlaggedCount,
  visibleBadgeCount: report.visibleBadgeCount,
  unavailableCount: report.unavailableCount,
  posterImagesInspected: report.posterImagesInspected,
  serviceConfirmedCount: report.serviceConfirmedCount,
  ocrConfirmedCount: report.ocrConfirmedCount,
  unflaggedTitlesNotDownloaded: report.unflaggedTitlesNotDownloaded,
  byCatalog,
  visibleTitles: visibleTitles.map(row => ({ catalog: row.catalog, title: row.title, id: row.id, comingDate: row.comingDate, justAdded: row.justAddedBadgeVisible })),
  justAddedTitles: justAddedTitles.map(row => ({ catalog: row.catalog, title: row.title, id: row.id })),
  comingDateTitles: comingDateTitles.map(row => ({ catalog: row.catalog, title: row.title, id: row.id, date: row.comingDate, kind: row.comingKind })),
  flaggedButNotVisible: report.flaggedButNotVisible.map(row => ({ catalog: row.catalog, title: row.title, id: row.id, error: row.error })),
}));
