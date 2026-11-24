import json, tempfile, unittest
from pathlib import Path
from datetime import datetime
from unittest.mock import patch
from zoneinfo import ZoneInfo
import cloud

class MediaScheduleTests(unittest.TestCase):
    def test_refresh_rechecks_catalog_head_without_rerendering_unchanged_media(self):
        now=datetime(2026,11,2,14,0,tzinfo=ZoneInfo('Asia/Muscat'))
        heroes={'opening_version':1,'selection_policy':'imdb-catalog-order-v1'}
        with tempfile.TemporaryDirectory() as folder:
            state=Path(folder)
            (state/'success.json').write_text(json.dumps({'cycle':'2026-11-02','featuredVersion':2,'backdrops':{'ok':True},'heroes':heroes}))
            with patch.object(cloud,'STATE',state), patch.object(cloud,'datetime') as clock, patch.object(cloud,'bootstrap'), patch.object(cloud,'featured_movies',return_value={'languages':{
                    'hindi':{'id':'tt100'},'tamil':{'id':'tt101'},
                    'malayalam':{'id':'tt102'},'telugu':{'id':'tt103'}}}) as featured, patch.object(cloud,'backdrop',return_value={'ok':True}) as backdrop, patch.object(cloud,'heroes',return_value=heroes) as hero:
                clock.now.return_value=now
                self.assertEqual(cloud.main(),0)
                featured.assert_called_once();backdrop.assert_called_once();hero.assert_called_once()
                saved=json.loads((state/'success.json').read_text())
                self.assertEqual(saved['refresh_cycle'],'2026-11-02T14:00:00+04:00')
                self.assertEqual(saved['featured_cycle'],'2026-11-02T14:00:00+04:00')
                self.assertEqual(saved['featured_ids'],{'hindi':'tt100','tamil':'tt101','malayalam':'tt102','telugu':'tt103'})
                self.assertEqual(cloud.main(),0)
                self.assertEqual(featured.call_count,2);backdrop.assert_called_once();hero.assert_called_once()


    def test_uploaded_asset_readback_retries_transient_404(self):
        payload=b'hero asset'
        failures=[
            RuntimeError('Download failed: curl: (22) HTTP 404'),
            RuntimeError('Download failed: curl: (22) HTTP 404')
        ]
        def fake_get(url):
            if failures:
                raise failures.pop(0)
            return payload
        with patch.object(cloud,'get',side_effect=fake_get), patch.object(cloud.time,'sleep') as sleep:
            result=cloud.verify_uploaded_asset('https://example.invalid/hero.mp4',cloud.sha(payload),attempts=3)
        self.assertEqual(result,payload)
        self.assertEqual(sleep.call_count,2)
        self.assertEqual([x.args[0] for x in sleep.call_args_list],[5,10])

    def test_uploaded_asset_readback_fails_closed_after_repeated_404(self):
        with patch.object(cloud,'get',side_effect=RuntimeError('Download failed: curl: (22) HTTP 404')), patch.object(cloud.time,'sleep') as sleep:
            with self.assertRaisesRegex(RuntimeError,'remained unavailable'):
                cloud.verify_uploaded_asset('https://example.invalid/hero.mp4','0'*64,attempts=3)
        self.assertEqual(sleep.call_count,2)

    def test_uploaded_asset_readback_rejects_wrong_hash_without_retry(self):
        with patch.object(cloud,'get',return_value=b'wrong') as get, patch.object(cloud.time,'sleep') as sleep:
            with self.assertRaisesRegex(RuntimeError,'Published asset hash mismatch'):
                cloud.verify_uploaded_asset('https://example.invalid/hero.mp4',cloud.sha(b'right'),attempts=3)
        get.assert_called_once()
        sleep.assert_not_called()

    def test_hero_release_rotates_before_github_asset_limit(self):
        with tempfile.TemporaryDirectory() as folder:
            dist=Path(folder)
            needed=['/hero/index.html','/hero/hindi.mp4']
            for path in needed:
                target=dist/path.lstrip('/')
                target.parent.mkdir(parents=True,exist_ok=True)
                target.write_bytes(path.encode())
            def fake_release(tag):
                return {'tag_name':tag}
            def fake_entries(rel):
                if rel['tag_name']=='live-heroes-2026-11-24':
                    return {f'old-{i}':{} for i in range(999)}
                return {}
            with patch.object(cloud,'release',side_effect=fake_release), patch.object(cloud,'entries',side_effect=fake_entries):
                rel,known=cloud.hero_release(dist,needed,'2026-11-24')
            self.assertEqual(rel['tag_name'],'live-heroes-2026-11-24-2')
            self.assertEqual(known,{})

    def test_hero_release_reuses_content_addressed_assets_at_cap(self):
        with tempfile.TemporaryDirectory() as folder:
            dist=Path(folder)
            needed=['/hero/index.html','/hero/hindi.mp4']
            for path in needed:
                target=dist/path.lstrip('/')
                target.parent.mkdir(parents=True,exist_ok=True)
                target.write_bytes(path.encode())
            names={cloud.sha((dist/path.lstrip('/')).read_bytes())[:24]+'-'+Path(path).name for path in needed}
            def fake_release(tag):
                return {'tag_name':tag}
            def fake_entries(rel):
                return {**{name:{'name':name} for name in names},**{f'old-{i}':{} for i in range(1000-len(names))}}
            with patch.object(cloud,'release',side_effect=fake_release), patch.object(cloud,'entries',side_effect=fake_entries):
                rel,known=cloud.hero_release(dist,needed,'2026-11-24')
            self.assertEqual(rel['tag_name'],'live-heroes-2026-11-24')
            self.assertEqual(len(known),1000)


    def test_refresh_workflow_publishes_media_manifest_before_public_verification(self):
        workflow=Path(__file__).resolve().parents[1]/'.github'/'workflows'/'refresh.yml'
        source=workflow.read_text()
        persist=source.index('name: Persist verified media pointers and partial progress')
        verify=source.index('name: Verify exact published reel fingerprints on the public URL')
        invalidate=source.index('name: Invalidate reel progress if public freshness verification failed')
        persist_invalidated=source.index('name: Persist invalidated hero state after failed public verification')
        incomplete=source.index('name: Mark incomplete refresh for the ten-minute watchdog')
        self.assertLess(persist,verify)
        self.assertLess(invalidate,persist_invalidated)
        self.assertLess(persist_invalidated,incomplete)
        self.assertIn('time.sleep(delay)',source)
        self.assertIn('fetch(origin+path+\'?freshness=\'+expected[:16],expected)',source)

if __name__=='__main__':unittest.main()
