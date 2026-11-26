# Independent Nuvio output verification

**Checked:** 2026-11-26T21:03:35.827960+04:00 (Oman time)
**Overall:** 3/4 outputs passed

| Output | Result |
|---|---|
| Addon | PASS |
| Epg | PASS |
| Backdrops | PASS |
| Reels | FAIL |

## Addon — PASS
- **PASS** public manifest: {"name": "The Great Indian Addon", "catalogs": 8}
- **PASS** all eight public catalog endpoints: {"catalogs": 8, "entries": {"dobins_ml_movie": 50, "dobins_ml_series": 50, "dobins_ta_movie": 50, "dobins_ta_series": 50, "dobins_te_movie": 50, "dobins_te_series": 50, "dobins_hi_movie": 50, "dobins_hi_series": 50}}
- **PASS** public health endpoint: {"checkout": {"ready": false, "configured": false, "provider": "Bank Muscat", "amountMode": "provider-entered"}}

## Epg — PASS
- **PASS** public status and freshness: {"revision": "5db0a523-e829-4c71-8361-d11f64047bb7", "checked_utc": "2026-11-26T16:03:45.703021+00:00", "matched_ids": 603, "playlist_channel_ids": 839, "unresolved_ids": 236, "programmes": 64415}
- **PASS** published XMLTV: {"bytes": 2011876, "channels": 603, "programmes": 64415}
- **PASS** Channel_Matching_Report.csv: {"rows": 839}
- **PASS** Unresolved_Channels.csv: {"rows": 236}
- **PASS** Source_Crosscheck_Report.csv: {"rows": 2666}
- **PASS** Validation_Summary.json: {"keys": ["checked_utc", "playlist_url", "playlist_sha256", "playlist_channel_ids", "matched_ids", "unresolved_ids", "programmes", "sources_with_parsed_guides", "selected_source_counts", "unresolved_reason_counts"]}
- **PASS** Source_Health_Report.json: {"keys": ["airtel.xml", "ca.xml", "dishtv.xml", "free-epg.xml", "guide.xml", "jiotv.xml", "open-india.xml", "pw.xml", "samsung-in.xml", "sundirectgo.xml"]}

## Backdrops — PASS
{
  "day": "2026-11-26",
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

## Reels — FAIL
- **PASS** hindi: 50.0
- **PASS** tamil: 50.0
- **FAIL** malayalam: "public bytes/hash differ from media manifest"
- **PASS** telugu: 50.0
