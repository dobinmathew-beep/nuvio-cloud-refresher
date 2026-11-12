# Independent Nuvio output verification

**Checked:** 2026-11-13T01:05:27.327155+04:00 (Oman time)
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
- **PASS** public status and freshness: {"revision": "e3f11303-a5bd-4bbf-83f8-34bc0ff7bfd1", "checked_utc": "2026-11-12T20:24:21.679446+00:00", "matched_ids": 619, "playlist_channel_ids": 826, "unresolved_ids": 207, "programmes": 69527}
- **PASS** published XMLTV: {"bytes": 2181000, "channels": 619, "programmes": 69527}
- **PASS** Channel_Matching_Report.csv: {"rows": 826}
- **PASS** Unresolved_Channels.csv: {"rows": 207}
- **PASS** Source_Crosscheck_Report.csv: {"rows": 2790}
- **PASS** Validation_Summary.json: {"keys": ["checked_utc", "playlist_url", "playlist_sha256", "playlist_channel_ids", "matched_ids", "unresolved_ids", "programmes", "sources_with_parsed_guides", "selected_source_counts", "unresolved_reason_counts"]}
- **PASS** Source_Health_Report.json: {"keys": ["airtel.xml", "ca.xml", "dishtv.xml", "free-epg.xml", "guide.xml", "jiotv.xml", "open-india.xml", "pw.xml", "samsung-in.xml", "sundirectgo.xml"]}

## Backdrops — PASS
{
  "day": "2026-11-13",
  "statuses": 160,
  "images": 16,
  "states": {
    "live": 160,
    "cached": 0
  },
  "errors": [],
  "catalogHeads": {
    "hindi": "tt27988879",
    "tamil": "tt33318732",
    "malayalam": "tt27512908",
    "telugu": "tt32089596"
  }
}

## Reels — FAIL
- **FAIL** hindi: "public bytes/hash differ from media manifest"
- **FAIL** tamil: "public bytes/hash differ from media manifest"
- **FAIL** malayalam: "public bytes/hash differ from media manifest"
- **FAIL** telugu: "public bytes/hash differ from media manifest"
