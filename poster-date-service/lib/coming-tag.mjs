import { createHash } from 'node:crypto';

const CACHE_MS = 30 * 60 * 1000;
const cache = new Map();
let workerPromise;

function normalizedText(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function hasComingDateText(text) {
  const normalized = normalizedText(text);
  const month = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
  const day = '\\d{1,2}(?:st|nd|rd|th)?';
  const date = '(?:' + day + '\\s*' + month + '|' + month + '\\s*' + day + ')';

  // BetterPosters' top chips sometimes OCR as only the date (the word
  // "Coming" is faint, clipped, or split between chips). In this tightly
  // bounded top-tag crop, a month+day is enough to avoid stacking badges.
  if (new RegExp('(?:^|\\s)' + date + '(?:$|\\s)', 'i').test(normalized)) return true;
  return new RegExp('coming.{0,40}' + date, 'i').test(normalized);
}

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import('tesseract.js');
      return createWorker('eng', 1, { logger: () => {} });
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

  // BetterPosters may place its compact Coming chip lower than the top row.
  // Inspect the upper 65% of the poster rather than a narrow header: the
  // previous 32% crop still missed the Dune chip in the real-world test.
  // Suppression is intentionally conservative: missing an overlay is safer
  // than covering an existing BetterPosters release label with a duplicate.
  const cropHeight = Math.max(180, Math.min(metadata.height, Math.round(metadata.height * 0.65)));
  const base = sharp(input, { limitInputPixels: 40000000 })
    .extract({ left: 0, top: 0, width: metadata.width, height: cropHeight })
    .resize({ width: Math.min(2400, metadata.width * 3) })
    .grayscale()
    .normalize()
    .sharpen();

  const normalized = await base.clone()
    .extend({ top: 18, bottom: 18, left: 18, right: 18, background: '#ffffff' })
    .png().toBuffer();
  const highContrast = await base.clone()
    .linear(1.7, -65)
    .threshold(145)
    .extend({ top: 18, bottom: 18, left: 18, right: 18, background: '#ffffff' })
    .png().toBuffer();

  const worker = await getWorker();
  for (const image of [normalized, highContrast]) {
    for (const mode of ['11', '6', '12']) {
      await worker.setParameters({ tessedit_pageseg_mode: mode });
      const result = await worker.recognize(image);
      if (hasComingDateText(result?.data?.text)) {
        cache.set(key, { value: true, at: Date.now() });
        return true;
      }
    }
  }

  cache.set(key, { value: false, at: Date.now() });
  while (cache.size > 500) cache.delete(cache.keys().next().value);
  return false;
}

export { hasComingDateText };
