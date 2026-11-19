# Independent Nuvio output verification

**Checked:** 2026-11-20T03:42:26.025224+04:00 (Oman time)
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
- **PASS** public status and freshness: {"revision": "10db1390-04d0-4f25-91eb-0534be4dc9a4", "checked_utc": "2026-11-19T18:32:11.939109+00:00", "matched_ids": 623, "playlist_channel_ids": 833, "unresolved_ids": 210, "programmes": 66297}
- **PASS** published XMLTV: {"bytes": 2081733, "channels": 623, "programmes": 66297}
- **PASS** Channel_Matching_Report.csv: {"rows": 833}
- **PASS** Unresolved_Channels.csv: {"rows": 210}
- **PASS** Source_Crosscheck_Report.csv: {"rows": 2781}
- **PASS** Validation_Summary.json: {"keys": ["checked_utc", "playlist_url", "playlist_sha256", "playlist_channel_ids", "matched_ids", "unresolved_ids", "programmes", "sources_with_parsed_guides", "selected_source_counts", "unresolved_reason_counts"]}
- **PASS** Source_Health_Report.json: {"keys": ["airtel.xml", "ca.xml", "dishtv.xml", "free-epg.xml", "guide.xml", "jiotv.xml", "open-india.xml", "pw.xml", "samsung-in.xml", "sundirectgo.xml"]}

## Backdrops — FAIL
"[{\"status\": \"hindi/movies/spotlight\", \"error\": \"saved featured selection is stale: tt50107649 != current catalog head tt37200939\"}, {\"status\": \"hindi/movies/filmstrip\", \"error\": \"saved featured selection is stale: tt50107649 != current catalog head tt37200939\"}, {\"status\": \"hindi/movies/wall\", \"error\": \"saved featured selection is stale: tt50107649 != current catalog head tt37200939\"}, {\"status\": \"hindi/movies/cascade\", \"error\": \"saved featured selection is stale: tt50107649 != current catalog head tt37200939\"}, {\"status\": \"hindi/movies/ribbon\", \"error\": \"saved featured selection is stale: tt50107649 != current catalog head tt37200939\"}]"

## Reels — PASS
- **PASS** hindi: 50.0
- **PASS** tamil: 50.0
- **PASS** malayalam: 50.0
- **PASS** telugu: 50.0
