# Refresh reliability

The 2 November investigation found active workflows but no scheduled runs after 01:41 UTC, before that day's due times. GitHub exposes no failed-job log when a scheduled event never starts, so its internal cause could not be established. Earlier successful checks before the due time correctly skipped work. A prior catalog push rejection also exposed a race between concurrent branch updates.

## Recovery

- Media remains due at 06:00 Muscat; checks at minutes 7 and 37 catch up an incomplete daily cycle.
- Catalog keeps its 06:00/18:00 Muscat release cycles and extra Thursday–Saturday 01:00 cycle; checks at minutes 13 and 43 catch up overdue cycles.
- EPG remains due at 08:00 Muscat; minutes 11 and 41 check the published generation date and refresh only when due. Explicit manual runs can refresh again.
- The separate watchdog checks at minutes 17 and 47 and after completion of any refresh workflow. It reads real success cycles, not green run badges. Overdue workflows are dispatched automatically unless one is already active or a run started within the past 45 minutes.
- A daily health checkpoint and changes between fresh/in-progress/error states are recorded in `state/watchdog.json`. Watchdog job summaries report current checks, and stale checks fail visibly.
- State pushes pull and rebase disjoint remote changes before retrying. Conflicting changes fail; no force-push is used.

The EPG validates source identities, XMLTV and public downloads and retains its previous valid revision on rejected updates. Media retains last-good assets until replacements verify. Partial media progress is saved for the next check.

Everything executes in GitHub Actions without ChatGPT or a personal computer. These checks reduce missed-trigger risk but share GitHub's availability: if all GitHub schedules stop, an on-GitHub watchdog cannot run until a trigger resumes. Providers and hosting can also fail. This is automatic recovery, not an indefinite uptime guarantee.
