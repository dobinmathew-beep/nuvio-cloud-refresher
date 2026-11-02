import json, tempfile, unittest
from pathlib import Path
from datetime import datetime
from unittest.mock import patch
from zoneinfo import ZoneInfo
import cloud

class MediaScheduleTests(unittest.TestCase):
    def test_morning_success_does_not_skip_afternoon_and_retry_does_not_repeat_it(self):
        now=datetime(2026,11,2,14,0,tzinfo=ZoneInfo('Asia/Muscat'))
        heroes={'opening_version':1,'selection_policy':'imdb-catalog-order-v1'}
        with tempfile.TemporaryDirectory() as folder:
            state=Path(folder)
            (state/'success.json').write_text(json.dumps({'cycle':'2026-11-02','featuredVersion':2,'backdrops':{'ok':True},'heroes':heroes}))
            with patch.object(cloud,'STATE',state), patch.object(cloud,'datetime') as clock, patch.object(cloud,'bootstrap'), patch.object(cloud,'featured_movies') as featured, patch.object(cloud,'backdrop',return_value={'ok':True}) as backdrop, patch.object(cloud,'heroes',return_value=heroes) as hero:
                clock.now.return_value=now
                self.assertEqual(cloud.main(),0)
                featured.assert_called_once();backdrop.assert_called_once();hero.assert_called_once()
                saved=json.loads((state/'success.json').read_text())
                self.assertEqual(saved['refresh_cycle'],'2026-11-02T14:00:00+04:00')
                self.assertEqual(cloud.main(),0)
                featured.assert_called_once();backdrop.assert_called_once();hero.assert_called_once()

if __name__=='__main__':unittest.main()
