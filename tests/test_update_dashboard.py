import json, os, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
from update_dashboard import write_report

class DashboardTests(unittest.TestCase):
 def test_daily_history_survives_new_checks_and_midnight(self):
  with tempfile.TemporaryDirectory() as folder,patch.dict(os.environ,{'GITHUB_RUN_ID':'12','GITHUB_EVENT_NAME':'workflow_dispatch'}):
   root=Path(folder)
   for stamp,state in [('2026-11-02T23:50:00+04:00','check-failed'),('2026-11-02T23:59:00+04:00','fresh'),('2026-11-03T00:01:00+04:00','catch-up-dispatched')]:
    report={'checked_at':stamp,'results':[{'component':k,'due':stamp,'state':state} for k in ('media','addon','epg')],'errors':[]}
    write_report(report,{}, {},root=root)
   self.assertEqual(len((root/'logs/2026-11-02/checks.jsonl').read_text().splitlines()),2)
   self.assertEqual(len((root/'logs/2026-11-03/checks.jsonl').read_text().splitlines()),1)
   self.assertIn('2026-11-02',(root/'logs/README.md').read_text())
   self.assertIn('2026-11-03',(root/'logs/README.md').read_text())
   page=(root/'DAILY_UPDATES.md').read_text()
   self.assertIn('Retry requested',page)
   self.assertNotIn('✅ Updated |',page)
 def test_public_fields_only_and_unresolved_epg_is_visible(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder)
   report={'checked_at':'2026-11-02T18:50:00+04:00','results':[{'component':k,'due':'2026-11-02T18:00:00+04:00','state':'fresh'} for k in ('media','addon','epg')],'errors':['Bad Bearer secretvalue']}
   states={'epg':{'checked_utc':'2026-11-02T14:49:00+00:00','matched_ids':642,'unmatched_ids':['one','two'],'Authorization':'Bearer dont-store'},'addon':{'counts':{'x':3},'sources':[{'source':'Public source','state':'live','headers':{'Authorization':'secret'}}]}}
   write_report(report,states,{'epg':[{'id':123,'status':'completed','conclusion':'success','secret':'not-public'}]},root=root)
   page=(root/'DAILY_UPDATES.md').read_text();log=(root/'logs/2026-11-02/checks.jsonl').read_text()
   self.assertIn('642 / ? channel IDs with listings; 2 unresolved',page)
   self.assertIn('actions/runs/123',page)
   for secret in ('secretvalue','dont-store','not-public','Authorization'):
    self.assertNotIn(secret,log)
   self.assertIn('[redacted]',log)
   self.assertIn('Backdrops',page);self.assertIn('Reels',page)
 def test_missing_source_never_claims_a_success_time(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);report={'checked_at':'2026-11-02T18:50:00+04:00','results':[{'component':'epg','due':'2026-11-02T18:00:00+04:00','state':'check-failed'}],'errors':['EPG source unavailable']}
   write_report(report,{}, {},root=root)
   page=(root/'DAILY_UPDATES.md').read_text()
   self.assertIn('Could not verify',page);self.assertIn('Not recorded',page)
   self.assertIn('EPG source unavailable',page)

if __name__=='__main__':unittest.main()
