# Independent Nuvio output verification

**Checked:** 2026-11-21T23:41:25.936358+04:00 (Oman time)
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
- **PASS** public status and freshness: {"revision": "1be5c024-0df1-49ad-8334-95a46857a149", "checked_utc": "2026-11-21T17:52:00.480096+00:00", "matched_ids": 662, "playlist_channel_ids": 873, "unresolved_ids": 211, "programmes": 71490}
- **PASS** published XMLTV: {"bytes": 2068672, "channels": 662, "programmes": 71490}
- **PASS** Channel_Matching_Report.csv: {"rows": 873}
- **PASS** Unresolved_Channels.csv: {"rows": 211}
- **PASS** Source_Crosscheck_Report.csv: {"rows": 3497}
- **PASS** Validation_Summary.json: {"keys": ["checked_utc", "playlist_url", "playlist_sha256", "playlist_channel_ids", "matched_ids", "unresolved_ids", "programmes", "sources_with_parsed_guides", "selected_source_counts", "unresolved_reason_counts"]}
- **PASS** Source_Health_Report.json: {"keys": ["airtel.xml", "ca.xml", "dishtv.xml", "free-epg.xml", "guide.xml", "jiotv.xml", "open-india.xml", "pw.xml", "samsung-in.xml", "sundirectgo.xml"]}

## Backdrops — PASS
{
  "day": "2026-11-21",
  "statuses": 160,
  "images": 16,
  "states": {
    "live": 160,
    "cached": 0
  },
  "errors": [],
  "catalogHeads": {
    "tamil": "tt18933846",
    "hindi": "tt37200939",
    "malayalam": "tt41944351",
    "telugu": "tt36915004"
  }
}

## Reels — PASS
- **PASS** hindi: 50.0
- **PASS** tamil: 50.0
- **PASS** malayalam: 50.0
- **PASS** telugu: 50.0
