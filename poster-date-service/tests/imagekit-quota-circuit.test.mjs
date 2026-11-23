import test from 'node:test';
import assert from 'node:assert/strict';
import { createImageKitQuotaCircuit } from '../lib/imagekit-quota-circuit.mjs';

test('opens after an ImageKit quota-exceeded upload response and expires automatically', () => {
  let now = 1000;
  const circuit = createImageKitQuotaCircuit({ cooldownMs: 500, now: () => now });
  assert.equal(circuit.isOpen(), false);
  assert.equal(circuit.recordFailure(new Error('ImageKit upload failed (403): {"message":"Upload Limit Exceeded"}')), true);
  assert.equal(circuit.isOpen(), true);
  now += 499;
  assert.equal(circuit.isOpen(), true);
  now += 1;
  assert.equal(circuit.isOpen(), false);
});

test('opens for immutable upload 403 without treating unrelated failures as quota failures', () => {
  const circuit = createImageKitQuotaCircuit();
  assert.equal(circuit.recordFailure(new Error('network timeout')), false);
  assert.equal(circuit.recordFailure(new Error('ImageKit immutable poster upload failed (403)')), true);
  assert.equal(circuit.isOpen(), true);
});

test('opens on persistent OCR cache HTTP 403 responses', () => {
  const circuit = createImageKitQuotaCircuit();
  assert.equal(circuit.recordFailure(new Error('Persistent OCR cache upload HTTP 403')), true);
  assert.equal(circuit.isOpen(), true);
});

test('reset closes the circuit', () => {
  const circuit = createImageKitQuotaCircuit();
  circuit.recordFailure(new Error('ImageKit upload failed (403)'));
  assert.equal(circuit.isOpen(), true);
  circuit.reset();
  assert.equal(circuit.isOpen(), false);
});
