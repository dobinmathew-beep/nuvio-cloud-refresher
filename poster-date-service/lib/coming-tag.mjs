import { createHash } from 'node:crypto';

const CACHE_MS = 30 * 60 * 1000;
const cache = new Map();
let workerPromise;

function hasComingDateText(text) {
  const normalized = String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const month = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
  const day = '\\d{1,2}(?:st|nd|rd|th)?';
  const date = '(?:' + day + '\\s*' + month + '|' + month + '\\s*' + day + ')';
  return new RegExp(' coming.{0,32} ' + date + ' ', 'i').test(' ' + normalized + ' ');
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

  // Inspect a taller portion of the BetterPosters tag row. The extra border helps
  // OCR with tightly cropped chips, while two layouts handle multi-chip rows.
  const cropHeight = Math.max(100, Math.min(metadata.height, Math.round(metadata.height * 0.24)));
  const crop = await sharp(input)
    .extract({ left: 0, top: 0, width: metadata.width, height: cropHeight })
    .resize({ width: Math.min(2000, metadata.width * 2) })
    .grayscale()
    .normalize()
    .extend({ top: 12, bottom: 12, left: 12, right: 12, background: '#ffffff' })
    .png()
    .toBuffer();

  const worker = await getWorker();
  // PSM 11 finds text in separate chips; PSM 6 provides a second layout pass.
  for (const mode of ['11', '6']) {
    await worker.setParameters({ tessedit_pageseg_mode: mode });
    const result = await worker.recognize(crop);
    if (hasComingDateText(result?.data?.text)) {
      cache.set(key, { value: true, at: Date.now() });
      return true;
    }
  }

  cache.set(key, { value: false, at: Date.now() });
  while (cache.size > 500) cache.delete(cache.keys().next().value);
  return false;
}

export { hasComingDateText };
