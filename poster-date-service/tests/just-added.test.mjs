import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { createWorker } from 'tesseract.js';
import { langPath } from '@tesseract.js-data/eng';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';

const require = createRequire(import.meta.url);
import { renderJustAddedBadge, JUST_ADDED_BADGE_TEXT, buildJustAddedBadgeSvg } from '../lib/render-poster.mjs';
import { hasJustAddedBadgeText } from '../lib/coming-tag.mjs';

test('badge SVG embeds the exact title-case Just Added label', () => {
  const svg = buildJustAddedBadgeSvg(400, 70, 12, 38).toString('utf8');
  assert.equal(JUST_ADDED_BADGE_TEXT, 'Just Added');
  assert.match(svg, /<text[^>]*>Just Added<\\/text>/);
  assert.doesNotMatch(svg, /\\$\\{JUST_ADDED_BADGE_TEXT\\}/);
});

test('OCR text normalisation recognises the Just Added wording', () => {
  assert.equal(JUST_ADDED_BADGE_TEXT, 'Just Added');
  assert.equal(hasJustAddedBadgeText('Just Added'), true);
  assert.equal(hasJustAddedBadgeText('JUST ADDED'), true);
  assert.equal(hasJustAddedBadgeText('COMING NOV 20'), false);
});

test('overlay preserves poster dimensions', async () => {
  const input = await sharp({ create: { width: 600, height: 900, channels: 3, background: '#456789' } }).jpeg().toBuffer();
  const output = await renderJustAddedBadge(input);
  const before = await sharp(input).metadata();
  const after = await sharp(output).metadata();
  assert.equal(after.width, before.width);
  assert.equal(after.height, before.height);
});


test('rendered poster visibly contains the exact Just Added label', async () => {
  const input = await sharp({ create: { width: 600, height: 900, channels: 3, background: '#456789' } }).jpeg().toBuffer();
  const output = await renderJustAddedBadge(input);
  const crop = await sharp(output).extract({ left: 0, top: 70, width: 600, height: 210 }).resize({ width: 1200 }).png().toBuffer();
  const worker = await createWorker('eng', 1, {
    langPath,
    corePath: dirname(require.resolve('tesseract.js-core')),
    cacheMethod: 'write'
  });
  try {
    await worker.setParameters({ tessedit_pageseg_mode: '11' });
    const result = await worker.recognize(crop);
    const text = String(result?.data?.text || '').replace(/\\s+/g, ' ').trim();
    assert.match(text, /Just Added/i, 'rendered poster must visibly display Just Added');
    assert.doesNotMatch(text, /\\$\\{JUST_ADDED_BADGE_TEXT\\}/, 'template variable must not appear on the poster');
  } finally {
    await worker.terminate();
  }
});
