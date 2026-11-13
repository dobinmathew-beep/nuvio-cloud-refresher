import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceUrl } from '../api/poster.mjs';

test('poster proxy uses the same rating-enabled BetterPosters route as AIOMetadata', () => {
  const ids = ['tt0468569', 'tt0816692', 'tt0499549'];
  for (const id of ids) {
    assert.equal(
      sourceUrl(id),
      'https://btttr.cc/poster-q/imdb/poster-default/' + id + '.jpg?rs=IM'
    );
  }
});
