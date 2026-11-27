# ImageKit Media Library storage reconciliation request

Prepared: 2026-11-28  
Repository audit run: https://github.com/dobinmathew-beep/nuvio-cloud-refresher/actions/runs/46067342086

## Observed discrepancy

The ImageKit Account Usage API reported `mediaLibraryStorageBytes = 2,484,238,528` bytes (approximately 2.484 GB).

A complete read-only inventory of the Media Library found:

- 10,559 files across 20 folders.
- All 10,559 files had their version lists retrieved.
- No folder/file pagination truncation or listing failures.
- No version-listing failures.
- No missing current versions, current-version size mismatches, or duplicate version IDs.
- Current file bytes: 288,564,912.
- Historical version bytes: 548,546,853.
- Current plus historical bytes inventoried: 837,111,765.
- Difference between the Account Usage metric and the complete inventory: 1,647,126,763 bytes (approximately 1.647 GB).

The audit made no mutation requests: zero deletes, uploads, moves, or updates.

## Request to ImageKit Support

Please explain what storage components are included in the `mediaLibraryStorageBytes` metric that are not represented by the complete file-and-version inventory above. In particular:

1. Can the account contain Media Library assets or version records that are omitted from the List Files / List File Versions APIs?
2. Are there pending deletions, soft-deleted assets, hidden/system assets, or delayed storage-accounting records included in this metric?
3. Is there an account-level storage breakdown or diagnostic endpoint that can reconcile the 1,647,126,763-byte difference?
4. Can you verify whether this is a reporting delay or an account-side accounting discrepancy?

Please investigate using the audit timestamp and request ID below.

- Audit timestamp: 2026-11-27T21:00:08.779Z
- Account Usage API request ID: `06fcae97-3be4-4599-9981-6d5df16d63da`

No files or versions should be deleted to address this discrepancy until ImageKit explains the metric difference. The inventory is complete at the API file/folder/version level, and the unexplained bytes must not be assumed to be orphaned or safe to remove.
