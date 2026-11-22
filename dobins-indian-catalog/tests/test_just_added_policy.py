import sys
import unittest
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import update

NOW = datetime(2026, 11, 23, 12, 0, tzinfo=ZoneInfo("Asia/Muscat"))


class JustAddedPolicyTests(unittest.TestCase):
    def test_first_verified_digital_arrival_wins_over_later_platform_dates(self):
        event = {
            "type": "movie",
            "releaseKind": "digital",
            "ottDate": "2026-11-21",
            "availability": [
                {"kind": "digital", "date": "2013-01-01", "platform": "Netflix"},
                {"kind": "digital", "date": "2026-11-21", "platform": "Prime Video"},
                {"kind": "physical", "date": "2026-11-22", "platform": "Blu-ray"},
            ],
        }
        self.assertEqual(update.event_digital_date(event, "2026-11-23"), "2013-01-01")
        self.assertEqual(update.recent_release_audit_date(event), "2013-01-01")
        self.assertFalse(update.is_just_added_title(event, NOW, NOW))

    def test_race_2_sholay_and_vada_chennai_do_not_requalify_on_later_platform_additions(self):
        # Synthetic date fixtures: these are not claims about each film's exact OTT debut.
        examples = {
            "tt1375789": ("2019-01-01", "2026-11-20"),
            "tt0073707": ("2020-01-01", "2026-11-19"),
            "tt5959980": ("2018-01-01", "2026-11-18"),
        }
        for imdb_id, (first_arrival, later_platform_arrival) in examples.items():
            with self.subTest(imdb_id=imdb_id):
                event = {
                    "type": "movie",
                    "releaseKind": "digital",
                    "ottDate": later_platform_arrival,
                    "availability": [
                        {"kind": "digital", "date": first_arrival},
                        {"kind": "digital", "date": later_platform_arrival},
                    ],
                }
                self.assertEqual(update.event_digital_date(event, "2026-11-23"), first_arrival)
                self.assertEqual(update.recent_release_audit_date(event), first_arrival)
                self.assertFalse(update.is_just_added_title(event, NOW, NOW))

    def test_a_genuinely_new_first_digital_arrival_qualifies_for_fourteen_days(self):
        event = {
            "type": "movie",
            "releaseKind": "digital",
            "ottDate": "2026-11-20",
            "availability": [{"kind": "digital", "date": "2026-11-20"}],
        }
        self.assertTrue(update.is_just_added_title(event, NOW, NOW))
        self.assertEqual(update.recent_release_audit_date(event), "2026-11-20")

    def test_theatrical_or_physical_only_events_never_qualify_as_just_added(self):
        event = {
            "type": "movie",
            "releaseKind": "physical",
            "ottDate": "2026-11-22",
            "availability": [{"kind": "physical", "date": "2026-11-22"}],
        }
        self.assertIsNone(update.event_digital_date(event, "2026-11-23"))
        self.assertFalse(update.is_just_added_title(event, NOW, NOW))

    def test_first_seen_index_keeps_series_history_and_prunes_legacy_movie_keys(self):
        index = {
            "dobins_hi_movie|tt0073707": "2026-11-19T19:06:30+04:00",
            "dobins_ta_movie|tt5959980": "2026-11-19T19:06:30+04:00",
            "dobins_hi_series|tt1111111": "2025-01-01T00:00:00+04:00",
            "dobins_ta_series|tmdb:123": "2024-01-01T00:00:00+04:00",
            "dobins_ml_series|tvmaze:456": "2023-01-01T00:00:00+04:00",
        }
        self.assertEqual(update.filter_series_added_index(index), {
            "dobins_hi_series|tt1111111": "2025-01-01T00:00:00+04:00",
            "dobins_ta_series|tmdb:123": "2024-01-01T00:00:00+04:00",
            "dobins_ml_series|tvmaze:456": "2023-01-01T00:00:00+04:00",
        })

    def test_first_seen_index_is_series_only_and_requires_a_prior_catalog_snapshot(self):
        prior = {"dobins_hi_series": {"tt1111111"}}
        added = {}
        self.assertFalse(update.should_stamp_catalog_first_seen(
            "dobins_hi_movie", "movie", "tt0073707", {}, added
        ))
        self.assertFalse(update.should_stamp_catalog_first_seen(
            "dobins_hi_series", "series", "tt2222222", {}, added
        ))
        self.assertTrue(update.should_stamp_catalog_first_seen(
            "dobins_hi_series", "series", "tt2222222", prior, added
        ))
        added["dobins_hi_series|tt2222222"] = "2026-11-20T00:00:00+04:00"
        self.assertFalse(update.should_stamp_catalog_first_seen(
            "dobins_hi_series", "series", "tt2222222", prior, added
        ))


if __name__ == "__main__":
    unittest.main()
