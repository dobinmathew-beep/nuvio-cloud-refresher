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
const concurrency = Math.max(1, Math.min(6, Number(process.env.AUDIT_CONCURRENCY || 4)));
const timeoutMs = 25000;

const catalogs = JSON.parse(await readFile(catalogsPath, 'utf8'));
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
  return String(text || '').replace(/\\[nr]/g, ' ').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim().includes('just added');
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
    badgeVisible: false,
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
  if (!flagged) {
    result.inspectionStatus = 'not-flagged-by-catalog';
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
    if (!response.ok) throw new Error('HTTP ' + response.status);
    if (!result.contentType.startsWith('image/')) throw new Error('Non-image response: ' + result.contentType);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 15 * 1024 * 1024) throw new Error('Empty or oversized image');
    const metadata = await sharp(bytes, { limitInputPixels: 40000000 }).metadata();
    if (!metadata.width || !metadata.height || metadata.width < 160 || metadata.height < 240) throw new Error('Invalid poster dimensions');
    const cropHeight = Math.max(120, Math.min(metadata.height, Math.round(metadata.height * 0.28)));
    const prepared = await sharp(bytes, { limitInputPixels: 40000000 })
      .extract({ left: 0, top: 0, width: metadata.width, height: cropHeight })
      .resize({ width: Math.min(1500, Math.max(900, metadata.width * 2)) })
      .grayscale().normalize().sharpen().png().toBuffer();
    const ocr = await detectBadge(prepared);
    result.ocrText = ocr.text;
    result.badgeVisible = ocr.visible;
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
    unavailable: rows.filter(row => row.error).length,
    imagesInspected: rows.filter(row => row.imageInspected).length,
    flaggedButNotVisible: rows.filter(row => row.catalogFlag && !row.badgeVisible).map(row => ({ title: row.title, id: row.id, error: row.error, httpStatus: row.httpStatus })),
    visibleButNotFlagged: rows.filter(row => row.badgeVisible && !row.catalogFlag).map(row => ({ title: row.title, id: row.id }))
  };
}
const visibleTitles = results.filter(row => row.badgeVisible);
const report = {
  generatedAt: new Date().toISOString(),
  catalogUpdatedAt: catalogStatus.updatedAt || null,
  totalTitles: entries.length,
  scannedTitles: results.length,
  catalogFlaggedCount: results.filter(row => row.catalogFlag).length,
  visibleBadgeCount: visibleTitles.length,
  unavailableCount: results.filter(row => row.error).length,
  posterImagesInspected: results.filter(row => row.imageInspected).length,
  unflaggedTitlesNotDownloaded: results.filter(row => !row.catalogFlag && !row.error).length,
  byCatalog,
  visibleTitles,
  flaggedButNotVisible: results.filter(row => row.catalogFlag && !row.badgeVisible),
  unflaggedImagePolicy: 'Every catalog entry is checked for the custom badge flag and URL. Only flagged posters are downloaded for OCR because unflagged entries are not sent to our Just Added renderer.',
  results
};
await mkdir(outputDir, { recursive: true });
await writeFile(resolve(outputDir, 'just-added-audit.json'), JSON.stringify(report, null, 2));
const lines = [
  '# Just Added poster audit',
  '',
  'Generated: ' + report.generatedAt,
  'Catalog snapshot updated: ' + (report.catalogUpdatedAt || 'not recorded'),
  '',
  '| Catalog | Titles | Catalog flagged | Images OCR-checked | Visible badge | Unavailable |',
  '|---|---:|---:|---:|---:|---:|'
];
for (const [catalog, value] of Object.entries(byCatalog)) {
  lines.push('| ' + catalog + ' | ' + value.total + ' | ' + value.catalogFlagged + ' | ' + value.imagesInspected + ' | ' + value.visibleBadge + ' | ' + value.unavailable + ' |');
}
lines.push('', '**Total titles:** ' + report.totalTitles, '**Catalog entries checked:** ' + report.scannedTitles, '**Flagged poster images OCR-checked:** ' + report.posterImagesInspected, '**Unflagged entries not downloaded:** ' + report.unflaggedTitlesNotDownloaded, '**Catalog flagged:** ' + report.catalogFlaggedCount, '**Visible “Just Added” labels:** ' + report.visibleBadgeCount, '**Unavailable posters:** ' + report.unavailableCount, '', '## Titles with a visible Just Added label');
for (const row of visibleTitles) lines.push('- **' + row.title + '** (' + row.catalog + ', ' + row.id + ')');
lines.push('', '## Flagged in catalog but badge not detected');
for (const row of report.flaggedButNotVisible) lines.push('- **' + row.title + '** (' + row.catalog + ', ' + row.id + '): ' + (row.error || 'OCR did not detect the label'));
lines.push('', 'Unflagged titles were checked against all catalog badge flags and were not downloaded because the custom Just Added renderer is only requested for flagged entries.');
await writeFile(resolve(outputDir, 'just-added-audit.md'), lines.join('\n') + '\n');
console.log('AUDIT_RESULT ' + JSON.stringify({
  totalTitles: report.totalTitles,
  scannedTitles: report.scannedTitles,
  catalogFlaggedCount: report.catalogFlaggedCount,
  visibleBadgeCount: report.visibleBadgeCount,
  unavailableCount: report.unavailableCount,
  posterImagesInspected: report.posterImagesInspected,
  unflaggedTitlesNotDownloaded: report.unflaggedTitlesNotDownloaded,
  byCatalog,
  visibleTitles: visibleTitles.map(row => ({ catalog: row.catalog, title: row.title, id: row.id })),
  flaggedButNotVisible: report.flaggedButNotVisible.map(row => ({ catalog: row.catalog, title: row.title, id: row.id, error: row.error })),
}));
