# Independent Nuvio output verification

**Checked:** 2026-11-24T02:17:44.093641+04:00 (Oman time)
**Overall:** 4/4 outputs passed

| Output | Result |
|---|---|
| Addon | PASS |
| Epg | PASS |
| Backdrops | PASS |
| Reels | PASS |

## Addon — PASS
- **PASS** public manifest: {"name": "The Great Indian Addon", "catalogs": 8}
- **PASS** all eight public catalog endpoints: {"catalogs": 8, "entries": {"dobins_ml_movie": 50, "dobins_ml_series": 50, "dobins_ta_movie": 50, "dobins_ta_series": 50, "dobins_te_movie": 50, "dobins_te_series": 50, "dobins_hi_movie": 50, "dobins_hi_series": 50}}
- **PASS** public health endpoint: {"checkout": {"ready": false, "configured": false, "provider": "Bank Muscat", "amountMode": "provider-entered"}}

## Epg — PASS
- **PASS** public status and freshness: {"revision": "401ce60e-0f5d-4c10-8487-90e8d1c5fd51", "checked_utc": "2026-11-23T14:27:05.678561+00:00", "matched_ids": 612, "playlist_channel_ids": 832, "unresolved_ids": 220, "programmes": 67789}
- **PASS** published XMLTV: {"bytes": 2743070, "channels": 612, "programmes": 67789}
- **PASS** Channel_Matching_Report.csv: {"rows": 832}
- **PASS** Unresolved_Channels.csv: {"rows": 220}
- **PASS** Source_Crosscheck_Report.csv: {"rows": 2804}
- **PASS** Validation_Summary.json: {"keys": ["checked_utc", "playlist_url", "playlist_sha256", "playlist_channel_ids", "matched_ids", "unresolved_ids", "programmes", "sources_with_parsed_guides", "selected_source_counts", "unresolved_reason_counts"]}
- **PASS** Source_Health_Report.json: {"keys": ["airtel.xml", "ca.xml", "dishtv.xml", "free-epg.xml", "guide.xml", "jiotv.xml", "pw.xml", "samsung-in.xml", "sundirectgo.xml", "tvepg-jio.xml"]}

## Backdrops — PASS
{
  "day": "2026-11-23",
  "statuses": 160,
  "images": 16,
  "states": {
    "live": 160,
    "cached": 0
  },
  "errors": [],
  "catalogHeads": {
    "hindi": "tt37200939",
    "tamil": "tt18933846",
    "malayalam": "tt41944351",
    "telugu": "tt36915004"
  }
}

## Reels — PASS
- **PASS** hindi: 50.0
- **PASS** tamil: 50.0
- **PASS** malayalam: 50.0
- **PASS** telugu: 50.0
