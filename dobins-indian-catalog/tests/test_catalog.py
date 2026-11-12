import unittest,sys,tempfile
from pathlib import Path
from datetime import datetime,timedelta,date
from zoneinfo import ZoneInfo
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import update,schedule
class CatalogTests(unittest.TestCase):
 def test_muscat_boundaries(self):
  zone=ZoneInfo('Asia/Muscat')
  cases=[('2026-10-29T00:00:00','2026-10-29T00:00:00+04:00'),('2026-10-29T00:29:59','2026-10-29T00:00:00+04:00'),('2026-10-29T00:30:00','2026-10-29T00:00:00+04:00'),('2026-10-29T01:59:59','2026-10-29T00:00:00+04:00'),('2026-10-29T02:00:00','2026-10-29T02:00:00+04:00'),('2026-10-29T03:59:59','2026-10-29T02:00:00+04:00'),('2026-10-29T04:00:00','2026-10-29T04:00:00+04:00'),('2026-10-30T06:07:00','2026-10-30T06:00:00+04:00'),('2026-10-31T02:44:00','2026-10-31T02:00:00+04:00'),('2026-11-01T23:59:00','2026-11-01T22:00:00+04:00'),('2026-11-02T00:00:00','2026-11-02T00:00:00+04:00')]
  for now,expected in cases:
   instant=datetime.fromisoformat(now).replace(tzinfo=zone)
   self.assertEqual(schedule.due(instant),expected)
   self.assertEqual(update.cycle(instant),expected)
 def test_match_rejects_wrong_kind_language_and_future_year(self):
  event={'name':'Example','language':'tamil','type':'movie','ottDate':'2026-10-30','year':'2026'}
  base={'name':'Example','language':'tamil','type':'movie','id':'tt1234567','releaseInfo':'2026'}
  self.assertIsNone(update.select_candidate(event,[dict(base,type='series')]))
  self.assertIsNone(update.select_candidate(event,[dict(base,language='hindi')]))
  self.assertIsNone(update.select_candidate(event,[dict(base,releaseInfo='2027')]))
  self.assertEqual(update.select_candidate(event,[base])['id'],'tt1234567')
 def test_ambiguous_imdb_matches_are_held(self):
  e={'name':'Example','language':'tamil','type':'movie','ottDate':'2026-10-30'}
  a={'name':'Example','language':'tamil','type':'movie','releaseInfo':'2026','id':'tt1234567'}
  self.assertIsNone(update.select_candidate(e,[a,dict(a,id='tt7654321')]))
 def test_verified_future_dates_are_included_and_unverified_dates_are_excluded(self):
  original_data,original_get,original_source=update.DATA,update.get,update.dailyott
  try:
   with tempfile.TemporaryDirectory() as d:
    update.DATA=Path(d);today=update.TODAY;future=(date.fromisoformat(today)+timedelta(days=1)).isoformat()
    base={'platform':'Netflix','languages':['Tamil'],'type':'Movie','verified':True,'releaseDate':today}
    update.dailyott=lambda:[dict(base,title='Digital'),dict(base,title='Digital',releaseDate=future),dict(base,title='Future',releaseDate=future),dict(base,title='Unverified',verified=False)]
    html='<table class="ott-table--recent">'+''.join('<tr class="ott-row"><td><time datetime="'+today+'"></time></td><td><a class="ott-title">Crosscheck '+str(i)+'</a></td><td class="ott-lang">Tamil</td></tr>' for i in range(6))+'</table>'
    update.get=lambda *a,**k:html
    events,_=update.collect();names={e['name'] for e in events};self.assertIn('Digital',names);self.assertIn('Future',names);self.assertNotIn('Unverified',names);self.assertEqual(next(e for e in events if e['name']=='Digital')['ottDate'],future)
  finally:update.DATA,update.get,update.dailyott=original_data,original_get,original_source
 def test_seasons_share_a_series_identity(self):
  self.assertEqual(update.norm('Example (Season 2)'),update.norm('Example'))
 def test_legacy_series_fallback_deduplicates_corrected_imdb_ids(self):
  current=[{'id':'tt41100531','name':'Kaakee Circus','releaseDate':'2026-04-10'}]
  old=[
   {'id':'tmdb:317896','name':'Kaakee Circus','releaseDate':'2026-04-10'},
   {'id':'tmdb:999999','name':'Older Series','releaseDate':'2020-01-01'},
   {'id':'tmdb:888888','name':'Future Series','releaseDate':'2026-12-01'}
  ]
  result=update.append_legacy_series(current,old,'2026-11-10')
  self.assertEqual([x['name'] for x in result],['Kaakee Circus','Older Series'])
  self.assertEqual(result[0]['id'],'tt41100531')
if __name__=='__main__':unittest.main()
