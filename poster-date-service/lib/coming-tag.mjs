import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';

const require = createRequire(import.meta.url);
const CACHE_MS = 6 * 60 * 60 * 1000;
const cache = new Map();
let workerPromise;

function normalizedText(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function hasExpectedDateBadgeText(text, kind = 'premiere') {
  const normalized = normalizedText(text);
  const month = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
  const day = '\\d{1,2}(?:st|nd|rd|th)?';
  const date = '(?:' + day + '\\s*' + month + '|' + month + '\\s*' + day + ')';
  if (new RegExp('(?:^|\\s)' + date + '(?:$|\\s)', 'i').test(normalized)) return true;
  return new RegExp('coming.{0,40}' + date, 'i').test(normalized);
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

export async function hasExistingComingDateTag(input) {
  const key = createHash('sha256').update(input).digest('hex');
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
  for (const mode of ['11', '6']) {
    await worker.setParameters({ tessedit_pageseg_mode: mode });
    const result = await worker.recognize(prepared);
    if (hasExpectedDateBadgeText(result?.data?.text, kind)) {
      cache.set(key, { value: true, at: Date.now() });
      return true;
    }
  }

  cache.set(key, { value: false, at: Date.now() });
  while (cache.size > 1200) cache.delete(cache.keys().next().value);
  return false;
}

export { hasExpectedDateBadgeText };
