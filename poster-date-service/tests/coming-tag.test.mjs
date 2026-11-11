import test from 'node:test';
import assert from 'node:assert/strict';
import { hasComingDateText } from '../lib/coming-tag.mjs';

test('recognizes BetterPosters Coming day-month labels', () => {
  assert.equal(hasComingDateText('Coming 24 Dec'), true);
  assert.equal(hasComingDateText('Coming 5 January'), true);
  assert.equal(hasComingDateText('COMING 18 NOV'), true);
});

test('does not suppress overlays for unrelated poster text', () => {
  assert.equal(hasComingDateText('Coming soon'), false);
  assert.equal(hasComingDateText('Action 4.2'), false);
  assert.equal(hasComingDateText('24 Dec'), false);
});
