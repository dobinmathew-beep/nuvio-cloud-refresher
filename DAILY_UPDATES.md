# Daily updates

**Backdrops · Reels · Addon · India EPG**

Last checked: **26 Nov 2026, 18:35 Oman time**. [This check’s logs](https://github.com/dobinmathew-beep/nuvio-cloud-refresher/actions/runs/45840580188)

**Refresh checks:** every 30 minutes. Outputs refresh when their two-hour cycle is due. **Dashboard:** refreshed immediately when a media, addon, or EPG workflow completes, plus the 30-minute watchdog check.

> This is the last saved check, not a live clock. If it is more than 45 minutes old, open Actions to investigate. GitHub and network delays remain possible.

| Output | Status at last check | Last successful refresh run (Oman) | Last verified cycle / check (Oman) | Details | Latest attempt |
|---|---|---|---|---|---|
| Backdrops | public-verification-failed | 26 Nov 2026, 17:49 · [Open run and full logs](https://github.com/dobinmathew-beep/nuvio-cloud-refresher/actions/runs/45831166681) | 26 Nov 2026, 16:00 | 160 layouts; 16 image checks; this part verified, combined media cycle still pending | in_progress · [Open run and full logs](https://github.com/dobinmathew-beep/nuvio-cloud-refresher/actions/runs/45840580298) |
| Reels | public-verification-failed | 26 Nov 2026, 17:49 · [Open run and full logs](https://github.com/dobinmathew-beep/nuvio-cloud-refresher/actions/runs/45831166681) | 26 Nov 2026, 16:00 | 4 languages; 20 films per reel; this part verified, combined media cycle still pending | in_progress · [Open run and full logs](https://github.com/dobinmathew-beep/nuvio-cloud-refresher/actions/runs/45840580298) |
| Addon | 🔄 Retry requested | 26 Nov 2026, 17:38 · [Open run and full logs](https://github.com/dobinmathew-beep/nuvio-cloud-refresher/actions/runs/45829588505) | 26 Nov 2026, 16:00 | 1087 catalog entries; 64 pending matches | queued · [Open run and full logs](https://github.com/dobinmathew-beep/nuvio-cloud-refresher/actions/runs/45840611708) |
| EPG | 🔄 Retry requested | 26 Nov 2026, 17:40 · [Open run and full logs](https://github.com/dobinmathew-beep/nuvio-cloud-refresher/actions/runs/45831190112) | 26 Nov 2026, 17:39 | 603 / 839 channel IDs with listings; 236 unresolved; 66766 programmes. | queued · [Open run and full logs](https://github.com/dobinmathew-beep/nuvio-cloud-refresher/actions/runs/45840631764) |

✅ Updated = verified for the current two-hour cycle. 🔄 Running / retry requested = work is pending. ⚠️ / ❌ = attention or retry needed. The two media outputs share one workflow and both must pass before the combined cycle is complete.

A successful check can keep the same movies or listings when the source has not changed. EPG unresolved channels remain explicit; schedules are never invented.

## Today and past days

- [Today’s detailed timeline](logs/2026-11-26/README.md)
- [Daily history — all saved dates](logs/README.md)
- [All GitHub runs and full logs](https://github.com/dobinmathew-beep/nuvio-cloud-refresher/actions)

## Issues at this check

- media: independent public verification failed: backdrops: {"layout": "tamil/movies/wall", "expected": {"id": "tmdb:1822586", "name": "Mazhalai"}, "actual": "tt18933846", "selection": "catalog-order", "catalogRank": 0, "renderVersion": "catalog-head-v2"}

## Useful links

- [Backdrops](https://dobin-nuvio-live-backdrops.quickfield138.chatgpt.site)
- [Reels](https://dobin-nuvio-star-cards.quickfield138.chatgpt.site)
- [Addon](https://the-great-indian-addon.vercel.app)
- [EPG download](https://da.gd/mr8mVT)

Daily records are kept in this repository from dashboard installation onward, with every completed watchdog check, its outcome, public verification details, latest workflow attempts and links to full logs. GitHub controls retention of full Actions logs. No token or authentication header is recorded.

[Repository home](README.md)
