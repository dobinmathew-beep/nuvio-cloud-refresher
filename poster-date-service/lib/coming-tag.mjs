import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';

const require = createRequire(import.meta.url);
const CACHE_MS = 6 * 60 * 60 * 1000;
const cache = new Map();
let workerPromise;
let ocrQueue = Promise.resolve();

function withOcrQueue(task) {
  const job = ocrQueue.then(task);
  ocrQueue = job.then(() => undefined, () => undefined);
  return job;
}

async function recognizeWithModes(worker, prepared, predicate) {
  return withOcrQueue(async () => {
    for (const mode of ['11', '6']) {
      await worker.setParameters({ tessedit_pageseg_mode: mode });
      const result = await worker.recognize(prepared);
      if (predicate(result?.data?.text)) return true;
    }
    return false;
  });
}

function normalizedText(text) {
  // OCR sometimes returns escaped line breaks ("\\n") instead of real ones.
  return String(text || '').replace(/\\[nr]/g, ' ').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function hasExpectedDateBadgeText(text, kind = 'premiere', isoDate = null) {
  const normalized = normalizedText(text);
  const month = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
  const dayPattern = '\\d{1,2}(?:st|nd|rd|th)?';
  if (isoDate && /^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    const [, , monthNumber, dayNumber] = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const months = ['jan(?:uary)?','feb(?:ruary)?','mar(?:ch)?','apr(?:il)?','may','jun(?:e)?','jul(?:y)?','aug(?:ust)?','sep(?:t(?:ember)?)?','oct(?:ober)?','nov(?:ember)?','dec(?:ember)?'];
    const expectedMonth = months[Number(monthNumber) - 1];
    const expectedDay = String(Number(dayNumber)) + '(?:st|nd|rd|th)?';
    const expectedDate = new RegExp('(?:^|\\s)(?:' + expectedDay + '\\s+' + expectedMonth + '|' + expectedMonth + '\\s+' + expectedDay + ')(?:$|\\s)', 'i');
    if (!expectedDate.test(normalized)) return false;
  } else {
    const date = '(?:' + dayPattern + '\\s*' + month + '|' + month + '\\s*' + dayPattern + ')';
    if (!new RegExp('(?:^|\\s)' + date + '(?:$|\\s)', 'i').test(normalized)) return false;
  }
  const hasComingLabel = /coming/.test(normalized);
  const hasEpisodeLabel = /new episode/.test(normalized);
  if (hasComingLabel || hasEpisodeLabel) {
    return kind === 'episode' ? hasEpisodeLabel : hasComingLabel;
  }
  // OCR can miss the small chip while still reading the exact date. Since a
  // valid date was already required above, accept date-only text as a match.
  return true;
}

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import('tesseract.js');
      // Bundle both OCR model and WASM core with the service. This avoids
      // runtime CDN fetches that failed on the free Render instance.
      const langPath = require('@tesseract.js-data/eng').langPath;
      const corePath = dirname(require.resolve('tesseract.js-core'));
      return createWorker('eng', 1, {
        langPath,
        corePath,
        cacheMethod: 'write',
        logger: () => {}
      });
    })().catch(error => {
      workerPromise = null;
      throw error;
    });
  }
  return workerPromise;
}

export async function hasExistingComingDateTag(input, kind = 'premiere', isoDate = null) {
  const key = createHash('sha256').update(input).digest('hex') + ':' + kind + ':' + (isoDate || 'any-date');
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;

  const { default: sharp } = await import('sharp');
  const metadata = await sharp(input, { limitInputPixels: 40000000 }).metadata();
  if (!metadata.width || !metadata.height) throw new Error('Cannot inspect poster dimensions');

  // One compact crop and two OCR layouts: far less work than the former
  // six-pass/two-image pipeline, while retaining a conservative duplicate check.
  const cropHeight = Math.max(180, Math.min(metadata.height, Math.round(metadata.height * 0.65)));
  const prepared = await sharp(input, { limitInputPixels: 40000000 })
    .extract({ left: 0, top: 0, width: metadata.width, height: cropHeight })
    .resize({ width: Math.min(1800, metadata.width * 2) })
    .grayscale()
    .normalize()
    .sharpen()
    .extend({ top: 16, bottom: 16, left: 16, right: 16, background: '#ffffff' })
    .png()
    .toBuffer();

  const worker = await getWorker();
  const found = await recognizeWithModes(worker, prepared, text => hasExpectedDateBadgeText(text, kind, isoDate));
  if (found) {
    cache.set(key, { value: true, at: Date.now() });
    return true;
  }
  cache.set(key, { value: false, at: Date.now() });
  while (cache.size > 1200) cache.delete(cache.keys().next().value);
  return false;
}

export { hasExpectedDateBadgeText };


export function hasJustAddedBadgeText(text) {
  return /\bjust\s*added\b/i.test(normalizedText(text));
}

export async function hasExistingJustAddedTag(input) {
  const key = createHash('sha256').update(input).digest('hex') + ':just-added';
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const { default: sharp } = await import('sharp');
  const metadata = await sharp(input, { limitInputPixels: 40000000 }).metadata();
  if (!metadata.width || !metadata.height) throw new Error('Cannot inspect poster dimensions');
  // The chip sits in the top strip; this compact crop is much faster on
  // Render's free instance than OCR-ing most of the poster.
  const cropHeight = Math.max(120, Math.min(metadata.height, Math.round(metadata.height * 0.3)));
  const prepared = await sharp(input, { limitInputPixels: 40000000 })
    .extract({ left: 0, top: 0, width: metadata.width, height: cropHeight })
    .resize({ width: Math.min(1200, metadata.width * 2) })
    .grayscale()
    .normalize()
    .sharpen()
    .extend({ top: 12, bottom: 12, left: 12, right: 12, background: '#ffffff' })
    .png()
    .toBuffer();
  const worker = await getWorker();
  const found = await recognizeWithModes(worker, prepared, text => hasJustAddedBadgeText(text));
  if (found) {
    cache.set(key, { value: true, at: Date.now() });
    return true;
  }
  cache.set(key, { value: false, at: Date.now() });
  while (cache.size > 1200) cache.delete(cache.keys().next().value);
  return false;
}
