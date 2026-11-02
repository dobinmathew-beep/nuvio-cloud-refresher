# External scheduler activation
Status: cron-job.org job **8777026** is **enabled** as of 2026-11-02 (Asia/Muscat), every ten minutes with no schedule expiry. Saved credential tested successfully: GitHub returned HTTP 200 and created [watchdog run 41464248660](https://github.com/dobinmathew-beep/nuvio-cloud-refresher/actions/runs/41464248660). The watchdog passed all seven tests and successfully dispatched media (backdrops plus reels), addon and EPG for the overdue 18:00 Muscat cycle. Component refreshes were in progress at activation. The scheduler listed its next automatic execution at 18:50 Muscat. Token value is not stored in this repository; its expiry remains controlled by the owner.

All four outputs are due every two hours in Asia/Muscat. One external job dispatches the existing watchdog every ten minutes, including each two-hour boundary. The watchdog checks published success state and starts only overdue work. GitHub's own ten-minute schedule and workflow-completion checks remain as backups.

## cron-job.org job
- Name: Nuvio four-output refresh watchdog (every 10 minutes)
- Enabled; no schedule expiry; timezone Asia/Muscat.
- Every hour, minutes 0, 10, 20, 30, 40, 50; every day/month/weekday.
- Method POST; timeout 30 seconds; do not treat redirects as success.
- URL: https://api.github.com/repos/dobinmathew-beep/nuvio-cloud-refresher/actions/workflows/refresh-watchdog.yml/dispatches
- Body: `{"ref":"main"}`
- Headers: Accept `application/vnd.github+json`, Content-Type `application/json`, X-GitHub-Api-Version `2026-03-10`, User-Agent `NuvioExternalWatchdog`.
- Authorization header: `Bearer <restricted GitHub token>`. Enter only inside the scheduler account; never commit a real token.
- Enable failure and automatic-disable notifications. Routine success notifications are unnecessary.

The API-shaped template is [cron-job.template.json](../scheduler/cron-job.template.json). Its placeholder is deliberately unusable. Review existing account jobs before creating anything to avoid duplicates.

## Credential
The owner must authorize a fine-grained GitHub token limited to `dobinmathew-beep/nuvio-cloud-refresher`, with Actions read and write. GitHub automatically includes required metadata read access. No contents write or organization-wide access is needed. The connected ChatGPT GitHub credential is not available for reuse by an external scheduler. Keep the token out of URLs, repository files and logs. Record its expiry privately and renew it before expiry; account policies may require one.

## Activation checks
1. Sign in to cron-job.org and configure this exact job with the credential.
2. Test once. A successful GitHub dispatch response confirms acceptance, not refresh completion.
3. Verify the matching watchdog run in GitHub Actions. It must check media (backdrops plus reels), addon and EPG and dispatch overdue components.
4. Check completion and published output state; confirm a second watchdog check does not duplicate queued or active work.
5. Confirm the scheduler's next execution and successful execution history.

After successful activation, record the non-secret job ID and activation date here. Do not claim activation without those checks.

## Limits and recovery
Checks repeat after failures or stale cycles until every output is current. Successful work is retained; completed two-hour cycles are skipped. Active/queued component jobs are not duplicated and dispatches have a ten-minute cooldown. Source failures preserve last-good output. HTTP dispatch failure notifications come from cron-job.org; downstream workflow failures remain visible in GitHub.

An external trigger avoids relying only on GitHub cron delivery. GitHub runner queues, upstream outages, revoked/expired tokens or an automatically disabled scheduler can still delay or stop work. Neither service provides an infinite or exact-minute guarantee.

References: https://docs.cron-job.org/rest-api.html and https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event
