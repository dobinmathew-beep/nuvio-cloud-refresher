# Nuvio cloud refresher

This personal website updater runs ordinary Python and FFmpeg on standard public GitHub-hosted runners. It makes no AI API calls, uses no personal-computer runner and configures no paid services.

## Scheduled operation

- All four outputs (backdrops, hero reels, addon catalogs and India EPG) are due **every two hours**, at 00:00, 02:00, 04:00, 06:00, 08:00, 10:00, 12:00, 14:00, 16:00, 18:00, 20:00 and 22:00 Asia/Muscat. The main workflow cron is `0 */2 * * *` UTC; the four-hour offset keeps these aligned.
- A ten-minute watchdog checks actual successful cycles and dispatches overdue components. It also runs after component workflows finish. Backdrops and reels share one workflow but both must pass verification.
- Active or queued refreshes are not duplicated. Incomplete work and last-good public outputs are retained; subsequent checks retry unfinished work with a ten-minute dispatch cooldown.
- GitHub's native schedule and the existing staggered fallback checks remain enabled. GitHub can delay jobs; completion at an exact minute is not guaranteed.
- External cron-job.org job 8777026 is enabled every ten minutes. Its saved credential passed a live dispatch test on 2026-11-02, and the watchdog successfully started overdue media, addon and EPG refreshes. See [external scheduler configuration and verification](docs/external-scheduler.md). The owner's token must remain valid.

## Backdrops

All 160 existing regional backdrop status URLs are warmed with concurrency no greater than four. The script validates language, kind, style, day, live/cached state, IndianRegional catalog IDs, selected title membership and combined movie/series interleaving. Sixteen representative JPEG URLs must return HTTP 200 image/jpeg. Requests/checks are retried once per attempt. Promotional IDs and unrelated feeds are excluded.

Base URL stays https://dobin-nuvio-live-backdrops.quickfield138.chatgpt.site . That Site remains the existing generator and cache; the GitHub job only sends ordinary HTTP requests.

## Centre movie in backdrops

For all four languages, the centre follows IMDb-linked entries in the matching catalog's order. TMDB-only composite entries remain eligible for surrounding artwork, but cannot displace the centre movie. This selects Baththa for Tamil instead of Obstacle and automatically follows future IMDb-linked catalog updates.


Movie and combined backdrops feature the first IMDb-linked movie in the matching IndianRegional primary movie catalog's own order. No external release-date lookup or date filtering is used. The existing central panel, nearest central panel or lead panel is used according to each layout; no extra panel or style change is introduced. Series-only collections stay series-only.

The cloud job records the catalog-head choices in `state/featured-movies.json` before warming images. The backdrop service reads the matching IndianRegional catalog directly, avoiding a stale GitHub selection-file cache. Status JSON must report the expected `centerMovie`, `centerSlot` and `renderVersion`, and the selected ID must still belong to its approved catalog. Missing posters or source outages preserve last-good images and leave unfinished work eligible for a retry. Centre choices and metadata are checked in every two-hour refresh cycle.

## Hero reels

The renderer uses the first twelve eligible IMDb-linked IndianRegional movie entries in each language's catalog order. TMDB-only composite entries are excluded from reels, matching the backdrop centre rule. This selection is validated as `imdb-catalog-order-v1`. It combines these twelve entries plus all eight original films. Only hi, ta, ml and te catalogs are selected. The top catalog movie opens on the large foreground section of the filmstrip, with subsequent catalog entries appearing next. The saved renderer is `hero_render.py`; verified hero state requires `opening_version: 1`. Unchanged poster artwork is reused when its approved source URL matches. The supplied continuous 50-second audio, matching fades, projector design and compact H264/AAC settings are preserved. Tamil's primary reel uses Thuli Thuli. Old Hosanna comparison files remain unchanged legacy assets.

Validated generated files are uploaded to GitHub release assets before media pointers move. The existing Site reads `state/media.json` through an HTTP proxy, retaining these permanent URLs:

- https://dobin-nuvio-star-cards.quickfield138.chatgpt.site/hero/hindi.mp4
- https://dobin-nuvio-star-cards.quickfield138.chatgpt.site/hero/tamil.mp4
- https://dobin-nuvio-star-cards.quickfield138.chatgpt.site/hero/malayalam.mp4
- https://dobin-nuvio-star-cards.quickfield138.chatgpt.site/hero/telugu.mp4

All 82 pre-existing media/gallery paths were preserved on GitHub releases. Source failures leave last-good files intact. The media proxy includes a verified legacy-manifest fallback. Network or hosting outages may still affect availability.

## Check results

Open the repository's **Actions** tab for run status. `state/success.json` records the last completed two-hour cycle; `state/last-run.json` records incomplete work; `state/media.json` records public asset hashes, sizes and download URLs. A successful no-op run after completion confirms the current cycle gate works.

Do not delete the `renderer-source` or `legacy-site` releases or the `state` directory. Keep this repository public for the standard public Actions runner's free usage. No long-lived account credential is stored here; the workflow uses its automatically generated GitHub token.

The previous ChatGPT backdrop and hero automations remain paused. GitHub now owns the recurring work.

