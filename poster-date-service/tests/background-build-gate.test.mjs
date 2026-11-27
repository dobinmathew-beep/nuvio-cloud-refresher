import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackgroundBuildGate } from '../lib/background-build-gate.mjs';

test('background build gate suppresses repeat work until cooldown expires', () => {
  let now = 1000;
  const allow = createBackgroundBuildGate({ ttlMs: 500, now: () => now });
  assert.equal(allow('tt1234567'), true);
  assert.equal(allow('tt1234567'), false);
  now += 499;
  assert.equal(allow('tt1234567'), false);
  now += 1;
  assert.equal(allow('tt1234567'), true);
});

test('background build gate isolates IDs and rejects empty keys', () => {
  const allow = createBackgroundBuildGate();
  assert.equal(allow(''), false);
  assert.equal(allow('tt1234567'), true);
  assert.equal(allow('tt7654321'), true);
});

test('background build gate bounds retained keys', () => {
  let now = 1;
  const allow = createBackgroundBuildGate({ ttlMs: 1000, maxEntries: 2, now: () => now++ });
  assert.equal(allow('a'), true);
  assert.equal(allow('b'), true);
  assert.equal(allow('c'), true);
  // The oldest key was evicted to keep memory bounded.
  assert.equal(allow('a'), true);
});
