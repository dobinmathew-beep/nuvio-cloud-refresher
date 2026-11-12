import unittest
from bs4 import BeautifulSoup
import upcoming_sources

class UpcomingSourceTests(unittest.TestCase):
    def test_confirmed_multilingual_cinebuds_release(self):
        html = """<table><tr class="ott-row">
          <td><time datetime="2026-11-12">12 Nov</time></td>
          <td><a class="ott-title" href="/movie/jailer-2">Jailer 2</a></td>
          <td class="ott-lang">Tamil Also in Malayalam, Telugu, Kannada, Hindi</td>
          <td><span class="cb-badge">Confirmed</span></td>
          <td><span class="cb-badge">Prime Video</span></td>
        </tr></table>"""
        rows = upcoming_sources._cinebuds(
            BeautifulSoup(html, "html.parser"),
            "Cinebuds upcoming calendar",
            "https://cinebuds.com/ott-releases-this-week/",
            "2026-11-11",
            {"malayalam":"ml","tamil":"ta","telugu":"te","hindi":"hi"},
            lambda value: value.lower().replace(" ", ""),
        )
        self.assertEqual({x["language"] for x in rows}, {"tamil"})
        self.assertTrue(all(x["ottDate"] == "2026-11-12" for x in rows))
        self.assertTrue(all(x["language"] == "tamil" for x in rows))
        self.assertTrue(all(x["type"] == "movie" for x in rows))
        self.assertTrue(all(x["platforms"] for x in rows))

    def test_reported_calendar_entry_without_year_is_accepted(self):
        html = '''<article>
          <p>Fri 13 Nov</p>
          <h3><a href='/movie/bandra'>Bandra</a></h3>
          <p>ZEE5 Malayalam Film Reported</p>
        </article>'''
        rows = upcoming_sources._generic(
            BeautifulSoup(html, 'html.parser'),
            'New Indian Movies OTT calendar',
            'https://newindianmovies.com/ott-releases',
            '2026-11-12',
            {'malayalam':'ml','tamil':'ta','telugu':'te','hindi':'hi'},
            lambda value: value.lower().replace(' ', ''),
        )
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['name'], 'Bandra')
        self.assertEqual(rows[0]['ottDate'], '2026-11-13')
        self.assertEqual(rows[0]['platforms'], ['ZEE5'])
        self.assertEqual(rows[0]['language'], 'malayalam')

    def test_rumoured_calendar_entry_is_still_excluded(self):
        html = '''<article>
          <p>Fri 13 Nov</p>
          <h3><a href='/movie/sample'>Sample</a></h3>
          <p>ZEE5 Malayalam Film Rumoured</p>
        </article>'''
        rows = upcoming_sources._generic(
            BeautifulSoup(html, 'html.parser'),
            'New Indian Movies OTT calendar',
            'https://newindianmovies.com/ott-releases',
            '2026-11-12',
            {'malayalam':'ml','tamil':'ta','telugu':'te','hindi':'hi'},
            lambda value: value.lower().replace(' ', ''),
        )
        self.assertEqual(rows, [])
    def test_dailyott_verified_future_dates_are_included(self):
        rows = upcoming_sources._dailyott([{
            'title': 'Bandra', 'type': 'Movie', 'releaseDate': '2026-11-13',
            'platform': 'ZEE5', 'languages': ['Malayalam'], 'source_verified': True,
            'tmdbDetails': {'originalLanguage': 'ml', 'releaseDate': '2023-11-10'}
        }], 'https://www.dailyott.in/', '2026-11-12',
           {'malayalam':'ml','tamil':'ta','telugu':'te','hindi':'hi'})
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['ottDate'], '2026-11-13')
        self.assertEqual(rows[0]['language'], 'malayalam')
        self.assertEqual(rows[0]['releaseKind'], 'digital')

    def test_dailyott_does_not_promote_unverified_future_dates(self):
        rows = upcoming_sources._dailyott([{
            'title': 'Unverified', 'type': 'Movie', 'releaseDate': '2026-11-13',
            'platform': 'ZEE5', 'languages': ['Malayalam']
        }], 'https://www.dailyott.in/', '2026-11-12',
           {'malayalam':'ml','tamil':'ta','telugu':'te','hindi':'hi'})
        self.assertEqual(rows, [])
    def test_expected_or_predicted_dates_are_excluded(self):
        html = """<table><tr class="ott-row">
          <td><time datetime="2026-11-13">13 Nov</time></td>
          <td><a class="ott-title" href="/movie/sample">Sample Film</a></td>
          <td class="ott-lang">Tamil</td>
          <td><span class="cb-badge">Expected</span></td>
          <td><span class="cb-badge">Netflix</span></td>
        </tr></table>"""
        rows = upcoming_sources._cinebuds(
            BeautifulSoup(html, "html.parser"),
            "Cinebuds upcoming calendar",
            "https://cinebuds.com/ott-releases-this-week/",
            "2026-11-11",
            {"malayalam":"ml","tamil":"ta","telugu":"te","hindi":"hi"},
            lambda value: value.lower().replace(" ", ""),
        )
        self.assertEqual(rows, [])

if __name__ == "__main__":
    unittest.main()
