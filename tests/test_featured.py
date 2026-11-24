import unittest
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from featured import first_valid, valid_id

class FeaturedSelectionTests(unittest.TestCase):
    # Backdrop centres accept real IMDb- and TMDB-linked movies in source order.
    def test_featured_id_validation_accepts_imdb_and_tmdb_ids(self):
        self.assertTrue(valid_id('tt1234567'))
        self.assertTrue(valid_id('tmdb:1822586'))
        self.assertFalse(valid_id('ir:promo-unlock'))
        self.assertFalse(valid_id('tmdb:'))

    def test_first_eligible_movie_keeps_catalog_order(self):
        metas=[
            {'id':'tt900','type':'series','poster':'series.jpg','name':'Series'},
            {'id':'tt901','type':'movie','poster':None,'name':'No poster'},
            {'id':'tt902','type':'movie','poster':'promo.jpg','name':'OTT Releases promo'},
            {'id':'tt123','type':'movie','poster':'first.jpg','name':'First in catalog','releaseInfo':'1998'},
            {'id':'tt456','type':'movie','poster':'newer.jpg','name':'Newer release','releaseInfo':'2026'},
        ]
        self.assertEqual(first_valid(metas,'tamil')['id'],'tt123')

    def test_first_tmdb_movie_precedes_later_imdb_movie_in_catalog_order(self):
        metas=[
            {'id':'ir:promo-unlock','type':'movie','poster':'promo.jpg','name':'New Hindi Dubbed Catalog!'},
            {'id':'tmdb:1822586||Mazhalai||2026||movie','type':'movie','poster':'https://image.tmdb.org/t/p/original/mazhalai.jpg','name':'Mazhalai'},
            {'id':'tt18933846','type':'movie','poster':'imdb.jpg','name':'Nooru Kodi Vaanavil'},
            {'id':'tmdb:1806311||THEDAL||2026||movie','type':'movie','poster':'thedal.jpg','name':'THEDAL'},
            {'id':'tt39239818','type':'movie','poster':'haiku.jpg','name':'Haiku'},
        ]
        self.assertEqual(first_valid(metas,'tamil')['id'].split('||',1)[0],'tmdb:1822586')

    def test_tmdb_only_catalog_can_supply_first_center(self):
        self.assertEqual(first_valid([
            {'id':'tmdb:1822586','type':'movie','poster':'mazhalai.jpg','name':'Mazhalai'},
            {'id':'tmdb:1806311','type':'movie','poster':'thedal.jpg','name':'THEDAL'},
        ],'tamil')['id'],'tmdb:1822586')

    def test_promotional_and_non_movie_entries_are_skipped(self):
        self.assertIsNone(first_valid([
            {'id':'ir:promo-unlock','type':'movie','poster':'promo.jpg','name':'Hindi Dubbed Catalog'},
            {'id':'tmdb:123','type':'series','poster':'series.jpg','name':'Series'},
            {'id':'tmdb:124','type':'movie','poster':None,'name':'No poster'},
        ],'telugu'))

    def test_missing_eligible_movie_is_not_guessed(self):
        self.assertIsNone(first_valid([
            {'id':'tt999','type':'series','poster':'x.jpg','name':'Series'},
            {'id':'tt998','type':'movie','poster':'x.jpg','name':'OTT Releases promo'},
        ],'hindi'))

if __name__=='__main__':unittest.main()
