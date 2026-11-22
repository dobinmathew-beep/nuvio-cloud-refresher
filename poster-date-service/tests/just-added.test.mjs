import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { renderJustAddedBadge, removeExistingJustAddedBadge, JUST_ADDED_BADGE_TEXT, buildJustAddedBadgeSvg } from '../lib/render-poster.mjs';
import { hasJustAddedBadgeText, inspectExistingPosterBadges, terminateOcrWorker } from '../lib/coming-tag.mjs';
import { resetCatalogAddedIndexForTest } from '../lib/catalog-just-added.mjs';

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

test('badge renderer uses an allowlisted catalog poster when standard providers fail', async () => {
  const fallbackUrl = 'https://cinebuds.com/wp-content/uploads/2026/11/saayavanam-poster-200x300.jpg';
  const input = await sharp({ create: { width: 600, height: 900, channels: 3, background: '#456789' } }).jpeg().toBuffer();
  const originalFetch = globalThis.fetch;
  const requested = [];
  resetCatalogAddedIndexForTest();
  globalThis.fetch = async url => {
    const value = String(url);
    requested.push(value);
    if (value.includes('catalog-added.json')) return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    if (value.includes('recent-release-audit.json')) {
      const today = new Date().toISOString().slice(0, 10);
      return new Response(JSON.stringify({ items: [{ id: 'tt39195686', type: 'movie', releaseDate: today, matchState: 'published' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (value === fallbackUrl) return new Response(input, { status: 200, headers: { 'content-type': 'image/jpeg', 'content-length': String(input.length) } });
    return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } });
  };
  try {
    const handler = (await import('../api/poster.mjs')).default;
    const req = { method: 'GET', url: '/poster/tt39195686.jpg?badge=just-added&v=5', query: { id: 'tt39195686', badge: 'just-added', v: '5', fallback: fallbackUrl } };
    const res = { headers: {}, setHeader(name, value) { this.headers[name] = value; }, end(body) { this.body = body; } };
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['X-Poster-Date-Status'], 'just-added-overlay');
    assert.equal(res.headers['X-Poster-Source'], 'CatalogArtwork');
    assert(requested.includes(fallbackUrl));
    const metadata = await sharp(res.body).metadata();
    assert.equal(metadata.width, 600);
    assert.equal(metadata.height, 900);
  } finally {
    globalThis.fetch = originalFetch;
    resetCatalogAddedIndexForTest();
  }
});

test('badge renderer rejects untrusted catalog fallback hosts', async () => {
  const originalFetch = globalThis.fetch;
  const requested = [];
  globalThis.fetch = async url => {
    requested.push(String(url));
    return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } });
  };
  try {
    const handler = (await import('../api/poster.mjs')).default;
    const req = { method: 'GET', url: '/poster/tt39195686.jpg?badge=just-added&v=5', query: { id: 'tt39195686', badge: 'just-added', v: '5', fallback: 'https://evil.example/poster.jpg' } };
    const res = { headers: {}, setHeader(name, value) { this.headers[name] = value; }, end(body) { this.body = body; } };
    await handler(req, res);
    // When no trusted provider or existing ImageKit asset is available,
    // fail closed instead of redirecting clients to an upstream source.
    assert.equal(res.statusCode, 503);
    assert.equal(res.headers.Location, undefined);
    assert.equal(requested.some(url => url.startsWith('https://evil.example/')), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('shared poster URL normalizes a BetterPosters Just Added tag without a query flag', async () => {
  const base = await sharp({ create: { width: 600, height: 900, channels: 3, background: '#456789' } }).jpeg().toBuffer();
  const tag = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="100"><rect width="600" height="100" fill="#111111"/><text x="300" y="66" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="52" font-weight="700" fill="#ffffff">JUST ADDED</text></svg>');
  const sourceImage = await sharp(base).composite([{ input: tag, left: 0, top: 20 }]).jpeg().toBuffer();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    if (String(url).startsWith('https://btttr.cc/poster/imdb/poster-default/')) {
      return new Response(sourceImage, { status: 200, headers: { 'content-type': 'image/jpeg', 'content-length': String(sourceImage.length) } });
    }
    return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } });
  };
  try {
    const handler = (await import('../api/poster.mjs')).default;
    const req = { method: 'GET', url: '/poster/tt76543210.jpg', query: { id: 'tt76543210' } };
    const res = { headers: {}, setHeader(name, value) { this.headers[name] = value; }, end(body) { this.body = body; } };
    await handler(req, res);
    assert.equal(res.statusCode, 302);
    assert.equal(res.headers.Location, 'https://btttr.cc/poster/imdb/poster-default/tt76543210.jpg?rs=IM');
    assert.equal(res.headers['X-Poster-Date-Status'], 'background-generation-pending');
    assert.equal(res.headers['X-Poster-Source'], 'BetterPosters');
    assert.equal(res.body, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('removes an embedded BetterPosters Just Added chip when it is not authoritative', async () => {
  const base = await sharp({ create: { width: 600, height: 900, channels: 3, background: '#456789' } }).jpeg().toBuffer();
  const source = await renderJustAddedBadge(base, 0.105);
  const before = await inspectExistingPosterBadges(source, 'any', null);
  assert.equal(before.hasJustAddedBadge, true, 'fixture must contain a detectable source badge');
  const cleaned = await removeExistingJustAddedBadge(source, 0.105);
  const after = await inspectExistingPosterBadges(cleaned, 'any', null);
  assert.equal(after.hasJustAddedBadge, false, 'untrusted source badge must no longer be visible');
  const dimensions = await sharp(cleaned).metadata();
  assert.equal(dimensions.width, 600);
  assert.equal(dimensions.height, 900);
});

test('overlay preserves poster dimensions', async () => {
  const input = await sharp({ create: { width: 600, height: 900, channels: 3, background: '#456789' } }).jpeg().toBuffer();
  const output = await renderJustAddedBadge(input);
  const before = await sharp(input).metadata();
  const after = await sharp(output).metadata();
  assert.equal(after.width, before.width);
  assert.equal(after.height, before.height);
});

after(async () => { await terminateOcrWorker(); });
