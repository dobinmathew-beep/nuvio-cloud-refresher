import unittest
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import update

class ImdbMatchingTests(unittest.TestCase):
    def setUp(self):
        self.original_get = update.get

    def tearDown(self):
        update.get = self.original_get

    def test_episode_suffix_is_removed_before_imdb_lookup(self):
        seen = []
        def fake_get(url):
            seen.append(url)
            return {"d": [{
                "id": "tt1234567", "l": "Nindu Noorella Saavasam",
                "qid": "tvSeries", "y": 2020,
                "i": {"imageUrl": "https://example.test/poster.jpg"}
            }]}
        update.get = fake_get
        result = update.suggestion({
            "name": "Nindu Noorella Saavasam (Episode 885)",
            "language": "telugu", "type": "series", "ottDate": "2026-05-12"
        })
        self.assertEqual(result["id"], "tt1234567")
        self.assertTrue(any("Nindu%20Noorella%20Saavasam" in url for url in seen))

    def test_season_suffix_variant_finds_parent_series(self):
        def fake_get(url):
            if "Koffee%20with%20Karan%209" in url:
                return {"d": []}
            return {"d": [{"id": "tt0445883", "l": "Koffee with Karan",
                           "qid": "tvSeries", "y": 2004}]}
        update.get = fake_get
        result = update.suggestion({
            "name": "Koffee with Karan 9", "language": "hindi",
            "type": "series", "ottDate": "2026-10-28"
        })
        self.assertEqual(result["id"], "tt0445883")

    def test_wrong_imdb_type_is_never_accepted(self):
        update.get = lambda url: {"d": [{"id": "tt1234567", "l": "Example",
                                        "qid": "movie", "y": 2025}]}
        self.assertIsNone(update.suggestion({
            "name": "Example", "language": "tamil", "type": "series",
            "ottDate": "2026-01-01"
        }))

    def test_ambiguous_same_name_imdb_results_are_held_back(self):
        update.get = lambda url: {"d": [
            {"id": "tt1234567", "l": "Pyaar", "qid": "movie", "y": 2024},
            {"id": "tt7654321", "l": "Pyaar", "qid": "movie", "y": 2025}
        ]}
        self.assertIsNone(update.suggestion({
            "name": "Pyaar", "language": "hindi", "type": "movie",
            "ottDate": "2026-11-13"
        }))

    def test_imdb_id_filter_accepts_real_title_ids(self):
        self.assertTrue(update.is_imdb_id("tt1234567"))
        self.assertFalse(update.is_imdb_id("tmdb:123"))
        self.assertFalse(update.is_imdb_id("tt-not-an-id"))

if __name__ == "__main__":
    unittest.main()
