import { randomUUID } from 'node:crypto';

const endpoint = String(process.env.IMAGEKIT_URL_ENDPOINT || '').replace(/\/+$/, '');
if (!endpoint) throw new Error('Missing IMAGEKIT_URL_ENDPOINT secret');

const path = '/catalog-state/durable-queue/741382b785709edc43efd65a4ce0b14b/queue-state.json';
const url = new URL(endpoint + path);
url.searchParams.set('_readonly_queue_check', randomUUID());

const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
if (!response.ok) throw new Error('Queue state read failed with HTTP ' + response.status);
const state = await response.json();
if (!state || state.version !== 1 || !state.scanGeneration || !state.items || typeof state.items !== 'object' || Array.isArray(state.items)) {
  throw new Error('Queue state is missing or malformed; release blocked');
}

const now = Date.now();
const counts = { queued: 0, activeClaims: 0, expiredClaims: 0, recorded: 0, unknown: 0 };
for (const item of Object.values(state.items)) {
  if (!item || typeof item !== 'object') { counts.unknown++; continue; }
  if (item.status === 'queued') counts.queued++;
  else if (item.status === 'recorded') counts.recorded++;
  else if (item.status === 'claimed') {
    if (Date.parse(item.claimExpiresAt || '') > now) counts.activeClaims++;
    else counts.expiredClaims++;
  } else counts.unknown++;
}
const safe = counts.activeClaims === 0 && counts.expiredClaims === 0 && counts.unknown === 0;
const result = {
  status: safe ? 'safe-to-release' : 'blocked',
  mode: 'read-only',
  scanGeneration: state.scanGeneration,
  total: Object.keys(state.items).length,
  counts,
  stateUpdatedAt: state.updatedAt || null,
  checkedAt: new Date(now).toISOString(),
  noQueueWrites: true
};
console.log(JSON.stringify(result));
if (!safe) process.exitCode = 2;
