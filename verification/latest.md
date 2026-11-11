# Independent Nuvio output verification

**Checked:** 2026-11-11T10:31:06.386441+04:00 (Oman time)
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
- **PASS** public status and freshness: {"revision": "27df24d3-0e48-4f89-a5a9-2778d523a918", "checked_utc": "2026-11-11T06:00:52.830724+00:00", "matched_ids": 622, "playlist_channel_ids": 824, "unresolved_ids": 202, "programmes": 64469}
- **PASS** published XMLTV: {"bytes": 1996024, "channels": 622, "programmes": 64469}
- **PASS** Channel_Matching_Report.csv: {"rows": 824}
- **PASS** Unresolved_Channels.csv: {"rows": 202}
- **PASS** Source_Crosscheck_Report.csv: {"rows": 3152}
- **PASS** Validation_Summary.json: {"keys": ["checked_utc", "playlist_url", "playlist_sha256", "playlist_channel_ids", "matched_ids", "unresolved_ids", "programmes", "sources_with_parsed_guides", "selected_source_counts", "unresolved_reason_counts"]}
- **PASS** Source_Health_Report.json: {"keys": ["airtel.xml", "ca.xml", "dishtv.xml", "free-epg.xml", "guide.xml", "jiotv.xml", "open-india.xml", "pw.xml", "samsung-in.xml", "sundirectgo.xml"]}

## Backdrops — PASS
{
  "day": "2026-11-11",
  "statuses": 160,
  "images": 16,
  "states": {
    "live": 160,
    "cached": 0
  },
  "errors": [],
  "catalogHeads": {
    "tamil": "tt39239754",
    "hindi": "tt27988879",
    "malayalam": "tt27512908",
    "telugu": "tt32089596"
  }
}

## Reels — PASS
- **PASS** hindi: 50.0
- **PASS** tamil: 50.0
- **PASS** malayalam: 50.0
- **PASS** telugu: 50.0
