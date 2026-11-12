import unittest,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import physical,update
class PhysicalTests(unittest.TestCase):
 def test_only_released_physical_rows_qualify(self):
  html='<table class="releases"><h2 class="release" id="GB">United Kingdom</h2><tbody>'
  for day,kind,note in [('01/10/2026','Theatrical',''),('20/10/2026','Physical','Blu-ray'),('01/11/2026','Physical','DVD'),('02/10/2026','Physical',''),('03/10/2026','Physical','VHS')]:html+='<tr>'+''.join('<td>'+x+'</td>' for x in [day,'',kind,'',note])+'</tr>'
  editions=physical.releases(html+'</tbody></table>','2026-10-30');self.assertEqual(len(editions),1);self.assertEqual(editions[0]['format'],'Blu-ray');self.assertEqual(editions[0]['region'],'GB')
 def test_disc_without_ott_qualifies_and_does_not_invent_digital_release(self):
  e={'name':'Example','type':'movie','language':'tamil','ottDate':'2026-10-20','releaseKind':'physical','sources':['https://www.themoviedb.org/movie/1/releases'],'platforms':['Blu-ray']}
  out=physical.merge_events([e],update.norm)[0];self.assertEqual(out['releaseKind'],'physical');self.assertEqual([x['kind'] for x in out['availability']],['physical'])
 def test_physical_premiere_can_precede_ott_without_duplicate(self):
  e={'name':'Example','type':'movie','language':'tamil','ottDate':'2026-10-20','releaseKind':'physical','sources':['disc'],'platforms':['Blu-ray']};d=dict(e,ottDate='2026-10-29',releaseKind='digital',sources=['ott'],platforms=['Netflix'])
  out=physical.merge_events([d,e],update.norm);self.assertEqual(len(out),1);self.assertEqual(out[0]['ottDate'],'2026-10-20');self.assertEqual({x['kind'] for x in out[0]['availability']},{'physical','digital'})

 def test_future_digital_date_wins_over_old_digital_availability(self):
  old={'name':'Bandra','type':'movie','language':'malayalam','ottDate':'2023-11-10','releaseKind':'digital','sources':['old'],'platforms':['Old platform']}
  future={'name':'Bandra','type':'movie','language':'malayalam','ottDate':'2026-11-13','releaseKind':'digital','sources':['upcoming'],'platforms':['ZEE5']}
  out=physical.merge_events([old,future],update.norm,'2026-11-12')[0]
  self.assertEqual(out['ottDate'],'2026-11-13')
  self.assertEqual({x['date'] for x in out['availability']},{'2023-11-10','2026-11-13'})
  self.assertEqual(update.event_digital_date(out,'2026-11-12'),'2026-11-13')
 def test_digital_arrival_is_labeled_even_when_the_theatrical_release_is_old(self):
  e={'type':'movie','releaseKind':'digital','ottDate':'2026-11-13','availability':[{'kind':'digital','date':'2026-11-13'}]}
  m={'releaseInfo':'2023','releaseDate':'2023-11-10'}
  label,original,digital=update.release_classification(e,m)
  self.assertEqual(label,'New OTT arrival')
  self.assertEqual(original,'2023-11-10')
  self.assertEqual(digital,'2026-11-13')
 def test_physical_only_movie_is_not_mislabeled_as_ott_arrival(self):
  e={'type':'movie','releaseKind':'physical','ottDate':'2023-12-01','availability':[{'kind':'physical','date':'2023-12-01'}]}
  label,original,digital=update.release_classification(e,{'releaseInfo':'2023'})
  self.assertEqual(label,'New physical release')
  self.assertIsNone(digital)
 def test_movie_sorting_uses_ott_arrival_date_when_available(self):
  item={'type':'movie','releaseDate':'2023-11-10','ottDate':'2026-11-13'}
  self.assertEqual(update.catalog_sort_date(item),'2026-11-13')

if __name__=='__main__':unittest.main()
