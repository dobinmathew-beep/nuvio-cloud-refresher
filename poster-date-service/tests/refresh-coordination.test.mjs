import test from 'node:test';
import assert from 'node:assert/strict';
import { withRefreshLease, getRefreshLease } from '../lib/refresh-coordination.mjs';

test('refresh coordination falls back to local protection only when Redis is optional', async () => {
  const previousUrl = process.env.REDIS_URL;
  const previousRequired = process.env.REQUIRE_REFRESH_COORDINATION;
  delete process.env.REDIS_URL;
  delete process.env.REQUIRE_REFRESH_COORDINATION;
  try {
    const result = await withRefreshLease(async lease => {
      assert.ok(lease.jobId);
      await lease.assertOwned();
      return 'completed';
    });
    assert.equal(result, 'completed');
    assert.equal(await getRefreshLease(), null);
  } finally {
    if (previousUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = previousUrl;
    if (previousRequired === undefined) delete process.env.REQUIRE_REFRESH_COORDINATION;
    else process.env.REQUIRE_REFRESH_COORDINATION = previousRequired;
  }
});

test('production coordination can fail closed when Redis is required but missing', async () => {
  const previousUrl = process.env.REDIS_URL;
  const previousRequired = process.env.REQUIRE_REFRESH_COORDINATION;
  delete process.env.REDIS_URL;
  process.env.REQUIRE_REFRESH_COORDINATION = 'true';
  try {
    await assert.rejects(
      () => withRefreshLease(async () => 'should-not-run'),
      /REDIS_URL is required/
    );
  } finally {
    if (previousUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = previousUrl;
    if (previousRequired === undefined) delete process.env.REQUIRE_REFRESH_COORDINATION;
    else process.env.REQUIRE_REFRESH_COORDINATION = previousRequired;
  }
});
