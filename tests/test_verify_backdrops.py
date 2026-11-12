import unittest
from datetime import datetime
from zoneinfo import ZoneInfo
from verification_dates import service_day_is_current

ZONE = ZoneInfo('Asia/Muscat')

class MidnightVerificationTests(unittest.TestCase):
    def test_request_straddling_midnight_accepts_either_side(self):
        started = datetime(2026, 11, 12, 23, 59, 59, tzinfo=ZONE)
        finished = datetime(2026, 11, 13, 0, 0, 2, tzinfo=ZONE)
        self.assertTrue(service_day_is_current('2026-11-12', started, finished))
        self.assertTrue(service_day_is_current('2026-11-13', started, finished))

    def test_day_outside_request_window_is_rejected(self):
        started = datetime(2026, 11, 12, 23, 59, 59, tzinfo=ZONE)
        finished = datetime(2026, 11, 13, 0, 0, 2, tzinfo=ZONE)
        self.assertFalse(service_day_is_current('2026-11-11', started, finished))
        self.assertFalse(service_day_is_current('2026-11-14', started, finished))

    def test_request_without_midnight_uses_single_oman_day(self):
        started = datetime(2026, 11, 13, 10, 0, tzinfo=ZONE)
        finished = datetime(2026, 11, 13, 10, 0, 5, tzinfo=ZONE)
        self.assertTrue(service_day_is_current('2026-11-13', started, finished))
        self.assertFalse(service_day_is_current('2026-11-12', started, finished))

if __name__ == '__main__':
    unittest.main()
