import unittest
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from datetime import datetime, timezone, timedelta
import schedule

class ScheduleRetryTests(unittest.TestCase):
    def test_pending_matches_retry_after_thirty_minutes(self):
        old = (datetime.now(timezone.utc) - timedelta(minutes=31)).isoformat()
        self.assertTrue(schedule.needs_retry({"pendingMatches": 12, "lastMatchRetryAt": old}))

    def test_recent_match_retry_does_not_trigger_early(self):
        recent = datetime.now(timezone.utc).isoformat()
        self.assertFalse(schedule.needs_retry({"pendingMatches": 12, "lastMatchRetryAt": recent}))

    def test_zero_pending_does_not_add_extra_retries(self):
        old = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
        self.assertFalse(schedule.needs_retry({"pendingMatches": 0, "lastMatchRetryAt": old}))

if __name__ == "__main__":
    unittest.main()
