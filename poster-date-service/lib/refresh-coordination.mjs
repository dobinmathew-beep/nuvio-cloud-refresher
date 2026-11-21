import { randomUUID } from 'node:crypto';
import { createClient } from 'redis';

const LEASE_KEY = 'great-indian:catalog-refresh:lease';
const LEASE_TTL_MS = 45_000;
const HEARTBEAT_MS = 10_000;
let clientPromise;

async function redisClient() {
  const url = String(process.env.REDIS_URL || '').trim();
  if (!url) {
    if (process.env.REQUIRE_REFRESH_COORDINATION === 'true') {
      throw new Error('REDIS_URL is required for safe catalogue refresh coordination');
    }
    return null;
  }
  if (!clientPromise) {
    const client = createClient({
      url,
      socket: {
        connectTimeout: 5000,
        reconnectStrategy: retries => Math.min(250 * retries, 2000)
      }
    });
    client.on('error', error => console.error('[refresh-redis-error]', error?.message || error));
    clientPromise = client.connect().then(() => client).catch(error => {
      clientPromise = null;
      throw new Error('Could not connect to the refresh coordination store: ' + (error?.message || error));
    });
  }
  return clientPromise;
}

function parseLease(raw) {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

export async function getRefreshLease() {
  const client = await redisClient();
  if (!client) return null;
  return parseLease(await client.get(LEASE_KEY));
}

export async function withRefreshLease(task) {
  const client = await redisClient();
  if (!client) {
    console.warn('[refresh-coordination-disabled] REDIS_URL is not configured; using process-local protection only');
    return task({ jobId: randomUUID(), assertOwned: async () => {} });
  }

  const token = randomUUID();
  const jobId = randomUUID();
  const leaseValue = JSON.stringify({ token, jobId, startedAt: new Date().toISOString() });
  const acquired = await client.set(LEASE_KEY, leaseValue, { NX: true, PX: LEASE_TTL_MS });
  if (acquired !== 'OK') {
    const existing = await getRefreshLease();
    return { status: 'already-running', jobId: existing?.jobId || null };
  }

  let leaseLost = false;
  const heartbeat = setInterval(async () => {
    try {
      const renewed = await client.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end",
        { keys: [LEASE_KEY], arguments: [leaseValue, String(LEASE_TTL_MS)] }
      );
      if (Number(renewed) !== 1) leaseLost = true;
    } catch (error) {
      leaseLost = true;
      console.error('[refresh-lease-heartbeat-failed]', error?.message || error);
    }
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  const assertOwned = async () => {
    if (leaseLost) throw new Error('Catalogue refresh coordination lease was lost; stopping before further durable writes');
    const current = parseLease(await client.get(LEASE_KEY));
    if (!current || current.token !== token) {
      leaseLost = true;
      throw new Error('Catalogue refresh coordination lease is no longer owned by this worker');
    }
  };

  try {
    return await task({ jobId, assertOwned });
  } finally {
    clearInterval(heartbeat);
    try {
      await client.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        { keys: [LEASE_KEY], arguments: [leaseValue] }
      );
    } catch (error) {
      console.error('[refresh-lease-release-failed]', error?.message || error);
    }
  }
}


const PROGRESS_KEY = 'great-indian:catalog-refresh:progress';
const PROGRESS_TTL_MS = 30 * 60 * 1000;

export async function publishRefreshProgress(jobId, progress) {
  const client = await redisClient();
  if (!client) return false;
  const lease = await getRefreshLease();
  if (!lease || lease.jobId !== jobId) return false;
  await client.set(PROGRESS_KEY, JSON.stringify({ jobId, progress }), { PX: PROGRESS_TTL_MS });
  return true;
}

export async function getRefreshProgress(jobId) {
  const client = await redisClient();
  if (!client) return null;
  const raw = await client.get(PROGRESS_KEY);
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw);
    return saved?.jobId === jobId && saved.progress && typeof saved.progress === 'object'
      ? saved.progress : null;
  } catch {
    return null;
  }
}
