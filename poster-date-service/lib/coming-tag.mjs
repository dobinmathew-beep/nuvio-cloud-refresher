import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { createSerialQueue } from './serial-queue.mjs';
import { imageKitConfig } from './imagekit-storage.mjs';

const require = createRequire(import.meta.url);
const CACHE_MS = 6 * 60 * 60 * 1000;
const cache = new Map();
let sharpConfigured = false;
let workerPromise;
const ocrQueue = createSerialQueue();
let workerRecognitionCount = 0;


function withOcrQueue(task) {
  return ocrQueue.run(task);
}

async function recognizeText(prepared) {
  return withOcrQueue(async () => {
    const worker = await getWorker();
    const startedAt = Date.now();
    const before = process.memoryUsage();
    try {
      // A single sparse-text pass is sufficient for the shared top-strip crop.
      // Do not run a second PSM mode: it doubles WASM recognition allocations.
      await worker.setParameters({ tessedit_pageseg_mode: '11' });
      const result = await worker.recognize(prepared);
      return String(result?.data?.text || '');
    } finally {
      await worker.terminate().catch(() => {});
      workerPromise = null;
      workerRecognitionCount = 0;
      await new Promise(resolve => setImmediate(resolve));
      global.gc?.();
      const after = process.memoryUsage();
      console.info('[poster-ocr-memory]', JSON.stringify({
        durationMs: Date.now() - startedAt,
        before: { rss: before.rss, heapUsed: before.heapUsed, external: before.external, arrayBuffers: before.arrayBuffers },
        after: { rss: after.rss, heapUsed: after.heapUsed, external: after.external, arrayBuffers: after.arrayBuffers },
        workerRecycled: true
      }));
    }
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
    if (kind === 'any') return true;
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

function storeOcrCache(key, text) {
  cache.set(key, { value: text, at: Date.now() });
  while (cache.size > 256) cache.delete(cache.keys().next().value);
}

async function readPersistentOcrCache(hash) {
  const config = imageKitConfig();
  if (!config) return null;
  const url = config.endpoint + '/catalog-state/ocr-cache/' + hash + '.json?v=' + Math.floor(Date.now() / 300000);
  try {
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(1800) });
    if (!response.ok) return null;
    const value = await response.json();
    const at = Date.parse(value?.createdAt || '');
    if (value?.version !== 1 || value?.sha256 !== hash || typeof value?.text !== 'string' ||
        !Number.isFinite(at) || Date.now() - at > 30 * 24 * 60 * 60 * 1000) return null;
    storeOcrCache(hash + ':top-strip-ocr', value.text);
    return value.text;
  } catch { return null; }
}

async function writePersistentOcrCache(hash, text) {
  const config = imageKitConfig();
  if (!config) return;
  const form = new FormData();
  const filename = hash + '.json';
  const value = { version: 1, sha256: hash, text, createdAt: new Date().toISOString() };
  form.set('file', new Blob([JSON.stringify(value)], { type: 'application/json' }), filename);
  form.set('fileName', filename);
  form.set('folder', '/catalog-state/ocr-cache');
  form.set('useUniqueFileName', 'false');
  form.set('overwriteFile', 'true');
  form.set('isPrivateFile', 'false');
  const response = await fetch('https://upload.imagekit.io/api/v1/files/upload', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(config.privateKey + ':').toString('base64') },
    body: form,
    signal: AbortSignal.timeout(5000)
  });
  if (!response.ok) throw new Error('Persistent OCR cache upload HTTP ' + response.status);
}

async function recognizePosterTopStrip(input) {
  const hash = createHash('sha256').update(input).digest('hex');
  const key = hash + ':top-strip-ocr';
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const persistent = await readPersistentOcrCache(hash);
  if (persistent !== null) return persistent;

  const { default: sharp } = await import('sharp');
  if (!sharpConfigured) {
    sharp.cache({ memory: 8, files: 0, items: 2 });
    sharp.concurrency(1);
    sharpConfigured = true;
  }
  // Read dimensions first (header-only), then reject oversized artwork before
  // decoding. Both supported badge types occupy this same narrow top strip.
  const metadata = await sharp(input, { limitInputPixels: 8000000 }).metadata();
  if (!metadata.width || !metadata.height || metadata.width * metadata.height > 8000000) {
    throw new Error('Poster dimensions exceed OCR safety limit');
  }
  const cropHeight = Math.max(120, Math.min(metadata.height, Math.round(metadata.height * 0.28)));
  let prepared = await sharp(input, { limitInputPixels: 8000000 })
    .extract({ left: 0, top: 0, width: metadata.width, height: cropHeight })
    .resize({ width: Math.min(720, metadata.width), withoutEnlargement: true })
    .grayscale()
    .normalize()
    .sharpen()
    .extend({ top: 10, bottom: 10, left: 10, right: 10, background: '#ffffff' })
    .png()
    .toBuffer();
  try {
    const text = await recognizeText(prepared);
    storeOcrCache(key, text);
    // Persist only the tiny OCR result, keyed by the source image SHA-256.
    // A changed source naturally receives a new key; unchanged artwork never
    // consumes another Tesseract pass after a successful cache write.
    void writePersistentOcrCache(hash, text).catch(error =>
      console.warn('[poster-ocr-persistent-cache-write-failed]', error?.message || 'unknown error')
    );
    return text;
  } finally {
    prepared = null;
    global.gc?.();
  }
}

export async function inspectExistingPosterBadges(input, kind = 'premiere', isoDate = null) {
  const text = await recognizePosterTopStrip(input);
  return {
    hasDateBadge: hasExpectedDateBadgeText(text, kind, isoDate),
    hasJustAddedBadge: hasJustAddedBadgeText(text)
  };
}

export async function hasExistingComingDateTag(input, kind = 'premiere', isoDate = null) {
  const result = await inspectExistingPosterBadges(input, kind, isoDate);
  return result.hasDateBadge;
}

export { hasExpectedDateBadgeText };



export async function terminateOcrWorker() {
  // Memory-pressure cleanup must join the same FIFO as recognition. Without
  // this, cleanup can terminate Tesseract between setParameters() and
  // recognize(), leaving Tesseract's internal worker handle null.
  return withOcrQueue(async () => {
    if (!workerPromise) return;
    try {
      const worker = await workerPromise;
      await worker.terminate();
    } finally {
      workerPromise = null;
      workerRecognitionCount = 0;
      await new Promise(resolve => setImmediate(resolve));
      global.gc?.();
    }
  });
}

export function hasJustAddedBadgeText(text) {
  return /\bjust\s*added\b/i.test(normalizedText(text));
}

export async function hasExistingJustAddedTag(input) {
  const result = await inspectExistingPosterBadges(input, 'any', null);
  return result.hasJustAddedBadge;
}
