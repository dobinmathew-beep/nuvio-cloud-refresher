# Nuvio cloud refresher

This personal website updater runs ordinary Python and FFmpeg on standard public GitHub-hosted runners. It makes no AI API calls, uses no personal-computer runner and configures no paid services.

## Daily operation

- Target daily start: **06:00 Asia/Muscat** (02:00 UTC).
- A workflow checks on the hour and half hour. After both outputs pass for the current daily cycle, later checks skip downloading and rendering until the next cycle.
- If either output fails, completed work is retained and only unfinished work is attempted at later 30-minute checks. GitHub can delay scheduled jobs; uninterrupted or exact-time execution is not guaranteed.
- GitHub emails workflow failures according to your account notification settings. The first setup test failed safely during an HTML transfer; the corrected test passed.

## Backdrops

All 160 existing regional backdrop status URLs are warmed with concurrency no greater than four. The script validates language, kind, style, day, live/cached state, IndianRegional catalog IDs, selected title membership and combined movie/series interleaving. Sixteen representative JPEG URLs must return HTTP 200 image/jpeg. Requests/checks are retried once per attempt. Promotional IDs and unrelated feeds are excluded.

Base URL stays https://dobin-nuvio-live-backdrops.quickfield138.chatgpt.site . That Site remains the existing generator and cache; the GitHub job only sends ordinary HTTP requests.

## Centre movie in backdrops

For all four languages, the centre follows IMDb-linked entries in the matching catalog's order. TMDB-only composite entries remain eligible for surrounding artwork, but cannot displace the centre movie. This selects Baththa for Tamil instead of Obstacle and automatically follows future IMDb-linked catalog updates.


Movie and combined backdrops feature the first IMDb-linked movie in the matching IndianRegional primary movie catalog's own order. No external release-date lookup or date filtering is used. The existing central panel, nearest central panel or lead panel is used according to each layout; no extra panel or style change is introduced. Series-only collections stay series-only.

The cloud job records the catalog-head choices in `state/featured-movies.json` before warming images. The backdrop service reads the matching IndianRegional catalog directly, avoiding a stale GitHub selection-file cache. Status JSON must report the expected `centerMovie`, `centerSlot` and `renderVersion`, and the selected ID must still belong to its approved catalog. Missing posters or source outages preserve last-good images and leave unfinished work eligible for a retry. Centre choices and metadata are checked as part of the daily 06:00 cycle.

## Hero reels

The renderer uses the latest twelve valid IndianRegional movie entries per language plus all eight original films. Only hi, ta, ml and te catalogs are selected. The top catalog movie opens on the large foreground section of the filmstrip, with subsequent catalog entries appearing next. The saved renderer is `hero_render.py`; verified hero state requires `opening_version: 1`. Unchanged poster artwork is reused when its approved source URL matches. The supplied continuous 50-second audio, matching fades, projector design and compact H264/AAC settings are preserved. Tamil's primary reel uses Thuli Thuli. Old Hosanna comparison files remain unchanged legacy assets.

Validated generated files are uploaded to GitHub release assets before media pointers move. The existing Site reads `state/media.json` through an HTTP proxy, retaining these permanent URLs:

- https://dobin-nuvio-star-cards.quickfield138.chatgpt.site/hero/hindi.mp4
- https://dobin-nuvio-star-cards.quickfield138.chatgpt.site/hero/tamil.mp4
- https://dobin-nuvio-star-cards.quickfield138.chatgpt.site/hero/malayalam.mp4
- https://dobin-nuvio-star-cards.quickfield138.chatgpt.site/hero/telugu.mp4

All 82 pre-existing media/gallery paths were preserved on GitHub releases. Source failures leave last-good files intact. The media proxy includes a verified legacy-manifest fallback. Network or hosting outages may still affect availability.

## Check results

Open the repository's **Actions** tab for run status. `state/success.json` records the last completed daily cycle; `state/last-run.json` records incomplete work; `state/media.json` records public asset hashes, sizes and download URLs. A successful no-op run after completion confirms the daily gate works.

Do not delete the `renderer-source` or `legacy-site` releases or the `state` directory. Keep this repository public for the standard public Actions runner's free usage. No long-lived account credential is stored here; the workflow uses its automatically generated GitHub token.

The previous ChatGPT backdrop and hero automations remain paused. GitHub now owns the recurring work.

