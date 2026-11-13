import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceUrl } from '../api/poster.mjs';

test('poster proxy uses standard BetterPosters route, IMDb ratings, and no quality tag', () => {
  const ids = ['tt0468569', 'tt0816692', 'tt0499549'];
  for (const id of ids) {
    assert.equal(
      sourceUrl(id),
      'https://btttr.cc/poster/imdb/poster-default/' + id + '.jpg?rs=IM'
    );
    assert.doesNotMatch(sourceUrl(id), /poster-q/i);
    assert.match(sourceUrl(id), /[?&]rs=IM$/);
  }
});
