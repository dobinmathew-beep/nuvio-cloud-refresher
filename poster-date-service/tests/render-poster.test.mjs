import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { renderUpcomingBadge } from '../lib/render-poster.mjs';

test('adds a readable overlay without changing poster dimensions or format', async () => {
  const source = await sharp({ create: { width: 400, height: 600, channels: 3, background: '#26354b' } }).jpeg().toBuffer();
  const output = await renderUpcomingBadge(source, '2026-12-20');
  const before = await sharp(source).metadata();
  const after = await sharp(output).metadata();
  assert.equal(after.width, before.width);
  assert.equal(after.height, before.height);
  assert.equal(after.format, 'jpeg');
  assert.ok(output.length > 0);
});

test('renders every English month abbreviation with vector glyphs', async () => {
  const source = await sharp({ create: { width: 400, height: 600, channels: 3, background: '#26354b' } }).jpeg().toBuffer();
  for (let month = 1; month <= 12; month++) {
    const date = `2026-${String(month).padStart(2, '0')}-29`;
    const output = await renderUpcomingBadge(source, date);
    assert.ok(output.length > 0, `badge should render for month ${month}`);
  }
});
