import unittest,sys
from datetime import datetime,timezone
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import episode_badges
class EpisodeBadges(unittest.TestCase):
 def test_released_episodes_only_and_seven_day_expiry(self):
  now=datetime(2026,10,31,12,tzinfo=timezone.utc)
  date,fresh=episode_badges.latest([{'released':'2026-10-30T00:00:00Z'},{'released':'2027-01-01'}],now)
  self.assertTrue(fresh);self.assertTrue(date.startswith('2026-10-30'))
  self.assertEqual(episode_badges.latest([{'released':'2027-01-01'}],now),(None,False))
  self.assertFalse(episode_badges.latest([{'released':'2026-10-20'}],now)[1])
