import unittest
from datetime import datetime,timedelta
from refresh_watchdog import due,fresh,may_dispatch,ZONE

class WatchdogTests(unittest.TestCase):
    def test_late_start_catches_up_todays_missed_cycle(self):
        now=datetime(2026,11,2,11,30,tzinfo=ZONE)
        self.assertEqual(due(now,'media').hour,10)
        self.assertEqual(due(now,'epg').hour,10)
        self.assertFalse(fresh({'checked_utc':'2026-11-01T13:00:00+00:00','matched_ids':642},'epg',due(now,'epg')))
        self.assertTrue(fresh({'checked_utc':'2026-11-02T06:10:00+00:00','matched_ids':642},'epg',due(now,'epg')))
    def test_2pm_is_a_new_cycle_for_every_component(self):
        before=datetime(2026,11,2,13,59,tzinfo=ZONE)
        at=datetime(2026,11,2,14,0,tzinfo=ZONE)
        after=datetime(2026,11,2,14,30,tzinfo=ZONE)
        for kind,morning in [('media',12),('addon',12),('epg',12)]:
            self.assertEqual(due(before,kind).hour,morning)
            self.assertEqual(due(at,kind).hour,14)
            self.assertEqual(due(after,kind).hour,14)
        state={'cycle':'2026-11-02','refresh_cycle':'2026-11-02T12:00:00+04:00','featuredVersion':2,'backdrops':{'ok':True},
            'heroes':{'opening_version':1,'selection_policy':'imdb-catalog-order-v1'}}
        self.assertTrue(fresh(state,'media',due(before,'media')))
        self.assertFalse(fresh(state,'media',due(at,'media')))
        state['refresh_cycle']=due(at,'media').isoformat()
        self.assertTrue(fresh(state,'media',due(at,'media')))
        self.assertFalse(fresh({'checked_utc':'2026-11-02T04:10:00+00:00','matched_ids':642},'epg',due(at,'epg')))
        self.assertTrue(fresh({'checked_utc':'2026-11-02T10:10:00+00:00','matched_ids':642},'epg',due(at,'epg')))
        self.assertFalse(fresh({'lastSuccessCycle':'2026-11-02T06:00:00+04:00'},'addon',due(at,'addon')))
        self.assertTrue(fresh({'lastSuccessCycle':'2026-11-02T14:00:00+04:00'},'addon',due(at,'addon')))
    def test_every_two_hour_boundary_for_all_components(self):
        for kind in ('media','addon','epg'):
            for hour in range(24):
                now=datetime(2026,11,2,hour,59,59,tzinfo=ZONE)
                self.assertEqual(due(now,kind),now.replace(hour=hour//2*2,minute=0,second=0))
            midnight=datetime(2026,11,3,0,0,tzinfo=ZONE)
            self.assertEqual(due(midnight,kind),midnight)
    def test_utc_input_has_same_local_cycle(self):
        now=datetime.fromisoformat('2026-11-02T10:01:00+00:00')
        self.assertEqual(due(now,'media').isoformat(),'2026-11-02T14:00:00+04:00')
    def test_media_partial_success_is_not_fresh(self):
        self.assertFalse(fresh({'cycle':'2026-11-02','backdrops':{'ok':True}},'media',datetime(2026,11,2,6,tzinfo=ZONE)))
    def test_no_duplicate_or_runaway_dispatch(self):
        now=datetime(2026,11,2,11,30,tzinfo=ZONE)
        self.assertFalse(may_dispatch([{'status':'in_progress','created_at':(now-timedelta(hours=2)).isoformat()}],now))
        self.assertFalse(may_dispatch([{'status':'completed','created_at':(now-timedelta(minutes=5)).isoformat()}],now))
        self.assertFalse(may_dispatch([{'status':'completed','created_at':(now-timedelta(minutes=9)).isoformat()}],now))
        self.assertTrue(may_dispatch([{'status':'completed','created_at':(now-timedelta(minutes=10)).isoformat()}],now))
        self.assertTrue(may_dispatch([{'status':'completed','created_at':(now-timedelta(minutes=50)).isoformat()}],now))

if __name__=='__main__':unittest.main()
