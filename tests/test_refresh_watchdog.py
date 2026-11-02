import unittest
from datetime import datetime,timedelta
from refresh_watchdog import due,fresh,may_dispatch,ZONE

class WatchdogTests(unittest.TestCase):
    def test_late_start_catches_up_todays_missed_cycle(self):
        now=datetime(2026,11,2,11,30,tzinfo=ZONE)
        self.assertEqual(due(now,'media').hour,6)
        self.assertEqual(due(now,'epg').hour,8)
        self.assertFalse(fresh({'checked_utc':'2026-11-01T13:00:00+00:00','matched_ids':642},'epg',due(now,'epg')))
        self.assertTrue(fresh({'checked_utc':'2026-11-02T04:10:00+00:00','matched_ids':642},'epg',due(now,'epg')))
    def test_before_due_uses_previous_day(self):
        self.assertEqual(due(datetime(2026,11,2,7,tzinfo=ZONE),'epg').day,1)
    def test_addon_evening_and_extra_weekend_cycles(self):
        self.assertEqual(due(datetime(2026,11,5,2,tzinfo=ZONE),'addon').hour,1)
        self.assertEqual(due(datetime(2026,11,2,20,tzinfo=ZONE),'addon').hour,18)
    def test_media_partial_success_is_not_fresh(self):
        self.assertFalse(fresh({'cycle':'2026-11-02','backdrops':{'ok':True}},'media',datetime(2026,11,2,6,tzinfo=ZONE)))
    def test_no_duplicate_or_runaway_dispatch(self):
        now=datetime(2026,11,2,11,30,tzinfo=ZONE)
        self.assertFalse(may_dispatch([{'status':'in_progress','created_at':(now-timedelta(hours=2)).isoformat()}],now))
        self.assertFalse(may_dispatch([{'status':'completed','created_at':(now-timedelta(minutes=10)).isoformat()}],now))
        self.assertTrue(may_dispatch([{'status':'completed','created_at':(now-timedelta(minutes=50)).isoformat()}],now))

if __name__=='__main__':unittest.main()
