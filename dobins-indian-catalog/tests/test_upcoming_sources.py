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


    def test_ottasia_confirmed_section_is_parsed_but_predictions_are_not(self):
        html = """<h2>Upcoming OTT releases in India: confirmed dates</h2>
        <div><a href="/shows/mr-mrs-office">Mr &amp; Mrs Office</a>
        <p>Series · Tamil</p><p>Streaming on JioHotstar from November 18, 2026</p></div>
        <h3>Friday, November 20</h3><a href="/movie/anbil-avan">Anbil Avan</a>
        <p>Film · Tamil</p><p>Digital release on November 20, 2026</p>
        <h2>Predicted next on OTT</h2>
        <div><a href="/movie/almari">Almari</a><p>Hindi · Netflix · Predicted November 20, 2026</p></div>"""
        rows = upcoming_sources._ottasia(
            BeautifulSoup(html, "html.parser"), "OTTASIA confirmed calendar",
            "https://ottasia.com/ott-releases-this-week?country=IN", "2026-11-17",
            {"malayalam":"ml","tamil":"ta","telugu":"te","hindi":"hi"},
            lambda value: value.lower().replace(" ", ""),
        )
        self.assertEqual({row["name"] for row in rows}, {"Mr & Mrs Office", "Anbil Avan"})
        self.assertEqual(next(row for row in rows if row["name"] == "Mr & Mrs Office")["type"], "series")
        self.assertEqual(next(row for row in rows if row["name"] == "Anbil Avan")["type"], "movie")
        self.assertEqual(next(row for row in rows if row["name"] == "Mr & Mrs Office")["ottDate"], "2026-11-18")
        self.assertEqual(next(row for row in rows if row["name"] == "Anbil Avan")["platforms"], [])

    def test_new_indian_movies_weekly_ott_rail_is_parsed(self):
        html = """<h2>New on OTT this week</h2>
        <a href="/title/anbil-avan">Fri 20 Nov Anbil Avan Tamil·SonyLIV</a>
        <a href="/title/campus-diaries">Wed 18 Nov Campus Diaries season 2 Hindi·Prime Video·Series</a>
        <h2>In cinemas now</h2><a href="/title/other">Fri 20 Nov Other Tamil·Cinemas</a>"""
        rows = upcoming_sources._new_indian_movies(
            BeautifulSoup(html, "html.parser"), "New Indian Movies OTT calendar",
            "https://newindianmovies.com/", "2026-11-17",
            {"malayalam":"ml","tamil":"ta","telugu":"te","hindi":"hi"},
            lambda value: value.lower().replace(" ", ""),
        )
        self.assertEqual({x["name"] for x in rows}, {"Anbil Avan", "Campus Diaries season 2"})
        self.assertEqual({x["type"] for x in rows}, {"movie", "series"})
        self.assertTrue(all(x["ottDate"] >= "2026-11-17" for x in rows))


    def test_indian_movie_reviews_cards_require_date_language_and_title(self):
        html = """<h1>OTT release calendar</h1>
        <article><h3><a href="/review/mazhalai">Mazhalai</a></h3>
        <p>Tamil · on OTT Mon 16 Nov · Streaming</p></article>
        <article><h3><a href="/review/queen">Queen</a></h3>
        <p>Hindi · Series · on OTT Wed 18 Nov · Streaming</p></article>
        <article><h3><a href="/review/rumour">Rumour</a></h3>
        <p>Malayalam · expected 20 Nov</p></article>"""
        rows = upcoming_sources._calendar_cards(
            BeautifulSoup(html, "html.parser"), "Indian Movie Reviews OTT calendar",
            "https://indianmoviereviews.com/ott-releases/", "2026-11-17",
            {"malayalam":"ml","tamil":"ta","telugu":"te","hindi":"hi"},
            lambda value: value.lower().replace(" ", ""),
        )
        self.assertEqual({x["name"] for x in rows}, {"Queen"})
        self.assertEqual(rows[0]["language"], "hindi")
        self.assertEqual(rows[0]["type"], "series")
        self.assertEqual(rows[0]["ottDate"], "2026-11-18")
        self.assertFalse(rows[0]["confirmed"])

    def test_ottclock_confirmed_upcoming_feed_parses_compact_cards(self):
        html = """<a href="/movie/example">Movie 20 Nov Netflix Example Film Movie · Hindi</a>
        <a href="/series/sample">New 21 Nov Prime Video Sample Series Series · Malayalam</a>
        <a href="/movie/tba">Movie TBA Prime Video Awarapan 2 Movie · Hindi</a>
        <a href="/movie/dub">Movie 22 Nov Netflix Dubbed Movie Movie · Tamil, Hindi</a>"""
        rows = upcoming_sources._ottclock(
            BeautifulSoup(html, "html.parser"), "OTTClock confirmed upcoming calendar",
            "https://ottclock.com/upcoming-ott-releases/", "2026-11-17",
            {"malayalam":"ml","tamil":"ta","telugu":"te","hindi":"hi"},
            lambda value: value.lower().replace(" ", ""),
        )
        self.assertEqual({x["name"] for x in rows}, {"Example Film", "Sample Series"})
        self.assertEqual({x["type"] for x in rows}, {"movie", "series"})
        self.assertEqual({x["language"] for x in rows}, {"hindi", "malayalam"})
        self.assertTrue(all(x["confirmed"] for x in rows))

    def test_ottasia_live_weekday_first_date_format(self):
        html = """<h2>Upcoming OTT releases in India: confirmed dates</h2>
        <h3>Wednesday, November 18</h3>
        <div><img alt="Mr &amp; Mrs Office"><a href="/series/mr-mrs-office">Mr &amp; Mrs Office</a>
        <p>Series · Tamil</p><p>Streaming on JioHotstar from Wed, Nov 18</p></div>
        <h3>Friday, November 20</h3>
        <div><a href="/movie/anbil-avan">Anbil Avan</a>
        <p>Film · Tamil</p><p>Digital release on November 20, 2026</p></div>
        <h2>Predicted next on OTT</h2>
        <div><a href="/movie/almari">Almari</a><p>Film · Malayalam · Netflix · Predicted November 20, 2026</p></div>"""
        rows = upcoming_sources._ottasia(
            BeautifulSoup(html, "html.parser"), "OTTASIA confirmed calendar",
            "https://ottasia.com/ott-releases-this-week?country=IN", "2026-11-17",
            {"malayalam":"ml","tamil":"ta","telugu":"te","hindi":"hi"},
            lambda value: value.lower().replace(" ", ""),
        )
        self.assertEqual({row["name"] for row in rows}, {"Mr & Mrs Office", "Anbil Avan"})
        self.assertEqual(next(row for row in rows if row["name"] == "Mr & Mrs Office")["ottDate"], "2026-11-18")
        self.assertEqual(next(row for row in rows if row["name"] == "Anbil Avan")["ottDate"], "2026-11-20")
        self.assertTrue(all(row["confirmed"] for row in rows))

    def test_ottasia_live_nested_card_layout_extracts_confirmed_future_titles(self):
        html = """<h2>Upcoming OTT releases in India: confirmed dates</h2>
        <section class="release-grid">
          <article class="release-card"><div><a href="/title/mr-mrs-office">Mr &amp; Mrs Office</a></div>
            <div><span>Series · Tamil</span></div><div>Streaming on JioHotstar from Wed, Nov 18</div></article>
          <article class="release-card"><div><a href="/title/anbil-avan">Anbil Avan</a></div>
            <div><span>Film · Tamil</span></div><div>Digital release on November 20, 2026</div></article>
          <article class="release-card"><div><a href="/title/supreme-solaris">Supreme Solaris</a></div>
            <div><span>Series · Hindi</span></div><div>Streaming on YouTube from November 22, 2026</div></article>
          <article class="release-card"><div><a href="/title/takshakudu">Takshakudu</a></div>
            <div><span>Film · Telugu</span></div><div>Digital release on November 26, 2026</div></article>
        </section>
        <h2>Predicted next on OTT</h2>
        <article><a href="/title/almari">Almari</a><span>Film · Malayalam</span>
          <p>Predicted November 28, 2026</p></article>"""
        rows = upcoming_sources._ottasia(
            BeautifulSoup(html, "html.parser"), "OTTASIA confirmed calendar",
            "https://ottasia.com/ott-releases-this-week?country=IN", "2026-11-17",
            {"malayalam":"ml","tamil":"ta","telugu":"te","hindi":"hi"},
            lambda value: value.lower().replace(" ", ""),
        )
        self.assertEqual({row["name"] for row in rows},
                         {"Mr & Mrs Office", "Anbil Avan", "Supreme Solaris", "Takshakudu"})
        self.assertEqual({row["type"] for row in rows}, {"movie", "series"})
        self.assertEqual({row["language"] for row in rows}, {"tamil", "hindi", "telugu"})
        self.assertEqual(next(row for row in rows if row["name"] == "Mr & Mrs Office")["ottDate"], "2026-11-18")
        self.assertTrue(all(row["confirmed"] for row in rows))


    def test_ottchecker_recent_release_parses_past_streaming_rows(self):
        html = """<section><ul>
          <li><a href="/movie/madhuramee-jeevitham-2026">Madhuramee Jeevitham (2026) Movie · IMDb 7.2 Amazon Prime Video Streaming since 12 Nov</a></li>
          <li><a href="/movie/bandra-2023">Bandra (2023) Movie · IMDb 3.9 ZEE5 Streaming since 12 Nov</a></li>
          <li><a href="/movie/tony-xavier-2026">Tony Xavier (2026) Movie Manorama Max Streaming since 10 Nov</a></li>
          <li><a href="/movie/not-yet">Not Yet (2026)</a>
            Movie · Prime Video Expected 22 Nov</li>
          <li><a href="/movie/no-date">No Date (2026)</a> Movie · Prime Video</li>
          <li><a href="/movie/ramayana-part-two-2028">Ramayana: Part Two (2028) Movie · YouTube Streaming since 13 Nov</a></li>
        </ul></section>"""
        rows = upcoming_sources._ottchecker_recent(
            BeautifulSoup(html, "html.parser"),
            "https://www.ottchecker.com/ott-releases/malayalam",
            "2026-11-19",
            {"malayalam":"ml","tamil":"ta","telugu":"te","hindi":"hi"},
        )
        self.assertEqual({x["name"] for x in rows}, {"Madhuramee Jeevitham", "Bandra", "Tony Xavier"})
        movie = next(x for x in rows if x["name"] == "Madhuramee Jeevitham")
        self.assertEqual(movie["language"], "malayalam")
        self.assertEqual(movie["type"], "movie")
        self.assertEqual(movie["ottDate"], "2026-11-12")
        self.assertEqual(movie["year"], "2026")
        self.assertEqual(movie["platforms"], ["Amazon Prime Video"])
        self.assertTrue(movie["confirmed"])
        self.assertEqual(movie["detail"], "https://www.ottchecker.com/movie/madhuramee-jeevitham-2026")

    def test_ottchecker_recent_release_is_language_scoped_and_windowed(self):
        html = """<ul>
          <li><a href="/movie/old">Old Film (2024) Movie · Netflix Streaming since 1 Jan 2025</a></li>
          <li><a href="/movie/future">Future Film (2026) Movie · Netflix Streaming since 20 Nov</a></li>
          <li><a href="/series/sample">Sample Series (2026) Series · Netflix Streaming since 18 Nov</a></li>
        </ul>"""
        rows = upcoming_sources._ottchecker_recent(
            BeautifulSoup(html, "html.parser"),
            "https://www.ottchecker.com/ott-releases/tamil",
            "2026-11-19",
            {"malayalam":"ml","tamil":"ta","telugu":"te","hindi":"hi"},
        )
        self.assertEqual([x["name"] for x in rows], ["Sample Series"])
        self.assertEqual(rows[0]["language"], "tamil")
        self.assertEqual(rows[0]["type"], "series")

if __name__ == "__main__":
    unittest.main()
