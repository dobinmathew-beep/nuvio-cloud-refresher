# Independent Nuvio output verification

**Checked:** 2026-11-12T23:58:28.664152+04:00 (Oman time)
**Overall:** 3/4 outputs passed

| Output | Result |
|---|---|
| Addon | PASS |
| Epg | PASS |
| Backdrops | FAIL |
| Reels | PASS |

## Addon — PASS
- **PASS** public manifest: {"name": "The Great Indian Addon", "catalogs": 8}
- **PASS** all eight public catalog endpoints: {"catalogs": 8, "entries": {"dobins_ml_movie": 50, "dobins_ml_series": 50, "dobins_ta_movie": 50, "dobins_ta_series": 50, "dobins_te_movie": 50, "dobins_te_series": 50, "dobins_hi_movie": 50, "dobins_hi_series": 50}}
- **PASS** public health endpoint: {"checkout": {"ready": false, "configured": false, "provider": "Bank Muscat", "amountMode": "provider-entered"}}

## Epg — PASS
- **PASS** public status and freshness: {"revision": "f12e3953-e5fb-4405-8231-3a6501651eac", "checked_utc": "2026-11-12T18:34:02.818064+00:00", "matched_ids": 618, "playlist_channel_ids": 826, "unresolved_ids": 208, "programmes": 66028}
- **PASS** published XMLTV: {"bytes": 2061604, "channels": 618, "programmes": 66028}
- **PASS** Channel_Matching_Report.csv: {"rows": 826}
- **PASS** Unresolved_Channels.csv: {"rows": 208}
- **PASS** Source_Crosscheck_Report.csv: {"rows": 2784}
- **PASS** Validation_Summary.json: {"keys": ["checked_utc", "playlist_url", "playlist_sha256", "playlist_channel_ids", "matched_ids", "unresolved_ids", "programmes", "sources_with_parsed_guides", "selected_source_counts", "unresolved_reason_counts"]}
- **PASS** Source_Health_Report.json: {"keys": ["airtel.xml", "ca.xml", "dishtv.xml", "free-epg.xml", "guide.xml", "jiotv.xml", "open-india.xml", "pw.xml", "samsung-in.xml", "sundirectgo.xml"]}

## Backdrops — FAIL
"[{\"status\": \"tamil/series/towers\", \"error\": \"day: '2026-11-13', expected '2026-11-12'\"}, {\"status\": \"tamil/series/neon\", \"error\": \"day: '2026-11-13', expected '2026-11-12'\"}, {\"status\": \"tamil/combined/cascade\", \"error\": \"day: '2026-11-13', expected '2026-11-12'\"}, {\"status\": \"tamil/combined/wall\", \"error\": \"day: '2026-11-13', expected '2026-11-12'\"}, {\"status\": \"tamil/combined/spotlight\", \"error\": \"day: '2026-11-13', expected '2026-11-12'\"}]"

## Reels — PASS
- **PASS** hindi: 50.0
- **PASS** tamil: 50.0
- **PASS** malayalam: 50.0
- **PASS** telugu: 50.0
