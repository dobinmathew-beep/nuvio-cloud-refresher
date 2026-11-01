# India EPG

Daily GitHub Actions refresh at 04:00 UTC (08:00 Muscat). GitHub may queue scheduled runs.
Use **Actions → India EPG daily refresh → Run workflow** for an extra refresh.

Permanent player URL: https://da.gd/mr8mVT

The workflow fetches the latest IPTV-org India playlist, canonical channel database,
four provider mapping registries and thirteen configured guide feeds. Every current
channel is reconsidered. Only confident identities with usable future programmes
are included. HD, regional and digital variants stay separate. No invented schedules.

The six published guide/report files are stored atomically on the existing public
EPG host. `/status.json` identifies the verified GitHub workflow run. Each Actions
run also retains its downloadable guide and audit reports for 14 days. Failed input
downloads, invalid guides and coverage drops over 20% preserve the last valid feed.
The workflow retries up to three times and fails visibly if it cannot complete.

Authentication uses a short-lived GitHub-signed OIDC identity restricted by the
host to this repository ID, owner ID, main branch and exact workflow path. No
ChatGPT execution, ChatGPT credential, personal access token or repository secret
is needed. Forks and pull-request jobs cannot publish.

Source listings are supplied by upstream guide providers; broadcast accuracy and
complete coverage cannot be guaranteed. Unresolved channels are listed explicitly
in `Unresolved_Channels.csv`.
