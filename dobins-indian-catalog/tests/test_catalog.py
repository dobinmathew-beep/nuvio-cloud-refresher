import unittest,sys,tempfile
from pathlib import Path
from datetime import datetime,timedelta,date
from zoneinfo import ZoneInfo
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import update,schedule
class CatalogTests(unittest.TestCase):
 def test_muscat_boundaries(self):
  zone=ZoneInfo('Asia/Muscat')
  cases=[('2026-10-29T00:59:00','2026-10-28T18:00:00+04:00'),('2026-10-29T01:00:00','2026-10-29T01:00:00+04:00'),('2026-10-30T06:00:00','2026-10-30T06:00:00+04:00'),('2026-10-31T01:00:00','2026-10-31T01:00:00+04:00'),('2026-11-01T01:00:00','2026-10-31T18:00:00+04:00'),('2026-11-01T18:00:00','2026-11-01T18:00:00+04:00')]
  for now,expected in cases:self.assertEqual(schedule.due(datetime.fromisoformat(now).replace(tzinfo=zone)),expected)
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
 def test_future_and_unverified_dates_are_excluded(self):
  original_data,original_get,original_source=update.DATA,update.get,update.dailyott
  try:
   with tempfile.TemporaryDirectory() as d:
    update.DATA=Path(d);today=update.TODAY;future=(date.fromisoformat(today)+timedelta(days=1)).isoformat()
    base={'platform':'Netflix','languages':['Tamil'],'type':'Movie','verified':True,'releaseDate':today}
    update.dailyott=lambda:[dict(base,title='Digital'),dict(base,title='Future',releaseDate=future),dict(base,title='Unverified',verified=False)]
    html='<table class="ott-table--recent">'+''.join('<tr class="ott-row"><td><time datetime="'+today+'"></time></td><td><a class="ott-title">Crosscheck '+str(i)+'</a></td><td class="ott-lang">Tamil</td></tr>' for i in range(6))+'</table>'
    update.get=lambda *a,**k:html
    events,_=update.collect();names={e['name'] for e in events};self.assertIn('Digital',names);self.assertNotIn('Future',names);self.assertNotIn('Unverified',names)
  finally:update.DATA,update.get,update.dailyott=original_data,original_get,original_source
 def test_seasons_share_a_series_identity(self):
  self.assertEqual(update.norm('Example (Season 2)'),update.norm('Example'))
if __name__=='__main__':unittest.main()
