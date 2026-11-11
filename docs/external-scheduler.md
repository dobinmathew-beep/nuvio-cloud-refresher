# External scheduler — retired at the GitHub endpoint
Status: the external cron-job.org job **8777026** was previously enabled every ten minutes. On 2026-11-11, the GitHub `workflow_dispatch` trigger was removed from `refresh-watchdog.yml`, so this external job can no longer start the watchdog. The job itself remains configured in cron-job.org and must be disabled there to stop its rejected requests. No credential is stored in this repository.

All four outputs retain their two-hour due cycle in Asia/Muscat. GitHub's native watchdog now checks every 30 minutes and dispatches only overdue work. The old external ten-minute trigger and workflow-completion triggers have been removed.

## cron-job.org job — disable manually
- Job ID: 8777026
- Previously named: Nuvio four-output refresh watchdog (every 10 minutes)
- It must now be disabled in cron-job.org; its GitHub dispatch target no longer accepts workflow dispatch.
- Method POST; timeout 30 seconds; do not treat redirects as success.
- URL: https://api.github.com/repos/dobinmathew-beep/nuvio-cloud-refresher/actions/workflows/refresh-watchdog.yml/dispatches
- Body: `{"ref":"main"}`
- Headers: Accept `application/vnd.github+json`, Content-Type `application/json`, X-GitHub-Api-Version `2026-03-10`, User-Agent `NuvioExternalWatchdog`.
- Authorization header: `Bearer <restricted GitHub token>`. Enter only inside the scheduler account; never commit a real token.
- Enable failure and automatic-disable notifications. Routine success notifications are unnecessary.

The old request template is retained for historical reference only. Do not reactivate or recreate this job.

## Credential
No external scheduler credential is needed for the current native GitHub schedule. Do not re-enable the old token-based dispatch.

## Activation checks
1. Sign in to cron-job.org and configure this exact job with the credential.
2. Test once. A successful GitHub dispatch response confirms acceptance, not refresh completion.
3. Verify the matching watchdog run in GitHub Actions. It must check media (backdrops plus reels), addon and EPG and dispatch overdue components.
4. Check completion and published output state; confirm a second watchdog check does not duplicate queued or active work.
5. Confirm the scheduler's next execution and successful execution history.

To stop the external requests completely, sign in to cron-job.org, open job 8777026, and disable or delete it.

## Limits and recovery
Checks repeat after failures or stale cycles until every output is current. Successful work is retained; completed two-hour cycles are skipped. Active/queued component jobs are not duplicated and watchdog retries have a 30-minute cooldown. Source failures preserve last-good output. HTTP dispatch failure notifications come from cron-job.org; downstream workflow failures remain visible in GitHub.

An external trigger avoids relying only on GitHub cron delivery. GitHub runner queues, upstream outages, revoked/expired tokens or an automatically disabled scheduler can still delay or stop work. Neither service provides an infinite or exact-minute guarantee.

References: https://docs.cron-job.org/rest-api.html and https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event
