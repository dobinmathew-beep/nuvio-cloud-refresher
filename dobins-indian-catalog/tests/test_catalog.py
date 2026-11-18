import unittest,sys,tempfile
from unittest.mock import patch
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
 def test_failed_or_stale_sources_are_retried_on_the_next_half_hour_check(self):
  self.assertTrue(schedule.needs_retry({'sources':[{'state':'failed'}]}))
  self.assertTrue(schedule.needs_retry({'sources':[{'state':'cached'}]}))
  self.assertTrue(schedule.needs_retry({'sources':[{'state':'partial'}]}))
  self.assertTrue(schedule.needs_retry({'errors':['updater failed']}))
  self.assertTrue(schedule.needs_retry({'sources':[]},{'state':'degraded','catalogSummary':{'countMismatches':1}}))
  self.assertFalse(schedule.needs_retry({'sources':[{'state':'live'},{'state':'no_confirmed_upcoming'},{'state':'covered_by_primary_collector'}]}, {'state':'ok','catalogSummary':{'failed':0,'countMismatches':0}}))
 def test_candidate_index_paginates_each_language_and_content_type(self):
  original_get,original_data=update.get,update.DATA
  old_pages=update.os.environ.get('CATALOG_CANDIDATE_PAGES')
  try:
   with tempfile.TemporaryDirectory() as d:
    update.DATA=Path(d)
    update.os.environ['CATALOG_CANDIDATE_PAGES']='3'
    calls=[]
    def fake_get(url):
     calls.append(url)
     cat=url.split('/catalog/')[1].split('/')[1].split('.')[0]
     page=0 if '/skip=' not in url else int(url.split('/skip=')[1].split('.')[0])//20
     base=sum(ord(ch) for ch in cat)%100000
     if page>1:return {'metas':[]}
     start=page*20
     return {'metas':[{'id':f'tt{base+i+1:07d}','name':f'{cat} title {i+1}'} for i in range(start,start+20)]}
    update.get=fake_get
    pool=update.candidate_index()
    self.assertEqual(len(pool),8*40)
    self.assertEqual(len([url for url in calls if '/skip=20' in url]),8)
    self.assertEqual(len([url for url in calls if '/skip=40' in url]),8)
  finally:
   update.get,update.DATA=original_get,original_data
   if old_pages is None:update.os.environ.pop('CATALOG_CANDIDATE_PAGES',None)
   else:update.os.environ['CATALOG_CANDIDATE_PAGES']=old_pages
 def test_verified_title_overrides_correct_type_and_imdb_identity(self):
  events=[
   {'name':'Bal Barbarik','language':'hindi','type':'movie'},
   {'name':'Mirzapur','language':'hindi','type':'movie'},
   {'name':'The Vvaan','language':'hindi','type':'movie'},
   {'name':'Koffee with Karan 9','language':'hindi','type':'series'}
  ]
  update.apply_verified_overrides(events)
  self.assertEqual(events[0]['type'],'series')
  self.assertEqual(events[1]['_verifiedImdbId'],'tt34339725')
  self.assertEqual(events[2]['_verifiedImdbId'],'tt34498564')
  self.assertEqual(events[3]['_verifiedImdbId'],'tt0445883')
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
 def test_malayalam_catalog_audit_requires_verified_id_and_complete_matching_metadata(self):
  catalogs={
   'dobins_ml_movie':[{'id':'tt1234567','type':'movie','name':'Sample Movie'},
                      {'id':'tmdb:123','type':'movie','name':'Sample Film'},
                      {'id':'tvmaze:99','type':'movie','name':'Unverified ID'}],
   'dobins_ml_series':[]
  }
  metadata={
   'tt1234567':{'id':'tt1234567','type':'movie','name':'Sample Movie','poster':'https://img.example/a.jpg','description':'A complete title','original_language':'ml','_partial':False},
   'movie|tmdb:123':{'id':'tmdb:123','type':'movie','name':'Sample Film','poster':'https://img.example/b.jpg','genres':['Drama'],'original_language':'ml','_partial':False}
  }
  summary,errors=update.validate_malayalam_catalogs(catalogs,metadata)
  self.assertEqual(summary['checked'],3)
  self.assertEqual(summary['passed'],2)
  self.assertEqual(summary['failed'],1)
  self.assertIn('require an IMDb or TMDB ID',errors[0]['reason'])

 def test_verified_malayalam_series_overrides_and_wrong_language_exclusion(self):
  events=[
   {'name':'Prince of Mollywood','language':'malayalam','type':'movie'},
   {'name':'Oru Chiri Iru Chiri Bumper Chiri 3','language':'malayalam','type':'series'},
   {'name':'Taarini','language':'malayalam','type':'series'}
  ]
  update.apply_verified_overrides(events)
  self.assertEqual(events[0]['type'],'series')
  self.assertEqual(events[0]['_verifiedImdbId'],'tt44686897')
  self.assertEqual(events[1]['_verifiedImdbId'],'tt43511363')
  self.assertEqual(events[2]['_languageMismatch'],'marathi')

 def test_patriot_legends_hangout_tmdb_override_requires_verified_metadata(self):
  events=[{'name':'Patriot Legends Hangout','language':'malayalam','type':'series'}]
  verified={'id':'tmdb:320606','type':'series','name':'Patriot Legends Hangout','poster':'https://img.example/p.jpg'}
  with patch.object(update.alternate,'tmdb',return_value=verified) as lookup:
   update.apply_verified_overrides(events)
  self.assertEqual(events[0]['_verifiedMetadata'],verified)
  lookup.assert_called_once_with(events[0],update.get,update.norm)
  self.assertEqual(events[0]['sourceRecord']['tmdbId'],320606)

 def test_vi_parser_discovers_future_malayalam_release_but_not_weekly_window(self):
  from bs4 import BeautifulSoup
  html='''<h2>What's New on OTT Platforms This Week</h2><table>
  <tr><th>Movie/Show/Sports</th><th>Platform</th><th>Release Date</th><th>Language</th><th>Genre</th></tr>
  <tr><td>Bigg Boss Season 8</td><td>JioHotstar</td><td>Nov 14-Nov 20, 2026</td><td>Malayalam</td><td>Reality TV</td></tr>
  <tr><td>Premier League</td><td>JioHotstar</td><td>Nov 20, 2026</td><td>Malayalam Commentary</td><td>Sports</td></tr>
  <tr><td>Sample Malayalam Film</td><td>Netflix</td><td>Nov 20, 2026</td><td>Malayalam</td><td>Drama</td></tr>
  <tr><td>Sample Tamil Series Season 2</td><td>Prime Video</td><td>Nov 21, 2026</td><td>Tamil</td><td>Drama</td></tr>
  </table>'''
  rows=update.upcoming_sources._myvi(BeautifulSoup(html,'html.parser'),'Vi','https://www.myvi.in/blog/ott-releases-this-week','2026-11-17',['malayalam','tamil'],update.norm)
  self.assertEqual([(x['name'],x['language'],x['type'],x['ottDate']) for x in rows],[
   ('Sample Malayalam Film','malayalam','movie','2026-11-20'),
   ('Sample Tamil Series Season 2','tamil','series','2026-11-21')
  ])

 def test_simply_mollywood_parser_handles_multilingual_upcoming_entries_and_ignores_tba(self):
  from bs4 import BeautifulSoup
  html='''<h2>Release Calendar</h2>
  <a href="/movie/example">Example Film Netflix 20 Nov 2026 · Malayalam, Tamil</a>
  <a href="/movie/tba">Unannounced Film Netflix Date TBA · Malayalam</a>
  <a href="/movie/past">Already Released Netflix 10 Nov 2026 · Malayalam</a>'''
  rows=update.upcoming_sources._simply_mollywood(BeautifulSoup(html,'html.parser'),'Simply Mollywood','https://simplymollywood.com/ott','2026-11-17',['malayalam','tamil'],update.norm)
  self.assertEqual({(x['name'],x['language'],x['ottDate']) for x in rows},{
   ('Example Film','malayalam','2026-11-20'),('Example Film','tamil','2026-11-20')
  })

 def test_ottasia_sibling_layout_extracts_confirmed_malayalam_title(self):
  from bs4 import BeautifulSoup
  html='''<h2>Upcoming OTT releases in India: confirmed dates</h2>
  <div><p>Sample Malayalam Series</p><p>Series · Malayalam</p><p>from Nov 22, 2026</p></div>
  <h2>Predicted next on OTT</h2>'''
  rows=update.upcoming_sources._ottasia(BeautifulSoup(html,'html.parser'),'OTTASIA','https://ottasia.com/ott-releases-this-week?country=IN','2026-11-17',['malayalam'],update.norm)
  self.assertTrue(any(x['name']=='Sample Malayalam Series' and x['language']=='malayalam' and x['type']=='series' and x['ottDate']=='2026-11-22' for x in rows))

 def test_kasaragod_embassy_spelling_variant_uses_verified_imdb_id(self):
  events=[{'name':'Kasaragod Embassy','language':'malayalam','type':'series'}]
  update.apply_verified_overrides(events)
  self.assertEqual(events[0]['_verifiedImdbId'],'tt40431801')
  self.assertEqual(events[0]['_verifiedImdbName'],'Kasargod Embassy')

 def test_bootstrap_policy_matches_current_catalog_metadata_policy(self):
  root=Path(__file__).resolve().parents[1]
  bootstrap_source=(root/'bootstrap.py').read_text()
  update_source=(root/'update.py').read_text()
  self.assertIn("POLICY='tmdb-tvmaze-v2'",bootstrap_source)
  self.assertIn("'metadataPolicy':'tmdb-tvmaze-v2'",update_source)

if __name__=='__main__':unittest.main()
