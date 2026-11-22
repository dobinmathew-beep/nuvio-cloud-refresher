import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyTitle, earliestDigitalDate, hasJustAddedBadge } from '../audit_just_added.mjs';

test('earliest verified digital date wins over a later platform date', () => {
  const item = {
    type: 'movie',
    releaseKind: 'digital',
    ottDate: '2026-11-21',
    availability: [
      { kind: 'digital', date: '2013-01-01' },
      { kind: 'digital', date: '2026-11-21' }
    ]
  };
  assert.equal(earliestDigitalDate(item), '2013-01-01');
  const result = classifyTitle({ ...item, poster: 'https://example.test/poster.jpg?badge=just-added' }, new Date('2026-11-23T08:00:00Z'));
  assert.equal(result.status, 'stale-badge');
});

test('Race 2, Sholay and Vada Chennai are stale when only later platform additions are recent', () => {
  const cases = [
    ['tt1375789', '2013-01-01', '2026-11-20'],
    ['tt0073707', '1975-08-15', '2026-11-19'],
    ['tt5959980', '2018-10-17', '2026-11-18']
  ];
  for (const [id, first, later] of cases) {
    const result = classifyTitle({
      id, imdbId: id, type: 'movie', name: id,
      releaseKind: 'digital', ottDate: later,
      availability: [{ kind: 'digital', date: first }, { kind: 'digital', date: later }],
      poster: 'https://example.test/poster.jpg?badge=just-added'
    }, new Date('2026-11-23T08:00:00Z'));
    assert.equal(result.status, 'stale-badge', id);
    assert.equal(result.evidenceDate, first, id);
  }
});

test('a genuine first digital arrival within fourteen days is eligible', () => {
  const result = classifyTitle({
    id: 'tt1234567', type: 'movie', name: 'New title',
    releaseKind: 'digital', ottDate: '2026-11-20',
    availability: [{ kind: 'digital', date: '2026-11-20' }],
    poster: 'https://example.test/poster.jpg?badge=just-added'
  }, new Date('2026-11-23T08:00:00Z'));
  assert.equal(result.status, 'badge-eligible');
});

test('series eligibility remains first-catalogue-seen based', () => {
  const result = classifyTitle({
    id: 'tt1234567', type: 'series', name: 'New series',
    catalogAddedAt: '2026-11-22T08:00:00+04:00',
    poster: 'https://example.test/poster.jpg?badge=just-added'
  }, new Date('2026-11-23T08:00:00Z'));
  assert.equal(result.status, 'badge-eligible');
});

test('a Just Added marker is detected from either metadata or poster query', () => {
  assert.equal(hasJustAddedBadge({ justAdded: true }), true);
  assert.equal(hasJustAddedBadge({ poster: 'https://example.test/poster.jpg?badge=just-added' }), true);
  assert.equal(hasJustAddedBadge({ poster: 'https://example.test/poster.jpg?v=8' }), false);
});
