# The Great Indian Addon — Owner's Handbook (Updated)
**Evidence date:** 18 November 2026 (Oman time)  
**Revision:** Render services rechecked; poster badge service confirmed live; OTTASIA parser marked complete per owner confirmation.

## Evidence rule
This handover separates independently verified hosting/deployment evidence from owner-confirmed functional status. A deployment being live is not proof that every title or edge case works. Unresolved metadata identities and payment setup remain separate open items.

## Latest independent public verification
The repository file `verification/latest.md` records **18 Nov 2026, 06:19:05 +04:00**, overall **4/4 outputs passed**:
- **Addon — PASS:** public manifest and all eight catalog endpoints; each returned 50 entries.
- **EPG — PASS:** XMLTV 2,055,611 bytes; 612 matched channel IDs out of 820; 66,531 programmes; reports checked.
- **Backdrops — PASS:** 160 statuses, all live; 16 image checks; zero errors.
- **Reels — PASS:** Hindi, Tamil, Malayalam and Telugu public reel endpoints all passed.

The daily dashboard at 06:20 showed the 04:00 combined backdrop/reel refresh still running or queued, while the 06:00 addon and EPG refreshes were updated. The independent public endpoints nevertheless passed at 06:19. This distinction is preserved.

## How the system works
Public sources → GitHub Actions → GitHub repository/state → Vercel and Render → Nuvio/browser.
GitHub Actions runs Python/FFmpeg jobs on hosted runners; the owner's computer and ChatGPT session do not need to stay on. The recurring refresh jobs do not call an AI API.

## Automation timing
- Main refresh workflow checks every 30 minutes.
- Outputs are due on a two-hour cadence in Asia/Muscat time.
- A watchdog checks overdue work and retries pending components.
- Active/queued work is not duplicated.
- Last-good public outputs are preserved when an attempt is incomplete.
- GitHub can delay scheduled runs; exact-minute completion is not guaranteed.

## Repository and branch map
Repository: https://github.com/dobinmathew-beep/nuvio-cloud-refresher

| Branch | Plain-English purpose | Current role |
|---|---|---|
| `main` | Workflow schedules, automation, state, status dashboard and verification reports | Operational control |
| `dobins-catalog` | Generated catalogue data consumed by the addon API | Catalogue data |
| `greta-site` | Great Indian Addon website and API source | Vercel production source |
| `poster-date-service` | Upcoming poster/date-badge service | Render production source; LIVE |
| `upcoming-poster-stack` | Alternate/experimental poster work | Not treated as production |

Related repositories:
- https://github.com/dobinmathew-beep/nuvio-star-cards — branch `main`; Star Cards/A24 visual assets; Render service LIVE.
- https://github.com/dobinmathew-beep/aiometadata-nuvio-edition — default branch `dev`; public AIOMetadata fork. Its Nuvio-specific deployment is not confirmed, so it is not described as a deployed deliverable.

## Completed outputs

### The Great Indian Addon
- Eight catalogs: Malayalam/Tamil/Telugu/Hindi × Movies/Series.
- All eight public endpoints returned 50 entries each in the latest independent check.
- Manifest and Nuvio page-size/skip pagination compatibility allow clients to request further pages.
- Latest daily status listed 937 catalog entries and 73 pending identity matches. Pending matches are not treated as verified.
- Checkout health response was `ready:false` and `configured:false`; payment is not claimed as complete.

### OTTASIA parser — complete (owner-confirmed)
The user has confirmed the OTTASIA parser work is complete and functioning. This supersedes the earlier edition's statement that parser recovery was unresolved.
In plain English, the parser is a translator between OTTASIA's source response and the project's standard catalogue format:
1. It reads the OTTASIA source response.
2. It extracts the title information.
3. It converts the information into the standard catalogue structure used by the project.
4. The catalogue pipeline can then perform title identity and metadata checks.
5. Eligible records can be published through the public catalogue service.

**Important:** a working parser does not automatically mean every title has a confirmed IMDb/TMDB identity. Any individual title still marked unmatched or pending must remain so until its own identity check passes. The earlier public-count/pagination concern is a separate publication/delivery check, not evidence that the parser is still incomplete.

### Regional backdrops
- 160 regional status URLs are checked/warmed with concurrency capped at four.
- 16 representative JPEG URLs are checked for HTTP 200 and image/jpeg.
- Centre artwork follows the first eligible IMDb-linked movie in the matching IndianRegional primary movie catalog order.
- TMDB-only composite titles can contribute surrounding art but cannot displace the centre movie.
- Series-only collections remain series-only.
- Latest independent public verification: 160 live statuses, 16 image checks, zero errors.

### Hero reels
- Four language MP4 endpoints: Hindi, Tamil, Malayalam and Telugu.
- Renderer selects eligible IMDb-linked titles in IndianRegional catalogue order.
- Latest daily status recorded 20 films per language in the current reel manifest.
- 50-second continuous audio bed, projector treatment and compact H.264/AAC output are retained.
- New assets are validated and uploaded before public media pointers change; last-good output is preserved on failure.
- All four public reel endpoints passed the 18 November independent check.

Direct links:
- Hindi: https://dobin-nuvio-star-cards.quickfield138.chatgpt.site/hero/hindi.mp4
- Tamil: https://dobin-nuvio-star-cards.quickfield138.chatgpt.site/hero/tamil.mp4
- Malayalam: https://dobin-nuvio-star-cards.quickfield138.chatgpt.site/hero/malayalam.mp4
- Telugu: https://dobin-nuvio-star-cards.quickfield138.chatgpt.site/hero/telugu.mp4

### India EPG
- Published XMLTV: 2,055,611 bytes.
- 612 matched channel IDs from 820 playlist channel IDs.
- 208 unresolved channel IDs.
- 66,531 programmes.
- Channel matching, unresolved-channel, source cross-check and source-health reports passed validation.
- Unresolved channels are reported; schedules are not invented.

## Upcoming poster badges — complete and live
The user confirms poster badges are working successfully. Render independently confirms the poster service is currently live.
- Service: `great-indian-upcoming-posters`
- URL: https://great-indian-upcoming-posters.onrender.com
- Repository: `dobinmathew-beep/nuvio-cloud-refresher`
- Branch: `poster-date-service`
- Runtime: Node.js web service; free plan; Singapore region.
- Auto-deploy: enabled; service not suspended.
- Latest live deployment: `dep-dbts0e3m8hqs73f79oa0`
- Latest live commit: `f67bf31e21b1995f8eed15950a4ef80925c8716c`
- Commit message: “Improve OCR date badge matching when labels are missed”
- Deployment completed: 17 Nov 2026, 02:47:56 UTC.

Implemented poster-date improvements visible in deployed history:
- OCR date-badge matching is more tolerant when the expected label is missing or imperfect.
- Exact TVmaze episode date matching.
- Upcoming badge selection uses the next future episode.
- Generic TMDB poster ID route support.

Plain-English request flow:
1. Nuvio or the website requests a poster using a supported title/poster ID.
2. The poster service resolves the title and available episode metadata.
3. The relevant episode date is checked.
4. OCR/date matching recognises the date badge information on the poster.
5. The poster response is returned to the client.

The current live service status and user confirmation support listing this feature as completed. As with all date-based features, a specific poster can still depend on the quality and availability of its source image and episode metadata.

## Vercel — latest confirmed evidence
Project: `the-great-indian-addon`; repository: `dobinmathew-beep/nuvio-cloud-refresher`.
- Latest deployment record: `dpl_2zNQgqdAiA2sei14Chx91jf9W4gD`
- State: `READY`, target: production
- Branch: `greta-site`
- Commit: `dcc11ed04167b67ef73d2a3dbdb8427991b6cc89`
- Node.js: 22.x
- Project aliases include `the-great-indian-addon.vercel.app` and `greta-indian-catalog.vercel.app`.
Older ERROR and CANCELED records are not counted as completed. READY confirms deployment/build state, not every browser interaction.

## Render — live services verified 18 November 2026
Workspace: **Dobin's workspace** (confirmed by the user).

| Service | Repository / branch | Latest live commit | Status |
|---|---|---|---|
| `nuvio-star-cards` | `nuvio-star-cards` / `main` | `3d24b3123750c52cf22ae1ee2d77b1eb342515ce` — “Refresh A24 catalog artwork and logo assets” | LIVE |
| `great-indian-upcoming-posters` | `nuvio-cloud-refresher` / `poster-date-service` | `f67bf31e21b1995f8eed15950a4ef80925c8716c` — OCR badge matching improvement | LIVE |

Star Cards service:
- URL: https://nuvio-star-cards.onrender.com
- Type: static site; auto-deploy enabled; not suspended.
- Latest deployment: `dep-dbu3smtg1s2s73es8m60`, completed 17 Nov 2026 11:45:49 UTC.
- A24 catalogue artwork and logo assets are refreshed in the live deployment.

Upcoming poster service:
- URL: https://great-indian-upcoming-posters.onrender.com
- Type: Node web service; free plan; Singapore region; auto-deploy enabled; not suspended.
- Latest deployment: `dep-dbts0e3m8hqs73f79oa0`, completed 17 Nov 2026 02:47:56 UTC.

## Step-by-step owner health check
1. Open the repository and read `DAILY_UPDATES.md`.
2. Check the saved timestamp and each component's status.
3. Open `verification/latest.md` and check its timestamp and every PASS/FAIL line.
4. If a component is pending or the dashboard is stale, open the linked Actions run and inspect the exact step.
5. Test the actual public endpoint. A generated file existing in GitHub does not prove the public service returned it.
6. For website changes, confirm the exact commit has a READY Vercel production deployment from `greta-site`.
7. For Render changes, confirm the service's latest deployed commit and status before calling it live.
8. Do not delete the `state` directory or `renderer-source` / `legacy-site` releases; they are part of the recovery/history path.

## Still not claimed as complete
- Payment checkout: not configured in the latest public health response.
- Pending title identity matches: must be resolved title by title; parser completion is not the same as all identities being resolved.
- AIOMetadata Nuvio-specific fork deployment: not independently confirmed.
- A specific future episode badge remains dependent on source image and metadata availability.

## Evidence links
- Daily status: https://github.com/dobinmathew-beep/nuvio-cloud-refresher/blob/main/DAILY_UPDATES.md
- Independent verification: https://github.com/dobinmathew-beep/nuvio-cloud-refresher/blob/main/verification/latest.md
- Daily history: https://github.com/dobinmathew-beep/nuvio-cloud-refresher/tree/main/logs
- Actions: https://github.com/dobinmathew-beep/nuvio-cloud-refresher/actions
- Vercel project: https://vercel.com/dobinmathew-3454/the-great-indian-addon
- Render Star Cards: https://dashboard.render.com/static/srv-dbr5rmt6e07s73akemgg
- Render upcoming posters: https://dashboard.render.com/web/srv-dbqabquc6qcc739lmi00
