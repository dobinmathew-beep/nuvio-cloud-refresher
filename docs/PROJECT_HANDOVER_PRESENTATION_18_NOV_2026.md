# Project handover presentation — slide source
**The Great Indian Addon | 18 November 2026**

1. **Cover** — The Great Indian Addon: project handover; completed work only; evidence date 18 Nov 2026.
2. **Architecture** — Public sources → GitHub Actions → repository/state → Vercel + public media hosting → Nuvio/browser.
3. **Branch map** — main = automation/state/reports; dobins-catalog = generated catalog data; greta-site = website/API. poster-date-service and upcoming-poster-stack are listed only as non-production/unfinished.
4. **Automation** — 30-minute check/watchdog; two-hour output refresh cadence in Asia/Muscat; preserve last-good outputs; retry unfinished work.
5. **Latest verification** — 18 Nov 2026 06:19 Oman: 4/4 public outputs passed.
6. **Addon catalogs** — 8 catalogs; 50 records returned per public endpoint; Nuvio pagination compatibility; 937 entries in daily dashboard; 73 pending identity matches; checkout not configured.
7. **India EPG** — 612/820 channel IDs matched; 66,531 programmes; 208 unresolved; reports validated.
8. **Backdrops** — 160 live statuses; 16 image checks; first eligible IMDb-linked catalog movie is centre artwork.
9. **Hero reels** — Hindi/Tamil/Malayalam/Telugu; catalog-order selection; 20 films per language in latest daily status; compact MP4/projector format; last-good output protection.
10. **Vercel** — latest production-target deployment READY; branch greta-site; commit dcc11ed04167b67ef73d2a3dbdb8427991b6cc89; Node 22.x.
11. **Render** — Star Cards previously confirmed deployed from main; A24 asset refresh commit 3d24b3123750c52cf22ae1ee2d77b1eb342515ce; current Render deployment not freshly rechecked.
12. **Related repositories** — nuvio-cloud-refresher; nuvio-star-cards; aiometadata-nuvio-edition (fork, not confirmed deployed).
13. **Owner's health check** — Daily updates → independent verification → Actions logs → public endpoint → exact hosting deployment commit.
14. **Excluded items** — OTTASIA parser resolution, pending identity matches, upcoming poster badge, AIOMetadata Nuvio deployment, payment checkout, unverified Render redeployments.
15. **Evidence directory** — repository README, DAILY_UPDATES.md, verification/latest.md, logs, Actions, Vercel project.

## Presenter notes
- A PASS on a public endpoint is distinct from a scheduled refresh being fully completed.
- The dashboard at 06:20 showed addon and EPG updated at 06:00, while the combined backdrop/reel cycle was still running/queued from 04:00. The independent check at 06:19 passed all four public endpoints.
- A Vercel READY deployment confirms build/deploy state, not every site interaction.
- Do not claim the latest A24 asset commit is on Render until the service's latest deployed commit is checked.
- Pending matches and unresolved EPG channels are reported honestly, not silently filled.
