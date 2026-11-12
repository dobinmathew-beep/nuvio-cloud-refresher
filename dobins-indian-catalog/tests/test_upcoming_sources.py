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
        self.assertEqual({x["language"] for x in rows}, {"malayalam","tamil","telugu","hindi"})
        self.assertTrue(all(x["ottDate"] == "2026-11-12" for x in rows))
        self.assertTrue(all(x["type"] == "movie" for x in rows))
        self.assertTrue(all(x["platforms"] for x in rows))

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
