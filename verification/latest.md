# Independent Nuvio output verification

**Checked:** 2026-11-14T12:48:19.021635+04:00 (Oman time)
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
- **PASS** public status and freshness: {"revision": "b39e8559-4028-45f4-ad07-2b182357585a", "checked_utc": "2026-11-14T08:47:00.083359+00:00", "matched_ids": 613, "playlist_channel_ids": 825, "unresolved_ids": 212, "programmes": 70114}
- **PASS** published XMLTV: {"bytes": 2173942, "channels": 613, "programmes": 70114}
- **PASS** Channel_Matching_Report.csv: {"rows": 825}
- **PASS** Unresolved_Channels.csv: {"rows": 212}
- **PASS** Source_Crosscheck_Report.csv: {"rows": 3196}
- **PASS** Validation_Summary.json: {"keys": ["checked_utc", "playlist_url", "playlist_sha256", "playlist_channel_ids", "matched_ids", "unresolved_ids", "programmes", "sources_with_parsed_guides", "selected_source_counts", "unresolved_reason_counts"]}
- **PASS** Source_Health_Report.json: {"keys": ["airtel.xml", "ca.xml", "dishtv.xml", "free-epg.xml", "guide.xml", "jiotv.xml", "open-india.xml", "pw.xml", "samsung-in.xml", "sundirectgo.xml"]}

## Backdrops — PASS
{
  "day": "2026-11-14",
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
    "telugu": "tt32324552"
  }
}

## Reels — PASS
- **PASS** hindi: 50.0
- **PASS** tamil: 50.0
- **PASS** malayalam: 50.0
- **PASS** telugu: 50.0
