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
if __name__=='__main__':unittest.main()
