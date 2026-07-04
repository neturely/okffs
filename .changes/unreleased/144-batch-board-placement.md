<!-- okffs:type=Added -->
- `create_issues_from_list` and `plan` now place each issue on the GitHub Projects v2 board like `create_issue` does — adding it, setting an inferred/default Priority and Effort, and applying `OKFFS_PROJECT_INITIAL_STATUS` — when `OKFFS_PROJECT_AUTO_ADD=true`. Both tools gained per-task `priority`/`effort` params. Board logic is now shared in `src/board.ts` (#144).
