# Independent Nuvio output verification

**Checked:** 2026-11-23T17:55:21.639583+04:00 (Oman time)
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
- **PASS** public status and freshness: {"revision": "82cfdefb-82d2-4f5d-a089-597a0d4ded82", "checked_utc": "2026-11-23T12:15:05.729355+00:00", "matched_ids": 617, "playlist_channel_ids": 832, "unresolved_ids": 215, "programmes": 55564}
- **PASS** published XMLTV: {"bytes": 1939940, "channels": 617, "programmes": 55564}
- **PASS** Channel_Matching_Report.csv: {"rows": 832}
- **PASS** Unresolved_Channels.csv: {"rows": 215}
- **PASS** Source_Crosscheck_Report.csv: {"rows": 3029}
- **PASS** Validation_Summary.json: {"keys": ["checked_utc", "playlist_url", "playlist_sha256", "playlist_channel_ids", "matched_ids", "unresolved_ids", "programmes", "sources_with_parsed_guides", "selected_source_counts", "unresolved_reason_counts"]}
- **PASS** Source_Health_Report.json: {"keys": ["airtel.xml", "dishtv.xml", "free-epg.xml", "jiotv.xml", "open-india.xml", "pw.xml", "samsung-in.xml", "sundirectgo.xml", "tvepg-jio.xml", "yupptv.xml"]}

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
