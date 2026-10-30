# Dobins Indian Catalog

Public installer: https://dobins-indian-catalog.quickfield138.chatgpt.site/

**Install in Nuvio:** add `https://dobins-indian-catalog.quickfield138.chatgpt.site/manifest.json` in the add-on settings.

Eight separate catalogs provide Malayalam, Tamil, Telugu and Hindi movies and series. IMDb `tt` IDs are preferred. Verified TMDB (`tmdb:`) and TVmaze (`tvmaze:`) IDs are retained when no dependable IMDb match exists. Streaming add-ons must support the relevant ID to return playback sources. Titles are sorted by digital premiere dates, not cinema-release dates or IMDb release years. Playback uses your existing stream add-ons; this add-on supplies catalogs and metadata.

## Automatic cloud updates

Targets in **Asia/Muscat (UTC+4)**:

- 06:00 and 18:00 every day.
- An additional 01:00 on Thursday, Friday and Saturday.

The default branch's `.github/workflows/dobins-indian-catalog.yml` checks every 30 minutes, then a lightweight schedule gate runs work only for a new due slot or unfinished work. GitHub may delay scheduled jobs, so exact-time execution is not guaranteed. Manual dispatch and code pushes on this branch force a check. There are no AI calls, paid API requirements, personal-computer runners or long-lived account tokens. Standard public GitHub-hosted runners are used.

The updater and its data live on the separate `dobins-catalog` branch, under `dobins-indian-catalog/`. The workflow checks out and commits only to that branch. This prevents simultaneous catalog and existing backdrop/reel refreshes from competing for the same branch state. The backdrop/reel workflow and URLs are unaffected.

## Release reporting and verification

1. **DailyOTT** public structured release data (`https://www.dailyott.in/api/movies`), with automatic discovery of its public frontend snapshot if the API is unavailable. Only records explicitly marked verified and dated today or earlier are eligible.
2. **Cinebuds** confirmed recently-released OTT table (`https://cinebuds.com/ott-release-dates/`) supplies an independent cross-check and additional releases. Upcoming, expected and date-TBA sections are excluded.

We compared these with OTTClock and NET27 Watch. DailyOTT exposes dated movie/series records and Cinebuds separates confirmed streaming dates from estimates. This is a practical source choice, not a guarantee of exhaustive coverage or perfect reporting. The updater does not depend on rotating download-site domains, theatrical-release lists or streaming-link scrapers. Dates concern Indian OTT availability; availability elsewhere may differ.

Every entry retains its release-reporting source and platform. Movie duplicate reports retain the earliest digital date; series track the latest reported season premiere. Similar titles, incorrect types, mismatched years and ambiguous IMDb matches are held back instead of receiving guessed IDs.

IndianRegional's language catalogs are used only as an IMDb identity lookup aid, never as evidence that a movie has reached OTT. Exact IMDb suggestion matches are followed by TVmaze title/language verification and source-linked TMDB title pages. TMDB type, canonical ID, title and release dates are checked before publication. TVmaze can also recover IMDb IDs, including for older shows with a new OTT premiere. Cinemeta, TMDB public title metadata and TVmaze supply full metadata; series episodes can also fall back to an IMDb-verified TVMaze lookup. Some newly released shows may not yet have indexed episode data. TMDB fallback reads public title pages and DailyOTT’s public TMDB-derived details, without storing or requiring a TMDB API key.

`data/unmatched.json` records pending/uncertain matches. New matching work is fairly distributed across all eight catalogs and bounded to 160 titles per update. This allows gradual history backfill without monopolising a runner. Metadata is refreshed after three hours, so normal scheduled slots recheck series metadata.

## Posters, fanart and logos

- RPDB's public free IMDb posters are tried first for IMDb-linked movies and series. Alternate-ID titles retain source posters until an IMDb/RPDB match is available.
- High-resolution title-specific source posters and Cinemeta/Metahub are fallbacks.
- Background fanart and title logos use Cinemeta's artwork sources, including Fanart.tv where available.
- If an original title logo is unavailable, a transparent PNG spelling the correct title is generated without AI. The add-on's own logo is also a PNG.
- Public artwork endpoints validate content type, retry alternate artwork, and cache successful images. RPDB, TMDB, IMDb, Cinemeta and contributing artwork sources retain their respective rights; this project is not endorsed by them.

## Protocol and hosting

The public HTTPS service implements the Stremio-compatible `manifest`, `catalog` and `meta` protocol used by Nuvio. It supports CORS, search, pagination, movie/series IDs, poster/landscape artwork and logo endpoints. Its lightweight public Site reads the generated JSON from this branch. Current source is included in `site/`; a verified initial snapshot embedded in the Site keeps all eight catalogs available during GitHub/source outages.

Generated data:

- `data/catalogs.json`: eight sorted catalog arrays.
- `data/metadata.json`: IMDb-matched detail/episode data and artwork alternatives.
- `data/status.json`: last success, schedule, source health and catalog counts.
- `data/matches.json`, `data/candidates.json`, `data/sources.json`: reusable matching and source caches.
- `data/unmatched.json`: titles awaiting a reliable match or backfill.

A source outage preserves cached source records. If all release sources fail, or a catalog would become empty, the last-good catalogs remain and the next 30-minute check retries. The first checkout restores the public initial dataset using `bootstrap.py`; later checkouts use committed data.

## Local maintenance

Python 3.12. Install `requirements.txt`, then run:

```sh
python -m unittest discover -s tests -v
python update.py
```

Useful public routes:

- `/manifest.json`
- `/catalog/movie/dobins_ml_movie.json`
- `/catalog/series/dobins_ta_series.json`
- `/catalog/movie/dobins_hi_movie/search=example.json`
- `/meta/movie/tt34792531.json`
- `/art/poster/tt34792531`
- `/art/logo/tt34792531`
- `/status.json`

Do not delete the separate branch or generated data. No ChatGPT automation is required for any routine update.

## AIOMetadata companion mode

The default manifest advertises **catalogs only**, so this add-on does not override AIOMetadata’s metadata resource. Its standard IMDb, TMDB and TVmaze IDs match prefixes supported by AIOMetadata. Keep AIOMetadata installed with movie/series metadata enabled. Nuvio can then request trailers, recommendations, artwork, cast, ratings and episode lists from that existing provider. Missing upstream information cannot be invented or guaranteed.

The optional `/standalone/manifest.json` advertises this add-on’s own fallback metadata for people who do not use AIOMetadata. Install one variant, not both. `meta` endpoints remain available for verification, but the default companion manifest does not claim those requests. Your configured AIOMetadata instance and device settings are not changed by this project.

## DVD and Blu-ray movie eligibility

Confirmed, already-released physical movie editions now qualify independently of OTT availability. The updater discovers original-language movies through TMDB’s public Physical release filter (type 5), then verifies the dated Physical rows on each title’s release table and cross-checks title metadata. It records the disc date, country, format note and exact source URL. Upcoming dates and theatrical/digital/TV rows never count as disc evidence. A physical row must explicitly name DVD, Blu-ray, UHD or 4K; unspecified physical formats and VHS do not qualify. The most recent first-page discovery candidates per language are checked with at most four simultaneous requests, cached for three hours and retained on source outages. This indexed coverage is not an exhaustive record of every commercial disc.

Movies available both digitally and physically appear once, sorted by their earliest verified home-release date. Public entries contain `releaseDate`, `releaseKind`, `availability`, and `physicalReleases`; `ottDate` is null for physical-only entries. A disc date is never presented as proof of an OTT release. AIOMetadata companion mode and permanent manifest URL are unchanged.

TMDB does not provide equivalent physical-edition dates for TV series in this source. Series retain their verified OTT rules until a dated, title-specific box-set record is available; theatrical dates and streaming episode dates are not substitutes.
