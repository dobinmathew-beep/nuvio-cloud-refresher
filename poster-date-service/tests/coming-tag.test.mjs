import test from 'node:test';
import assert from 'node:assert/strict';
import { hasExpectedDateBadgeText as hasComingDateText } from '../lib/coming-tag.mjs';

test('recognizes BetterPosters Coming day-month labels', () => {
  assert.equal(hasComingDateText('Coming 24 Dec'), true);
  assert.equal(hasComingDateText('Coming 5 January'), true);
  assert.equal(hasComingDateText('COMING 18 NOV'), true);
  assert.equal(hasComingDateText('Coming 18th Dec'), true);
  assert.equal(hasComingDateText('Coming Dec 18th'), true);
});

test('recognizes date-only OCR when the Coming chip label is missed', () => {
  assert.equal(hasComingDateText('18 Dec'), true);
  assert.equal(hasComingDateText('Dec 18'), true);
  assert.equal(hasComingDateText('18th December'), true);
  assert.equal(hasComingDateText('COMING'), false);
});

test('recognizes labels even when OCR separates the date onto another line', () => {
  assert.equal(hasComingDateText('Coming\\n24 Dec'), true);
  assert.equal(hasComingDateText('COMING — 5 January'), true);
});

test('does not suppress overlays for unrelated poster text', () => {
  assert.equal(hasComingDateText('Coming soon'), false);
  assert.equal(hasComingDateText('Action 4.2'), false);
  assert.equal(hasComingDateText('A date is unknown'), false);
});
