# Independent Nuvio output verification

**Checked:** 2026-11-10T11:27:42.555948+04:00 (Oman time)
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
- **PASS** public status and freshness: {"revision": "8754c4a9-d7bb-4a3a-a310-6e4d1031d9a9", "checked_utc": "2026-11-10T06:00:58.973808+00:00", "matched_ids": 631, "playlist_channel_ids": 836, "unresolved_ids": 205, "programmes": 70233}
- **PASS** published XMLTV: {"bytes": 2136262, "channels": 631, "programmes": 70233}
- **PASS** Channel_Matching_Report.csv: {"rows": 836}
- **PASS** Unresolved_Channels.csv: {"rows": 205}
- **PASS** Source_Crosscheck_Report.csv: {"rows": 3161}
- **PASS** Validation_Summary.json: {"keys": ["checked_utc", "playlist_url", "playlist_sha256", "playlist_channel_ids", "matched_ids", "unresolved_ids", "programmes", "sources_with_parsed_guides", "selected_source_counts", "unresolved_reason_counts"]}
- **PASS** Source_Health_Report.json: {"keys": ["airtel.xml", "ca.xml", "dishtv.xml", "free-epg.xml", "guide.xml", "jiotv.xml", "open-india.xml", "pw.xml", "samsung-in.xml", "sundirectgo.xml"]}

## Backdrops — PASS
{
  "day": "2026-11-10",
  "statuses": 160,
  "images": 16,
  "states": {
    "live": 160,
    "cached": 0
  },
  "errors": []
}

## Reels — FAIL
- **FAIL** hindi: "HTTP Error 503: Service Unavailable"
- **FAIL** tamil: "HTTP Error 503: Service Unavailable"
- **FAIL** malayalam: "HTTP Error 503: Service Unavailable"
- **FAIL** telugu: "HTTP Error 503: Service Unavailable"
