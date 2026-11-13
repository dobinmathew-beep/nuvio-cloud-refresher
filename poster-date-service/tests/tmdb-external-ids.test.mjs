import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTmdbTvImdbId } from '../lib/tmdb-external-ids.mjs';

test('resolves the known Top Boy Netflix TMDB ID without external API credentials', async () => {
  const result = await resolveTmdbTvImdbId('93544', {
    fetch: async () => { throw new Error('Known mapping should not call TMDB'); }
  });
  assert.equal(result, 'tt1830379');
});

test('resolves an unmapped TMDB TV ID through the external IDs API', async () => {
  const result = await resolveTmdbTvImdbId('123456', {
    noCache: true,
    credentials: { apiKey: 'test-key', readToken: '' },
    fetch: async (url) => {
      assert.match(String(url), /\/tv\/123456\/external_ids/);
      assert.match(String(url), /api_key=test-key/);
      return { ok: true, json: async () => ({ id: 123456, imdb_id: 'tt1234567' }) };
    }
  });
  assert.equal(result, 'tt1234567');
});

test('returns null when TMDB has no IMDb external ID', async () => {
  const result = await resolveTmdbTvImdbId('123457', {
    noCache: true,
    credentials: { apiKey: 'test-key', readToken: '' },
    fetch: async () => ({ ok: true, json: async () => ({ id: 123457, imdb_id: null }) })
  });
  assert.equal(result, null);
});

test('rejects non-numeric TMDB IDs', async () => {
  await assert.rejects(() => resolveTmdbTvImdbId('tt1830379', {
    credentials: { apiKey: 'test-key', readToken: '' }
  }), /numeric TMDB TV ID/);
});
