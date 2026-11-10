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

    def test_missing_eligible_movie_is_not_guessed(self):
        self.assertIsNone(first_valid([
            {'id':'tmdb:123','type':'movie','poster':'x.jpg','name':'Unmatched'},
            {'id':'tt999','type':'series','poster':'x.jpg','name':'Series'},
        ],'hindi'))

if __name__=='__main__':unittest.main()
