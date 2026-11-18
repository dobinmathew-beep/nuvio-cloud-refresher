# The Great Indian Addon — Updated Owner's Handbook
**Evidence date:** 18 November 2026 (Oman time)  
**Companion files:** Word handbook and PowerPoint handover are supplied separately in this conversation.

## Scope and evidence rule
This guide separates completed work from items that are pending, experimental or not independently verified. A commit alone is not proof of a live feature.

## Latest independent public verification
The repository file `verification/latest.md` records **18 Nov 2026, 06:19:05 +04:00**, overall **4/4 outputs passed**:
- **Addon — PASS:** public manifest and all eight catalog endpoints; each endpoint returned 50 entries.
- **EPG — PASS:** XMLTV 2,055,611 bytes; 612 matched channel IDs out of 820; 66,531 programmes; reports checked.
- **Backdrops — PASS:** 160 statuses, all live; 16 image checks; zero errors.
- **Reels — PASS:** Hindi, Tamil, Malayalam and Telugu public reel endpoints all passed.

Timing note: the saved daily dashboard at 06:20 showed the 04:00 combined backdrop/reel refresh still running or queued, while the 06:00 addon and EPG refreshes were updated. Thus the independent public endpoints passed; the next combined media refresh cycle was not marked complete in that dashboard.

## How the system works
Public sources → GitHub Actions → GitHub repository/state → public hosting → Nuvio/browser.
GitHub Actions runs Python/FFmpeg jobs on GitHub-hosted runners; the owner's computer and ChatGPT session do not need to stay on. No AI API calls are used for the recurring refresh jobs.

## Automation timing
- Main refresh workflow checks every 30 minutes.
- Outputs are due on a two-hour cadence in Asia/Muscat time.
- A watchdog checks overdue work and retries pending components.
- Active/queued work is not duplicated.
- Last-good public outputs are preserved when an attempt is incomplete.
- GitHub can delay scheduled runs; exact-minute completion is not guaranteed.

## Repository and branch map
Repository: https://github.com/dobinmathew-beep/nuvio-cloud-refresher

| Branch | Plain-English purpose | Status treatment |
|---|---|---|
| `main` | Automation/workflow definitions, state, status dashboard and verification reports | Operational control branch |
| `dobins-catalog` | Generated catalog data consumed by the addon API | Catalog data branch |
| `greta-site` | Great Indian Addon website and API source | Source branch identified in recent Vercel READY production deployments |
| `poster-date-service` | Separate poster-date service branch | Not counted as a completed feature in this update |
| `upcoming-poster-stack` | Experimental/alternate poster work | Not treated as production |

Other repositories:
- https://github.com/dobinmathew-beep/nuvio-star-cards — branch `main`; Star Cards/A24 artwork website assets.
- https://github.com/dobinmathew-beep/aiometadata-nuvio-edition — default branch `dev`; public AIOMetadata fork. Its Nuvio-specific deployment was not confirmed; a previous GitHub write attempt returned 403. It is not described as a deployed feature.

## Completed outputs

### Regional backdrops
- 160 regional status URLs are checked/warmed with concurrency capped at four.
- 16 representative JPEG URLs are checked for HTTP 200 and image/jpeg.
- Centre artwork follows the first eligible IMDb-linked movie in the matching IndianRegional primary movie catalog order.
- TMDB-only composite titles can contribute surrounding art but cannot displace the centre movie.
- Series-only collections remain series-only.
- Latest independent public verification: 160 live statuses, 16 image checks, zero errors.

### Hero reels
- Four language MP4 endpoints: Hindi, Tamil, Malayalam and Telugu.
- The renderer selects eligible IMDb-linked titles in IndianRegional catalog order.
- Latest daily status recorded 20 films per language in the current reel manifest.
- The 50-second continuous audio bed, projector treatment and compact H.264/AAC output are retained.
- New assets are validated and uploaded to GitHub release assets before media pointers are changed; last-good output is preserved on failure.
- All four public reel endpoints passed the 18 November independent check.

Direct links:
- Hindi: https://dobin-nuvio-star-cards.quickfield138.chatgpt.site/hero/hindi.mp4
- Tamil: https://dobin-nuvio-star-cards.quickfield138.chatgpt.site/hero/tamil.mp4
- Malayalam: https://dobin-nuvio-star-cards.quickfield138.chatgpt.site/hero/malayalam.mp4
- Telugu: https://dobin-nuvio-star-cards.quickfield138.chatgpt.site/hero/telugu.mp4

### The Great Indian Addon
- Eight catalogs: Malayalam/Tamil/Telugu/Hindi × Movies/Series.
- All eight public catalog endpoints returned 50 entries each in the latest independent check.
- The manifest and page-size/skip pagination compatibility work allow Nuvio to request further pages.
- Daily status listed 937 catalog entries and 73 pending identity matches. Pending matches are not treated as verified.
- Checkout health response was `ready:false` and `configured:false`; payment is not claimed as complete.

### India EPG
- Published XMLTV: 2,055,611 bytes.
- 612 matched channel IDs from 820 playlist channel IDs.
- 208 unresolved channel IDs.
- 66,531 programmes.
- Channel matching, unresolved-channel, source cross-check and source-health reports passed validation.
- Unresolved channels are reported; schedules are not invented.

## Vercel — latest confirmed evidence
Project: `the-great-indian-addon`; repository: `dobinmathew-beep/nuvio-cloud-refresher`.
- Latest deployment record: `dpl_2zNQgqdAiA2sei14Chx91jf9W4gD`
- State: `READY`, target: production
- Branch: `greta-site`
- Commit: `dcc11ed04167b67ef73d2a3dbdb8427991b6cc89`
- Commit message: “Refresh catalog commit pointer every minute for discovery data freshness”
- Node.js: 22.x
- Project aliases include `the-great-indian-addon.vercel.app` and `greta-indian-catalog.vercel.app`.

Recent READY records also cover catalog diagnostics, snapshot provenance/freshness reporting, public catalog ID-set checks, Nuvio pagination compatibility and source-health schedule documentation. ERROR and CANCELED deployment records exist and are not counted as completed. A READY build does not prove every browser interaction or external integration.

## Render — verified limits
The Nuvio Star Cards service was previously confirmed successfully deployed from `nuvio-star-cards`, branch `main`, with automatic deploys enabled. Recent GitHub A24 asset commits include pure-black JPG background work, sharper foreground treatment and a refreshed A24 backdrop. The 17 November commit `3d24b3123750c52cf22ae1ee2d77b1eb342515ce` refreshed `site/public/a24-backdrop.jpg`. A fresh Render service check was not completed for this edition; do not assume that commit is already live on Render.

## Recent A24 asset changes
Repository: https://github.com/dobinmathew-beep/nuvio-star-cards
- A24 JPG background set to pure black.
- Logo foreground sharpening adjusted to avoid halos.
- JPEG quality budget raised to a maximum target of 500 KB.
- A24 catalogue artwork/logo assets refreshed.
- Latest identified automated asset commit: `3d24b3123750c52cf22ae1ee2d77b1eb342515ce` (17 Nov 2026).

## Step-by-step owner health check
1. Open the repository and read `DAILY_UPDATES.md`.
2. Check the saved timestamp and each component's status.
3. Open `verification/latest.md` and check its timestamp and each PASS/FAIL line.
4. If a component is pending or the dashboard is stale, open the linked Actions run and inspect the exact step.
5. Test the actual public endpoint. A generated file existing in GitHub does not prove that the public service returned it.
6. For website changes, confirm the exact commit has a READY Vercel production deployment from `greta-site`.
7. For Render changes, confirm the service's latest deployed commit and status before calling it live.
8. Do not delete the `state` directory or the `renderer-source` / `legacy-site` releases; they are part of the recovery/history path.

## Explicitly not claimed as complete
- OTTASIA parser recovery and the earlier public-count discrepancy: no clean end-to-end resolution was evidenced by the latest report.
- Pending Malayalam/other identity matches: not described as matched or metadata-enriched.
- Upcoming poster-date badge overlay: not claimed functioning end-to-end.
- AIOMetadata Nuvio-specific deployment: not confirmed; previous GitHub write attempt returned 403.
- Payment checkout: not configured.
- Any Render deployment after the last previously confirmed service snapshot: not independently revalidated.

## Evidence links
- Daily status: https://github.com/dobinmathew-beep/nuvio-cloud-refresher/blob/main/DAILY_UPDATES.md
- Independent verification: https://github.com/dobinmathew-beep/nuvio-cloud-refresher/blob/main/verification/latest.md
- Daily history: https://github.com/dobinmathew-beep/nuvio-cloud-refresher/tree/main/logs
- Actions: https://github.com/dobinmathew-beep/nuvio-cloud-refresher/actions
- Vercel project: https://vercel.com/dobinmathew-3454/the-great-indian-addon
