import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { renderJustAddedBadge, JUST_ADDED_BADGE_TEXT, buildJustAddedBadgeSvg } from '../lib/render-poster.mjs';
import { hasJustAddedBadgeText } from '../lib/coming-tag.mjs';

test('badge SVG embeds the exact title-case Just Added label', () => {
  const svg = buildJustAddedBadgeSvg(400, 70, 12, 38).toString('utf8');
  assert.equal(JUST_ADDED_BADGE_TEXT, 'Just Added');
  assert.equal(svg.includes('>Just Added</text>'), true);
  assert.equal(svg.includes('JUST ADDED'), false);
  assert.equal(svg.includes('${JUST_ADDED_BADGE_TEXT}'), false);
});

test('OCR text normalisation recognises the Just Added wording', () => {
  assert.equal(hasJustAddedBadgeText('Just Added'), true);
  assert.equal(hasJustAddedBadgeText('JustAdded'), true);
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
