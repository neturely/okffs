<!-- okffs:type=Added -->
- `commit_and_update` infers the issue branch from a checked-out `{issue}-…` branch (or a new explicit `branch` param) when the issue has no **Branch:** line, and backfills the line — the same evidence `create_pull_request` trusts ([#304](https://github.com/neturely/okffs/issues/304))
