import unittest

from verify_independent import first_catalog_movie


class IndependentBackdropPolicyTests(unittest.TestCase):
    def test_first_tmdb_movie_precedes_later_imdb_movie_in_raw_catalog_order(self):
        metas = [
            {"id": "ir:promo-unlock", "type": "movie", "poster": "promo.jpg", "name": "Hindi Dubbed Catalog"},
            {
                "id": "tmdb:1822586||Mazhalai||2026||movie",
                "type": "movie",
                "poster": "mazhalai.jpg",
                "name": "Mazhalai",
            },
            {"id": "tt18933846", "type": "movie", "poster": "nooru.jpg", "name": "Nooru Kodi Vaanavil"},
            {"id": "tt39239818", "type": "movie", "poster": "haiku.jpg", "name": "Haiku"},
        ]
        self.assertEqual(
            first_catalog_movie(metas),
            {"id": "tmdb:1822586", "name": "Mazhalai"},
        )

    def test_catalog_order_is_preserved_for_imdb_entries(self):
        metas = [
            {"id": "tt9000001", "type": "movie", "poster": "first.jpg", "name": "First"},
            {"id": "tt9000002", "type": "movie", "poster": "second.jpg", "name": "Second"},
        ]
        self.assertEqual(first_catalog_movie(metas)["id"], "tt9000001")

    def test_tmdb_only_catalog_can_supply_backdrop_centre(self):
        metas = [
            {"id": "tmdb:1822586", "type": "movie", "poster": "mazhalai.jpg", "name": "Mazhalai"},
            {"id": "tmdb:1806311", "type": "movie", "poster": "thedal.jpg", "name": "THEDAL"},
        ]
        self.assertEqual(
            first_catalog_movie(metas),
            {"id": "tmdb:1822586", "name": "Mazhalai"},
        )

    def test_promotional_non_movie_and_missing_poster_entries_are_skipped(self):
        metas = [
            {"id": "ir:promo-unlock", "type": "movie", "poster": "promo.jpg", "name": "Hindi Dubbed Catalog"},
            {"id": "tmdb:123", "type": "series", "poster": "series.jpg", "name": "Series"},
            {"id": "tt1234567", "type": "movie", "poster": None, "name": "No poster"},
            {"id": "tt7654321", "type": "movie", "poster": "promo.jpg", "name": "OTT Releases promo"},
            {"id": "tt9000001", "type": "movie", "poster": "valid.jpg", "name": "Valid Movie"},
        ]
        self.assertEqual(
            first_catalog_movie(metas),
            {"id": "tt9000001", "name": "Valid Movie"},
        )

    def test_no_poster_backed_real_movie_fails_closed(self):
        metas = [
            {"id": "ir:promo-unlock", "type": "movie", "poster": "promo.jpg", "name": "Promotional unlock"},
            {"id": "tmdb:123", "type": "series", "poster": "series.jpg", "name": "Series"},
            {"id": "tt1234567", "type": "movie", "poster": None, "name": "No poster"},
        ]
        with self.assertRaises(AssertionError):
            first_catalog_movie(metas)


if __name__ == "__main__":
    unittest.main()
