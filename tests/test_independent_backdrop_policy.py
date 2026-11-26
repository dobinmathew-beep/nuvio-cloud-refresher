import unittest

from verify_independent import first_catalog_movie


class IndependentBackdropPolicyTests(unittest.TestCase):
    def test_tmdb_only_entry_does_not_displace_first_eligible_imdb_movie(self):
        metas = [
            {"id": "ir:promo-unlock", "type": "movie", "poster": "promo.jpg", "name": "Hindi Dubbed Catalog"},
            {"id": "tmdb:1822586||Mazhalai||2026||movie", "type": "movie", "poster": "mazhalai.jpg", "name": "Mazhalai"},
            {"id": "tt18933846", "type": "movie", "poster": "nooru.jpg", "name": "Nooru Kodi Vaanavil"},
            {"id": "tt39239818", "type": "movie", "poster": "haiku.jpg", "name": "Haiku"},
        ]
        self.assertEqual(
            first_catalog_movie(metas),
            {"id": "tt18933846", "name": "Nooru Kodi Vaanavil"},
        )

    def test_catalog_order_is_preserved_among_eligible_imdb_movies(self):
        metas = [
            {"id": "tt9000001", "type": "movie", "poster": "first.jpg", "name": "First"},
            {"id": "tt9000002", "type": "movie", "poster": "second.jpg", "name": "Second"},
        ]
        self.assertEqual(first_catalog_movie(metas)["id"], "tt9000001")

    def test_missing_imdb_movie_fails_closed_even_if_tmdb_entries_exist(self):
        metas = [
            {"id": "tmdb:1822586", "type": "movie", "poster": "mazhalai.jpg", "name": "Mazhalai"},
            {"id": "tt1234567", "type": "series", "poster": "series.jpg", "name": "Series"},
        ]
        with self.assertRaises(AssertionError):
            first_catalog_movie(metas)


if __name__ == "__main__":
    unittest.main()
