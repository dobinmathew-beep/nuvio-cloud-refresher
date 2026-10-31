import unittest,json,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import alternate,update
class AlternateTests(unittest.TestCase):
 def test_namespaces_prevent_movie_series_collisions(self):
  self.assertNotEqual(alternate.key('movie','tmdb:12'),alternate.key('series','tmdb:12'))
  self.assertEqual(alternate.key('movie','tt1234567'),'tt1234567')
 def test_series_season_title_recovers_imdb_and_episodes(self):
  e={'name':'Example Season 2','language':'tamil','type':'series','ottDate':'2026-10-30'}
  show={'id':12,'name':'Example','language':'Tamil','premiered':'2021-01-01','externals':{'imdb':'tt1234567'},'image':{'original':'https://static.tvmaze.com/a.jpg'},'url':'https://www.tvmaze.com/shows/12/example'}
  def get(u,*a):return [{'show':show}] if '/search/' in u else [{'name':'Pilot','season':1,'number':1,'airdate':'2021-01-01'}]
  m=alternate.tvmaze(e,get,update.norm);self.assertEqual(m['id'],'tt1234567');self.assertEqual(m['videos'][0]['id'],'tt1234567:1:1')
  show['language']='Hindi';self.assertIsNone(alternate.tvmaze(e,get,update.norm))
 def test_tmdb_identity_and_future_date_are_verified(self):
  e={'name':'Example','language':'tamil','type':'movie','ottDate':'2026-10-30','sourceRecord':{'tmdbId':12}}
  obj={'@type':'Movie','name':'Example','url':'https://www.themoviedb.org/movie/12','image':'https://image.tmdb.org/t/p/w500/a.jpg','releasedEvent':[{'startDate':'2026-10-01'}]}
  def get(*a):return '<script type="application/ld+json">'+json.dumps(obj)+'</script>'
  self.assertEqual(alternate.tmdb(e,get,update.norm)['id'],'tmdb:12')
  obj['url']='https://www.themoviedb.org/movie/12-example';self.assertEqual(alternate.tmdb(e,get,update.norm)['id'],'tmdb:12')
  obj['url']='https://www.themoviedb.org/movie/123-example';self.assertIsNone(alternate.tmdb(e,get,update.norm))
  obj['url']='https://www.themoviedb.org/movie/12-example'
  obj['name']='Other Movie';self.assertIsNone(alternate.tmdb(e,get,update.norm))
  obj['name']='Example';obj['releasedEvent'][0]['startDate']='2027-01-01';self.assertIsNone(alternate.tmdb(e,get,update.norm))
if __name__=='__main__':unittest.main()
