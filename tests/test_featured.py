import unittest
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from featured import first_valid

class FeaturedSelectionTests(unittest.TestCase):
    def test_first_eligible_movie_keeps_catalog_order(self):
        metas=[
            {'id':'tt900','type':'series','poster':'series.jpg','name':'Series'},
            {'id':'tt901','type':'movie','poster':None,'name':'No poster'},
            {'id':'tt902','type':'movie','poster':'promo.jpg','name':'OTT Releases promo'},
            {'id':'tt123','type':'movie','poster':'first.jpg','name':'First in catalog','releaseInfo':'1998'},
            {'id':'tt456','type':'movie','poster':'newer.jpg','name':'Newer release','releaseInfo':'2026'},
        ]
        self.assertEqual(first_valid(metas,'tamil')['id'],'tt123')

    def test_first_tmdb_linked_movie_is_not_skipped_for_a_later_imdb_movie(self):
        metas=[
            {'id':'ir:promo-unlock','type':'movie','poster':'promo.jpg','name':'New Hindi Dubbed Catalog!'},
            {'id':'tmdb:1822586||Mazhalai||2026||movie','type':'movie','poster':'https://image.tmdb.org/t/p/original/mazhalai.jpg','name':'Mazhalai'},
            {'id':'tt18933846','type':'movie','poster':'imdb.jpg','name':'Nooru Kodi Vaanavil'},
        ]
        self.assertEqual(first_valid(metas,'tamil')['id'].split('||',1)[0],'tmdb:1822586')

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
