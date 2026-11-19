import unittest
import physical

class ReleaseOrderTests(unittest.TestCase):
    def test_theatrical_release_date_is_parsed_and_future_rows_are_ignored(self):
        html = """
        <table class="releases">
          <h2 class="release" id="IN">India</h2>
          <tbody>
            <tr><td>10/10/2026</td><td>Oct 10</td><td>Theatrical</td><td>Wide</td><td>Original theatrical release</td></tr>
            <tr><td>20/12/2026</td><td>Dec 20</td><td>Physical</td><td>Wide</td><td>4K Blu-ray</td></tr>
            <tr><td>20/11/2026</td><td>Nov 20</td><td>Theatrical</td><td>Wide</td><td>Future premiere</td></tr>
          </tbody>
        </table>
        """
        rows = physical.theatrical_releases(html, "2026-11-19")
        self.assertEqual([x["date"] for x in rows], ["2026-10-10"])
        self.assertEqual(rows[0]["country"], "India")

    def test_movie_uses_theatrical_date_even_when_ott_arrives_later(self):
        events = [
            {"name": "Example Film", "language": "malayalam", "type": "movie",
             "ottDate": "2026-11-15", "releaseKind": "digital",
             "sources": ["digital"], "platforms": ["Prime Video"]},
            {"name": "Example Film", "language": "malayalam", "type": "movie",
             "ottDate": "2026-08-10", "releaseKind": "theatrical",
             "sources": ["theatrical"], "platforms": ["Theatrical"]},
        ]
        merged = physical.merge_events(events, lambda x: x.lower().replace(" ", ""),
                                       "2026-11-19")
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]["releaseKind"], "theatrical")
        self.assertEqual(merged[0]["ottDate"], "2026-08-10")
        self.assertEqual({x["kind"] for x in merged[0]["availability"]},
                         {"theatrical", "digital"})

    def test_movie_without_theatrical_date_uses_digital_then_physical(self):
        events = [
            {"name": "Digital First", "language": "tamil", "type": "movie",
             "ottDate": "2026-11-12", "releaseKind": "digital"},
            {"name": "Disc Edition", "language": "tamil", "type": "movie",
             "ottDate": "2026-11-14", "releaseKind": "physical"},
        ]
        merged = physical.merge_events(events, lambda x: x.lower().replace(" ", ""),
                                       "2026-11-19")
        self.assertEqual(merged[0]["releaseKind"], "digital")
        self.assertEqual(merged[0]["ottDate"], "2026-11-12")

    def test_digital_release_precedes_physical_when_no_theatrical_date_exists(self):
        events = [
            {"name": "Later OTT", "language": "tamil", "type": "movie",
             "ottDate": "2026-11-20", "releaseKind": "digital"},
            {"name": "Later OTT", "language": "tamil", "type": "movie",
             "ottDate": "2026-08-01", "releaseKind": "physical"},
        ]
        merged = physical.merge_events(events, lambda x: x.lower().replace(" ", ""),
                                       "2026-11-19")
        self.assertEqual(merged[0]["releaseKind"], "digital")
        self.assertEqual(merged[0]["ottDate"], "2026-11-20")

    def test_catalog_release_sort_date_uses_canonical_movie_date(self):
        movie = {"type": "movie", "releaseDate": "2026-08-10",
                 "ottDate": "2026-11-15"}
        self.assertEqual(physical.catalog_release_date(movie), "2026-08-10")

    def test_series_sort_date_uses_latest_episode_release(self):
        series = {"type": "series", "releaseDate": "2026-09-01",
                  "latestEpisodeReleasedAt": "2026-11-18T21:30:00+00:00"}
        self.assertEqual(physical.catalog_release_date(series), "2026-11-18")

if __name__ == "__main__":
    unittest.main()
