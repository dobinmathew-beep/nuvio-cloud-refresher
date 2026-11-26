import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from featured import first_valid, valid, valid_id, valid_center_id, valid_backdrop_center_id


class FeaturedSelectionTests(unittest.TestCase):
    def test_general_metadata_id_validation_accepts_imdb_and_tmdb(self):
        self.assertTrue(valid_id('tt1234567'))
        self.assertTrue(valid_id('tmdb:1822586'))
        self.assertFalse(valid_id('ir:promo-unlock'))
        self.assertFalse(valid_id('tmdb:'))

    def test_backdrop_and_reel_centre_eligibility_is_imdb_only(self):
        self.assertTrue(valid_center_id('tt18933846'))
        self.assertFalse(valid_center_id('tmdb:1822586'))
        self.assertTrue(valid_backdrop_center_id('tt18933846'))
        self.assertFalse(valid_backdrop_center_id('tmdb:1822586'))
        self.assertFalse(valid_backdrop_center_id('ir:promo-unlock'))

    def test_first_eligible_imdb_movie_keeps_catalog_order_not_release_date(self):
        metas = [
            {'id': 'tt900', 'type': 'series', 'poster': 'series.jpg', 'name': 'Series'},
            {'id': 'tt901', 'type': 'movie', 'poster': None, 'name': 'No poster'},
            {'id': 'tt902', 'type': 'movie', 'poster': 'promo.jpg', 'name': 'OTT Releases promo'},
            {'id': 'tt123', 'type': 'movie', 'poster': 'first.jpg', 'name': 'First in catalog', 'releaseInfo': '1998'},
            {'id': 'tt456', 'type': 'movie', 'poster': 'newer.jpg', 'name': 'Newer release', 'releaseInfo': '2026'},
        ]
        self.assertEqual(first_valid(metas, 'tamil')['id'], 'tt123')

    def test_tmdb_only_movie_does_not_displace_first_imdb_centre(self):
        metas = [
            {'id': 'ir:promo-unlock', 'type': 'movie', 'poster': 'promo.jpg', 'name': 'New Hindi Dubbed Catalog!'},
            {'id': 'tmdb:1822586||Mazhalai||2026||movie', 'type': 'movie', 'poster': 'mazhalai.jpg', 'name': 'Mazhalai'},
            {'id': 'tt18933846', 'type': 'movie', 'poster': 'imdb.jpg', 'name': 'Nooru Kodi Vaanavil'},
            {'id': 'tmdb:1806311||THEDAL||2026||movie', 'type': 'movie', 'poster': 'thedal.jpg', 'name': 'THEDAL'},
            {'id': 'tt39239818', 'type': 'movie', 'poster': 'haiku.jpg', 'name': 'Haiku'},
        ]
        self.assertEqual(first_valid(metas, 'tamil')['id'].split('||', 1)[0], 'tt18933846')

    def test_tmdb_composite_movie_is_not_eligible_for_backdrop_centre(self):
        self.assertFalse(valid({
            'id': 'tmdb:1822586||Mazhalai||2026||movie',
            'type': 'movie',
            'poster': 'https://image.tmdb.org/t/p/original/mazhalai.jpg',
            'name': 'Mazhalai',
        }, 'tamil'))

    def test_tmdb_only_catalog_cannot_supply_backdrop_centre(self):
        self.assertIsNone(first_valid([
            {'id': 'tmdb:1822586', 'type': 'movie', 'poster': 'mazhalai.jpg', 'name': 'Mazhalai'},
            {'id': 'tmdb:1806311', 'type': 'movie', 'poster': 'thedal.jpg', 'name': 'THEDAL'},
        ], 'tamil'))

    def test_promotional_and_non_movie_entries_are_skipped(self):
        self.assertIsNone(first_valid([
            {'id': 'ir:promo-unlock', 'type': 'movie', 'poster': 'promo.jpg', 'name': 'Hindi Dubbed Catalog'},
            {'id': 'tmdb:123', 'type': 'series', 'poster': 'series.jpg', 'name': 'Series'},
            {'id': 'tt124', 'type': 'movie', 'poster': None, 'name': 'No poster'},
        ], 'telugu'))

    def test_missing_eligible_movie_is_not_guessed(self):
        self.assertIsNone(first_valid([
            {'id': 'tt999', 'type': 'series', 'poster': 'x.jpg', 'name': 'Series'},
            {'id': 'tt998', 'type': 'movie', 'poster': 'x.jpg', 'name': 'OTT Releases promo'},
            {'id': 'tmdb:997', 'type': 'movie', 'poster': 'x.jpg', 'name': 'TMDB only'},
        ], 'hindi'))


if __name__ == '__main__':
    unittest.main()
