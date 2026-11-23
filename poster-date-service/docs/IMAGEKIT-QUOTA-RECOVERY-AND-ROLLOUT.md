# ImageKit quota recovery and December rollout runbook

This runbook is operational guidance only. It does not perform ImageKit deletion, mutate durable queue state, alter manifests, or deploy Render services.

## Protected scope

- Keep the three public Nuvio Custom URLs unchanged:
  `https://great-indian-upcoming-posters.onrender.com/poster/{imdb_id}.jpg`
- Keep BetterPosters fallback and the existing Just Added / upcoming-date badge precedence.
- Do not change the Nuvio Star Cards repository, service, assets, or configuration.
- Keep the poster service on the existing Free plan; no paid-plan upgrade is assumed.
- Do not deploy while Render reports the poster service as suspended by billing.

## ImageKit storage recovery — approval already given for retention policy, not blind deletion

The earlier targeted audit recorded:
- Durable queue state: 2,527 historical versions; about 1.43 GB of historical-version bytes.
- Manifest checkpoint: 7,877 historical versions; about 1.04 GB of historical-version bytes.
- Combined: 10,404 historical versions and about 2.47 GB represented by the old-version inventory.
- Proposed retention: current version plus the latest three previous versions for each of those two JSON files.

These are historical audit figures, not a current account snapshot. The exact version IDs and newest-version ordering can change as workflows write new state. **Do not use an old CSV or the old version-ID list as a deletion command.**

### Required pre-deletion checks

1. Re-run a fresh, read-only ImageKit inventory for both exact file paths.
2. Verify each file's current version and order all historical versions by authoritative creation time.
3. Independently confirm the current version plus latest three previous versions to retain for each file.
4. Produce a new deletion CSV containing only older versions; include file path, file ID, version ID, creation time, and byte size.
5. Check that the deletion set excludes every retained version and excludes all other ImageKit assets.
6. Compare the deletion CSV against the previous audit and report the exact count/bytes before execution.
7. Obtain a final human review of the fresh deletion set, then delete only the approved old versions.
8. Re-run inventory and verify that both JSON files still resolve, their retained versions remain, and account usage actually fell.

No ImageKit deletion has been executed by this PR. The current connected toolset does not expose an ImageKit version-deletion action, so this runbook does not pretend the cleanup has happened.

## Durable queue recovery — blocked until storage is writable

- The previous drain attempt was rejected by ImageKit with HTTP 403, `Upload Limit Exceeded`.
- Do not retry queue draining while the account rejects writes.
- After verified storage recovery, first perform a read-only queue inspection and confirm the queue-state file is readable and writable.
- Preserve the existing durable queue records. Drain in small, observable batches; verify each batch's recorded/processed/failed counts before continuing.
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
