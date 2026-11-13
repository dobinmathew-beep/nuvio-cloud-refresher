import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTmdbTvImdbId } from '../lib/tmdb-external-ids.mjs';

test('resolves a TMDB TV ID to a valid IMDb ID', async () => {
  const result = await resolveTmdbTvImdbId('93544', {
    noCache: true,
    credentials: { apiKey: 'test-key', readToken: '' },
    fetch: async (url) => {
      assert.match(String(url), /\\/tv\\/93544\\/external_ids/);
      assert.match(String(url), /api_key=test-key/);
      return { ok: true, json: async () => ({ id: 93544, imdb_id: 'tt1830379' }) };
    }
  });
  assert.equal(result, 'tt1830379');
});

test('uses the verified Top Boy parent IMDb ID when TMDB has no external ID', async () => {
  const result = await resolveTmdbTvImdbId('93544', {
    noCache: true,
    credentials: { apiKey: 'test-key', readToken: '' },
    fetch: async () => ({ ok: true, json: async () => ({ id: 93544, imdb_id: null }) })
  });
  assert.equal(result, 'tt1830379');
});

test('returns null when there is no known fallback and TMDB has no IMDb external ID', async () => {
  const result = await resolveTmdbTvImdbId('123456', {
    noCache: true,
    credentials: { apiKey: 'test-key', readToken: '' },
    fetch: async () => ({ ok: true, json: async () => ({ id: 123456, imdb_id: null }) })
  });
  assert.equal(result, null);
});

test('rejects non-numeric TMDB IDs', async () => {
  await assert.rejects(() => resolveTmdbTvImdbId('tt1830379', {
    credentials: { apiKey: 'test-key', readToken: '' }
  }), /numeric TMDB TV ID/);
});
