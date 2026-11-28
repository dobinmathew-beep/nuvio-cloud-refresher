# Independent Nuvio output verification

**Checked:** 2026-11-28T18:11:19.710593+04:00 (Oman time)
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
- **PASS** public status and freshness: {"revision": "0e5c2668-b5be-4fb2-8804-a1648a2c4d31", "checked_utc": "2026-11-28T12:39:23.035822+00:00", "matched_ids": 612, "playlist_channel_ids": 856, "unresolved_ids": 244, "programmes": 66501}
- **PASS** published XMLTV: {"bytes": 1914709, "channels": 612, "programmes": 66501}
- **PASS** Channel_Matching_Report.csv: {"rows": 856}
- **PASS** Unresolved_Channels.csv: {"rows": 244}
- **PASS** Source_Crosscheck_Report.csv: {"rows": 2714}
- **PASS** Validation_Summary.json: {"keys": ["checked_utc", "playlist_url", "playlist_sha256", "playlist_channel_ids", "matched_ids", "unresolved_ids", "programmes", "sources_with_parsed_guides", "selected_source_counts", "unresolved_reason_counts"]}
- **PASS** Source_Health_Report.json: {"keys": ["airtel.xml", "ca.xml", "dishtv.xml", "free-epg.xml", "guide.xml", "jiotv.xml", "open-india.xml", "pw.xml", "samsung-in.xml", "sundirectgo.xml"]}

## Backdrops — FAIL
"{\"layout\": \"tamil/movies/wall\", \"expected\": {\"id\": \"tmdb:1822586\", \"name\": \"Mazhalai\"}, \"actual\": \"tt18933846\", \"selection\": \"catalog-order\", \"catalogRank\": 0, \"renderVersion\": \"catalog-head-v2\"}"

## Reels — PASS
- **PASS** hindi: 50.0
- **PASS** tamil: 50.0
- **PASS** malayalam: 50.0
- **PASS** telugu: 50.0
