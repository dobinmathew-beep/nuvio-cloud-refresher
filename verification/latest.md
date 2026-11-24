# Independent Nuvio output verification

**Checked:** 2026-11-25T00:53:12.368808+04:00 (Oman time)
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
- **PASS** public status and freshness: {"revision": "e5273973-3e1d-45e1-bb45-1b80542b5940", "checked_utc": "2026-11-24T20:47:38.957801+00:00", "matched_ids": 536, "playlist_channel_ids": 808, "unresolved_ids": 272, "programmes": 59918}
- **PASS** published XMLTV: {"bytes": 1792131, "channels": 536, "programmes": 59918}
- **PASS** Channel_Matching_Report.csv: {"rows": 808}
- **PASS** Unresolved_Channels.csv: {"rows": 272}
- **PASS** Source_Crosscheck_Report.csv: {"rows": 2218}
- **PASS** Validation_Summary.json: {"keys": ["checked_utc", "playlist_url", "playlist_sha256", "playlist_channel_ids", "matched_ids", "unresolved_ids", "programmes", "sources_with_parsed_guides", "selected_source_counts", "unresolved_reason_counts"]}
- **PASS** Source_Health_Report.json: {"keys": ["airtel.xml", "ca.xml", "dishtv.xml", "free-epg.xml", "guide.xml", "jiotv.xml", "open-india.xml", "pw.xml", "samsung-in.xml", "sundirectgo.xml"]}

## Backdrops — FAIL
"[{\"status\": \"tamil/movies/wall\", \"error\": \"incorrect current catalog-head centre movie\"}, {\"status\": \"tamil/movies/cascade\", \"error\": \"incorrect current catalog-head centre movie\"}, {\"status\": \"tamil/movies/filmstrip\", \"error\": \"incorrect current catalog-head centre movie\"}, {\"status\": \"tamil/movies/spotlight\", \"error\": \"incorrect current catalog-head centre movie\"}, {\"status\": \"tamil/movies/gallery\", \"error\": \"incorrect current catalog-head centre movie\"}]"

## Reels — PASS
- **PASS** hindi: 50.0
- **PASS** tamil: 50.0
- **PASS** malayalam: 50.0
- **PASS** telugu: 50.0
