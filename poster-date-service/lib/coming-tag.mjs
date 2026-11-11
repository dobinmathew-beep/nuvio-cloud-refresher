import { createHash } from 'node:crypto';

const CACHE_MS = 30 * 60 * 1000;
const cache = new Map();
let workerPromise;

function hasComingDateText(text) {
  const normalized = String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const month = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
  return new RegExp('\\bcoming\\b.{0,24}\\b(?:\\d{1,2}\\s*' + month + '|' + month + '\\s*\\d{1,2})\\b', 'i').test(normalized);
}

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import('tesseract.js');
      const worker = await createWorker('eng', 1, { logger: () => {} });
      await worker.setParameters({ tessedit_pageseg_mode: '7' });
      return worker;
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

  // BetterPosters places its "Coming [date]" chip in the top tag row.
  const cropHeight = Math.max(80, Math.min(metadata.height, Math.round(metadata.height * 0.16)));
  const crop = await sharp(input)
    .extract({ left: 0, top: 0, width: metadata.width, height: cropHeight })
    .resize({ width: Math.min(1600, metadata.width * 2) })
    .grayscale()
    .normalize()
    .png()
    .toBuffer();

  const worker = await getWorker();
  const result = await worker.recognize(crop);
  const value = hasComingDateText(result?.data?.text);
  cache.set(key, { value, at: Date.now() });
  while (cache.size > 500) cache.delete(cache.keys().next().value);
  return value;
}

export { hasComingDateText };
