# ImageKit quota recovery and December rollout runbook

This runbook is operational guidance only. It does not perform ImageKit deletion, mutate durable queue state, alter manifests, or deploy Render services.

## Protected scope

- Keep the three public Nuvio Custom URLs unchanged:
  `https://great-indian-upcoming-posters.onrender.com/poster/{imdb_id}.jpg`
- Keep BetterPosters fallback and the existing Just Added / upcoming-date badge precedence.
- Do not change the Nuvio Star Cards repository, service, assets, or configuration.
- Keep the poster service on the existing Free plan; no paid-plan upgrade is assumed.
- Do not deploy while Render reports the poster service as suspended by billing.

## ImageKit storage recovery — updated retention policy

The user has superseded the previous current-plus-three-previous retention policy.

**New target for each verified poster identity: retain exactly one active/current poster and one historical poster.** For versioned assets, retain the current version and the single newest valid historical version. For separate poster files representing the same verified IMDb/TMDB/TVMaze identity, retain the active canonical file and at most one newest valid historical fallback. Remove other versions/files only after a fresh inventory proves their identity and verifies they are not active pointer targets.

The earlier targeted audit recorded:
- Durable queue state: 2,527 historical versions; about 1.43 GB of historical-version bytes.
- Manifest checkpoint: 7,877 historical versions; about 1.04 GB of historical-version bytes.
- Combined: 10,404 historical versions and about 2.47 GB represented by the old-version inventory.

These are historical audit figures, not a current account snapshot. Exact version IDs, file IDs, and newest-version ordering can change as workflows write new state. **Never use an old CSV or old version-ID list as a deletion command.**

### Required pre-deletion checks

1. Re-run a fresh, read-only ImageKit inventory and read each candidate's current file details and version list.
2. Resolve each poster to a verified stable identity (prefer IMDb ID; use TMDB/TVMaze only where the existing identity mapping proves equivalence). Do not group by fuzzy title text alone.
3. Verify the active canonical poster pointer for each identity and its exact target file/version.
4. Retain the active/current poster plus exactly one newest valid historical poster/version. If the historical candidate is missing, unreadable, corrupt, or identity-ambiguous, retain all uncertain assets and report the exception.
5. For separate poster files, compare full CDN readback SHA-256 and content type. Identical copies may be nominated as duplicates; different artwork may be nominated only when the verified identity mapping and current-pointer protection prove it is an obsolete extra poster for the same title.
6. Exclude every active pointer target, every current canonical poster, all queue/checkpoint files not explicitly in the approved scope, all non-poster categories, and every item with unknown identity, unknown timestamp, failed readback, or incomplete inventory.
7. Produce a fresh deletion CSV with category, stable title identity, file path, file ID, version ID (where applicable), creation time, byte size, SHA-256/readback result, active-pointer status, keep/delete reason, and exact reclaimed-byte estimate.
8. Validate mechanically that the proposed keep set contains the active poster and one historical fallback for each eligible identity, and that no delete candidate overlaps any protected ID/path/version.
9. Review the fresh candidate counts and bytes before execution. Delete in small batches with a stop-on-first-error policy.
10. Re-run inventory and verify active poster resolution, the retained historical fallback, pointer integrity, and actual account-usage reduction.

**Do not interpret this policy as permission to delete all assets that merely share a display title.** Stable identity, active pointer checks, and a successful readback are mandatory.

No ImageKit deletion has been executed by this PR. The connected tools available in this session expose GitHub and Render but no direct ImageKit version/file deletion action. Do not claim cleanup is complete or attempt an unverified workaround.

## Durable queue recovery — blocked until storage is writable

- The previous drain attempt was rejected by ImageKit with HTTP 403, `Upload Limit Exceeded`.
- Do not retry queue draining while the account rejects writes.
- Apply no poster-retention deletion rule blindly to durable queue/checkpoint records. Audit these separately and preserve the latest valid current state plus a recoverable prior state until a dedicated queue-state recovery review approves a narrower policy.
- After verified storage recovery, first perform a read-only queue inspection and confirm the queue-state file is readable and writable.
- Preserve existing durable queue records. Drain in small, observable batches; verify each batch's recorded/processed/failed counts before continuing.
- Stop immediately if ImageKit returns another quota/permission error. Do not run parallel drains.

## Render quota and December rollout

The last verified Render state was billing suspension of both services in the shared workspace. The poster service is `great-indian-upcoming-posters`; Star Cards is `nuvio-star-cards`. Shared quota suspension does not mean Star Cards code was changed.

Before any rollout after the monthly quota reset:
1. Verify Render Billing > Monthly Included Usage has reset and there is usable outbound allowance. Do not assume a precise reset time.
2. Re-read both Render service states. Proceed only if the poster service is no longer billing-suspended; do not modify Star Cards.
3. Confirm PR #53's latest head has passing poster-service tests, durable-queue read-only gate, three-manifest read-only scan, and full Just Added audit.
4. Confirm the audit report is uploaded and inspect any failures/skipped dynamic catalogues.
5. Confirm ImageKit storage is writable and the quota circuit is not being triggered by test uploads.
6. Deploy only the poster-service branch after explicit rollout readiness review. Keep the three catalogue URLs unchanged.
7. Monitor Render outbound bandwidth, memory/OOM events, request status codes, ImageKit upload responses, queue depth, and fallback response headers.
8. Stop rollout/queue processing if bandwidth spikes, OOMs recur, ImageKit rejects writes, or badge audit reveals regressions.

## Validation boundaries

The live three-manifest validation and durable-queue read-only gate can run without mutating ImageKit or production queues. The full badge audit is also read-only but may take longer because it walks catalogue pages. A passing read-only scan is not proof that the durable queue has drained or that ImageKit writes are available.
