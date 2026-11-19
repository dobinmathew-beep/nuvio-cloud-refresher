import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { renderJustAddedBadge } from '../lib/render-poster.mjs';
import { hasJustAddedBadgeText } from '../lib/coming-tag.mjs';

test('OCR detects an existing Just Added tag', () => {
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
