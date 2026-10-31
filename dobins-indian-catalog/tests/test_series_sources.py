import sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import series_sources as s
class SeriesTests(unittest.TestCase):
 def test_release_order_uses_latest_released_episode_not_future_or_modified_date(self):
  m={'released':'2024-01-01','updated':'2026-10-31','videos':[{'released':'2025-12-19'},{'released':'2026-10-15'},{'released':'2027-01-01'}]}
  self.assertEqual(s.latest_release(m,'2026-10-31'),('2026-10-15','episode'))
  self.assertEqual(s.latest_release({'premiered':'2025-08-29'},'2026-10-31'),('2025-08-29','premiere'))
  self.assertEqual(s.latest_release({'released':'2027-01-01'},'2026-10-31'),(None,'premiere'))
 def test_discovery_filters_promotional_and_future_series(self):
  def card(tid,name,date):return f'<div data-object-id="{tid}"><a href="/tv/{tid}"><h2>{name}</h2></a><span class="release_date">{date}</span></div>'
  html=card(1,'Pharma','19 December 2025')+card(2,'Patriot Legends Hangout','23 April 2026')+card(3,'Unreleased','1 January 2027')
  self.assertEqual(set(s.tmdb_rows(html,'2026-10-31')),{'1'})
  legacy='<div class="card style_1"><div class="content"><h2><a href="/tv/243826-pharma">Pharma</a></h2><p>Dec 19, 2025</p></div></div>'
  self.assertEqual(s.tmdb_rows(legacy,'2026-10-31')['243826']['date'],'2025-12-19')
 def test_tvmaze_uses_published_imdb_id_and_episode_identifiers(self):
  m=s.tvmaze_meta({'id':89299,'name':'Pharma','externals':{'imdb':'tt29540636'},'url':'https://tvmaze.com/shows/89299','premiered':'2025-12-19','image':{'original':'poster'}},[{'season':1,'number':1,'name':'Start','airdate':'2025-12-19'}])
  self.assertEqual(m['id'],'tt29540636');self.assertEqual(m['videos'][0]['id'],'tt29540636:1:1')
