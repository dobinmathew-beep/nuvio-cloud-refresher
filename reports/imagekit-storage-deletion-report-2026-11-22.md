# ImageKit storage deletion report — preliminary

**Generated:** 2026-11-22  
**Status:** PRELIMINARY / NOT APPROVED FOR DELETION  
**Scope:** Historical Render maintenance and upload logs available before the read-only audit endpoint is deployed.

## Executive result

No individual ImageKit file or version can yet be responsibly approved for deletion from the historical evidence alone. **Confirmed deletion candidates: 0. Files deleted during this investigation: 0.**

Repeated upload events are evidence of possible version growth, not proof that separate files are redundant. Each candidate must be verified against current ImageKit file IDs, versions, SHA-256 content, and live poster pointers.

## Historical inventory evidence

Latest available maintenance record (2026-11-20T22:49:40.121Z):

| Measure | Historical value | Interpretation |
|---|---:|---|
| Account files listed | 1,207 | Historical file inventory |
| Poster files scanned | 625 | Files under the dedicated poster folder |
| Other files | 582 | Outside poster-folder cleanup; retain pending folder/content review |
| Duplicate files deleted by that run | 0 | No separate duplicate-file deletion was recorded |
| Expired files deleted | 0 | No expired-file deletion was recorded |
| Historical versions deleted | 1,974 | Already removed by that maintenance run; not new candidates |
| Unknown posters retained | 561 | Intentionally retained because status was unknown |
| Version checks failed | 0 | Version checks succeeded in that run |
| Reported account bytes | 128,295,930 | Historical internal value only; do not treat as authoritative |
| Reported account GiB | 0.119 | Historical internal value only |

The old maintenance implementation had a storage-accounting defect: after deleting old versions it added the deleted bytes back into its running total instead of subtracting them. Therefore the historical byte total is not reliable as a current ImageKit usage measurement.

## Repeated-upload investigation targets

These identities appeared repeatedly in the latest 100 upload log entries reviewed. Counts represent log events, **not verified duplicate files or version counts**.

| Poster identity | Upload log events | Deletion status |
|---|---:|---|
| tmdb-1819380 | 13 | Investigate versions; do not delete |
| tmdb-1813865 | 7 | Investigate versions; do not delete |
| tmdb-337440 | 5 | Investigate versions; do not delete |
| tt5456546 | 4 | Investigate versions; do not delete |
| tmdb-1628781 | 4 | Investigate versions; do not delete |
| tt9420648 | 2 | Investigate versions; do not delete |
| tt22297178 | 2 | Investigate versions; do not delete |
| tt27328373 | 2 | Investigate versions; do not delete |
| tt7986222 | 2 | Investigate versions; do not delete |
| tt0107290 | 2 | Investigate versions; do not delete |
| tt36303063 | 2 | Investigate versions; do not delete |
| tt31844371 | 2 | Investigate versions; do not delete |
| tt41054228 | 2 | Investigate versions; do not delete |

## Protected assets and exclusions

- All canonical public poster paths remain protected.
- All current versioned-poster pointer targets remain protected.
- Every version for an IMDb ID with a missing, invalid, or unreadable pointer remains protected.
- Files without a known creation date, and versions inside the 30-day retention window, are not deletion candidates.
- The 561 unknown-status poster records from the historical report remain excluded from deletion.
- The 582 non-poster files are outside the poster cleanup scope and must not be removed by this feature.
- No automatic deletion endpoint or destructive maintenance path is exposed by this change.

## Live report required before approval

PR #33 adds a token-protected, read-only report endpoint that:
1. Reads ImageKit's account media-library storage usage metric.
2. Inventories current assets and checks version history.
3. Recognises IMDb, TMDB, and TVMaze fallback poster filenames.
4. Confirms duplicate poster files only after byte-for-byte SHA-256 readback.
5. Validates current poster pointers before nominating old immutable versions.
6. Emits exact file IDs, version IDs, paths, byte counts, and protection reasons.
7. Performs no DELETE requests.

After the code is safely deployed, the live report must be generated and reviewed. Only exact candidate IDs explicitly approved after that report may be deleted.

## Approval decision

**No deletion is requested or recommended from this preliminary report.** Await the live read-only inventory and a second approval for any exact candidate IDs.
