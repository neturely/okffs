# Changelog

All notable changes to this project will be documented in this file.
See [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

## [0.10.1] - 2026-07-16
### Changed
- list_issues board column is cross-repo unsafe — project: reports another repo's status on number collisions ([#257](https://github.com/neturely/okffs/issues/257))
- Harden env-var parsing: filter empty entries in comma-list vars + audit empty/missing values ([#253](https://github.com/neturely/okffs/issues/253))
### Fixed
- address_pr_review: route protected-head fixes through fix_into_base, not a follow-up issue + issue branch ([#255](https://github.com/neturely/okffs/issues/255))

## [0.10.0] - 2026-07-14
### Added
- Autopilot / "minimum interference" mode — autonomous issue → develop-PR with a decisions report ([#238](https://github.com/neturely/okffs/issues/238))
### Fixed
- Silent auto-PR failure in create_issue - swallowed to stderr, retry on 422 ([#247](https://github.com/neturely/okffs/issues/247))

## [0.9.0] - 2026-07-11
### Changed
- commit_and_update: empty commit subject from whitespace-only or leading-blank-line hint ([#236](https://github.com/neturely/okffs/issues/236))
### Added
- `/okffs:setup` prompt + `configure` tool — configure okffs conversationally inside Claude Code (the in-chat counterpart to the `okffs setup` CLI). Claude interviews you from the same manifest the CLI uses and persists via `configure`, which writes only okffs's marked `.env` block and preserves your own variables/comments. On startup the server also stamps the configuring version and, when okffs has been upgraded and new options exist, nudges you (once) to run `/okffs:setup` ([#242](https://github.com/neturely/okffs/issues/242))
- `okffs setup` — an interactive CLI wizard to create/update `.env` for a repo, with Quick/Full first-run modes and a sync mode that only prompts for options new since your last run (e.g. after an okffs upgrade). Runs a non-fatal GitHub sanity check and prints a config banner. Reach it via `npx @neturely/okffs setup` ([#240](https://github.com/neturely/okffs/issues/240))

## [0.8.0] - 2026-07-08
### Added
- Add an issue-less "fix PR into base branch" tool (open + merge into develop, the mirror of promote_branch) ([#226](https://github.com/neturely/okffs/issues/226))
- merge_pull_request: accept pr_number for issue-less fix PRs into the base branch (merge-only mode) ([#224](https://github.com/neturely/okffs/issues/224))
### Changed
- Harden reply_to_review_comment against reply-without-resolve footgun ([#230](https://github.com/neturely/okffs/issues/230))
- commit_and_update: split hint into subject + body instead of a blind 72-char slice ([#228](https://github.com/neturely/okffs/issues/228))
- Document fix_into_base + merge_pull_request pr_number mode; remove leaked INSTRUCTIONS.md and gitignore it ([#232](https://github.com/neturely/okffs/issues/232))

## [0.7.0] - 2026-07-06
### Added
- Address #217 review: allow clearing milestone in update_issue + accurate auth wording ([#218](https://github.com/neturely/okffs/issues/218))
- Add merge-method-per-tier config: OKFFS_BASE_MERGE_METHOD / OKFFS_PROTECTED_MERGE_METHOD ([#209](https://github.com/neturely/okffs/issues/209))
- create_pull_request: opt-in draft/empty-branch mode to backfill a PR for a branch with no commits ([#205](https://github.com/neturely/okffs/issues/205))
- Add update_issue tool — mutate title/assignees/labels/milestone on an existing issue ([#203](https://github.com/neturely/okffs/issues/203))
- Support GitHub native Issue Types: infer + set on create_issue, surface in list_issues ([#201](https://github.com/neturely/okffs/issues/201))
### Changed
- Autonomous base-branch merge for green issue PRs (opt-in, heavily gated; never touches protected) ([#211](https://github.com/neturely/okffs/issues/211))

## [0.6.0] - 2026-07-05
### Fixed
- Reorganise env vars into labelled groups across .env.example and README (and fix stale/missing entries) ([#196](https://github.com/neturely/okffs/issues/196))
- Address Copilot review on promote_branch (#187): match open PR by head+base, drop unused import, fix stale comment ([#190](https://github.com/neturely/okffs/issues/190))
- Fix OKFFS_PROTECTED_BRANCH semantics: govern merging, not PR creation ([#181](https://github.com/neturely/okffs/issues/181))
### Added
- promote_branch: gate auto reviewer-request behind OKFFS_PROMOTION_AUTO_REVIEW (create-only), document Copilot cost ([#194](https://github.com/neturely/okffs/issues/194))
- address_pr_review: complete the loop when the reviewed PR's head is a protected branch (promotion/gate PRs) ([#192](https://github.com/neturely/okffs/issues/192))
- Add promote_branch tool: issue-less develop→main PR added to the board ([#182](https://github.com/neturely/okffs/issues/182))
### Changed
- promote_branch: guard PR body against auto-closing issues when the promotion base is the default branch ([#188](https://github.com/neturely/okffs/issues/188))
- Strengthen guidance so Claude prefers okffs tools over raw gh/git ([#183](https://github.com/neturely/okffs/issues/183))

## [0.5.2] - 2026-07-04
### Added
- okffs now sends MCP server `instructions` in its `initialize` response, which hosts (Claude Code, etc.) surface to the agent each session — steering it to prefer okffs tools over raw git/gh and to honour the `OKFFS_*` toggles. The brief ships with the package version, so upgrading okffs automatically updates the guidance the agent sees (how new tools get adopted instead of old habits) ([#169](https://github.com/neturely/okffs/issues/169)).
- New `set_issue_fields` tool sets a board Priority and/or Effort on an **existing** issue (adding it to the board first if needed), handling both project-native single-selects and org-level Issue Fields (classic PAT). `create_issue` only sets these at creation time; Status stays with `update_project_status` ([#171](https://github.com/neturely/okffs/issues/171)).
### Fixed
- `create_pull_request` now handles issues whose branch okffs didn't create (no `**Branch:**` line — e.g. pre-okffs issues or a hand-made branch): pass an explicit `branch`, or check out a `{issue-number}-…` branch to have it inferred, and okffs backfills the `**Branch:**` link onto the issue so later calls resolve it ([#173](https://github.com/neturely/okffs/issues/173)).

## [0.5.1] - 2026-07-04
### Added
- publish.yml: create the GitHub Release automatically on stable tags ([#156](https://github.com/neturely/okffs/issues/156))
- Add OKFFS_PROTECTED_BRANCH — hard confirmation gate before okffs promotes into a protected branch ([#152](https://github.com/neturely/okffs/issues/152))
### Changed
- Guidance: agents using okffs should prefer its tools/env over raw gh/git (fallback only) ([#154](https://github.com/neturely/okffs/issues/154))
### Fixed
- `delete_branch` and `delete_issue` no longer write changelog fragments for pure cleanup — `create_pull_request` remains the single source of auto-changelog entries, matching `close_issue` ([#160](https://github.com/neturely/okffs/issues/160)).
- `close_issue` now cleans up an untouched `OKFFS_AUTO_PR` draft: when an issue is closed with no work, its empty draft PR is closed and the branch deleted (a ready PR, or a branch with real commits, is left untouched) ([#162](https://github.com/neturely/okffs/issues/162)).

## [0.5.0] - 2026-07-04
### Changed
- Rewrote the README for a friendlier first read: a plain-language intro and one-step quickstart up front, the internal build-phase "Status" section removed, and the scattered env-var documentation consolidated into a single Configuration reference table. Development setup, publishing, and codebase-search detail moved to CONTRIBUTING.md (#142).
- `create_issue` now injects the board's **real** Priority/Effort option names into its inference guidance (resolved at tools/list time), so Claude infers against the actual board options — e.g. a `P0/P1/P2` board — instead of the generic `Urgent/High/Medium/Low` scale. Falls back to the generic scale when the board is unreachable or the options can't be read (#133).
### Fixed
- Harden org Issue Field / Projects queries against pagination truncation: bump the org `issueFields` and per-issue `issueFieldValues` page sizes (and the project `fields` query) so Priority/Effort are reliably found on boards/orgs with many fields, rather than being missed past the first page (PR #140 review). Also corrected the `create_pull_request` tool description to reflect the fragment-based `OKFFS_UPDATE_DOCS` behaviour (it writes a `.changes/unreleased/` fragment, not a direct `CHANGELOG.md` edit).
- Board Priority/Effort/initial-status steps that are skipped or fail are now surfaced in the tool response instead of only being written to the server's stderr (`console.warn`), which the host and user never see. When a field is requested but not applied (e.g. the board's field is an org-level Issue Field needing a classic PAT, or the value has no matching option), `create_issue`, `create_issues_from_list`, and `plan` now print a `⚠` line explaining why — an enabled board step is never silently dropped (#146).
- The org-level Issue Fields preview API (used for `list_issues` Priority/Effort and `create_issue` option lookup) is now retried up to 3 times with a short backoff on transient failures, making it far less likely to intermittently drop Priority/Effort. Permission errors (403/FORBIDDEN) are still reported immediately without retry (#137).
### Added
- `create_issues_from_list` and `plan` now place each issue on the GitHub Projects v2 board like `create_issue` does — adding it, setting an inferred/default Priority and Effort, and applying `OKFFS_PROJECT_INITIAL_STATUS` — when `OKFFS_PROJECT_AUTO_ADD=true`. Both tools gained per-task `priority`/`effort` params. Board logic is now shared in `src/board.ts` (#144).

## [0.4.0] - 2026-07-03
### Added
- Priority-aware workflow: `list_issues` now shows each issue's `priority:` and **orders the listing by Priority** (Urgent → High → Medium → Low → unset) so the most important work surfaces first when deciding what to do next. New `OKFFS_DEFAULT_PRIORITY` env var applies a fallback Priority to new issues when `create_issue` isn't given one (mirrors `OKFFS_DEFAULT_LABELS`). Priority is read from a project-native field, or a GitHub org-level Issue Field when `OKFFS_CLASSIC_PAT=true`.
- Effort support, mirroring Priority: `create_issue` accepts an `effort` param (plus `OKFFS_DEFAULT_EFFORT`), and `list_issues` shows each issue's `effort:`. Works with both a project-native Effort field and a GitHub org-level Issue Field (via `OKFFS_CLASSIC_PAT`). The org Issue Field layer was generalized (`getOrgIssueField(name)`, name-keyed project metadata) so Priority, Effort, and any future single-select field share one code path.
- `create_issue` now asks Claude to **infer** an issue's `priority` and `effort` from the task itself (using the common scale), the same way it already infers labels — falling back to `OKFFS_DEFAULT_PRIORITY`/`OKFFS_DEFAULT_EFFORT` only when it can't judge. Toggle per field with `OKFFS_INFER_PRIORITY` / `OKFFS_INFER_EFFORT` (default on). Injecting each board's real option names for accurate inference on non-standard boards is tracked in [#133](https://github.com/neturely/okffs/issues/133).
- `OKFFS_CLASSIC_PAT` env flag (default `false`) — gates the org-level Issue Field Priority path (#91) behind an explicit opt-in that declares `GITHUB_TOKEN` is a classic PAT with `admin:org`. When off, okffs skips the org `organization.issueFields` call entirely and tells you to set Priority in the UI, avoiding a doomed API call and keeping the broad-scoped-token requirement opt-in for this public package ([#91](https://github.com/neturely/okffs/issues/91)).
- `create_issue`'s `priority` now supports GitHub **org-level Issue Fields** (e.g. Priority), not just project-native single-select fields. When the board's Priority field reports no options (the org Issue Field signature), okffs resolves the option via `organization.issueFields` and sets it on the issue with `setIssueFieldValue`. Requires a classic PAT with `admin:org` (fine-grained PATs get FORBIDDEN for this preview API); degrades gracefully with an actionable `[okffs]` message otherwise ([#91](https://github.com/neturely/okffs/issues/91)).
- `OKFFS_PROJECT_INITIAL_STATUS` — pins a freshly auto-added issue to a chosen board column (e.g. `Backlog`). `create_issue` sets it after the draft PR is created so it wins over GitHub's "PR linked to issue" workflow, which otherwise flips scaffolded issues straight to "In Progress" ([#103](https://github.com/neturely/okffs/issues/103)).

### Changed
- `OKFFS_UPDATE_DOCS` now writes a per-issue changelog **fragment** at `.changes/unreleased/{issue-number}-{slug}.md` instead of editing the shared `CHANGELOG.md` on each branch, so parallel issue branches no longer conflict on the changelog. `prepare_release` assembles the fragments into `CHANGELOG.md` and deletes them in the release commit (changesets/towncrier pattern) ([#105](https://github.com/neturely/okffs/issues/105)).

### Fixed
- Projects v2 auto-add no longer fails silently: `create_issue` now surfaces an auto-add failure in its response (not just the server log), and the Projects permission error now recognises the `INSUFFICIENT_SCOPES` case and points at the gh-CLI fallback token's missing `project` scope ([#101](https://github.com/neturely/okffs/issues/101)).

## [0.3.0] - 2026-07-01
### Changed
- Harden publish workflow: prerelease-safe npm tag + verify-only job ([#95](https://github.com/neturely/okffs/issues/95))
- Phase 5: document Projects v2 integration (env vars, token scope, conversational flow) ([#85](https://github.com/neturely/okffs/issues/85))
- Phase 5: enrich list_issues with current project column ([#84](https://github.com/neturely/okffs/issues/84))
- Phase 5: Projects v2 GraphQL foundation — config, projects.ts, field discovery ([#81](https://github.com/neturely/okffs/issues/81))
### Added
- Automated MCP Registry publish on tag via GitHub OIDC — a `vX.Y.Z` tag now publishes to both npm and the MCP Registry, with no stored registry token ([#79](https://github.com/neturely/okffs/pull/79))
- Phase 5: clearer create_issue warning when Priority is an org Issue Field ([#93](https://github.com/neturely/okffs/issues/93))
- Phase 5: add update_project_status tool (Backlog/Ready/In Progress/Review) ([#82](https://github.com/neturely/okffs/issues/82))
- Phase 5: create_issue auto-add to board + priority field ([#83](https://github.com/neturely/okffs/issues/83))

## [0.2.2] - 2026-06-30
### Added
- Published to the official MCP Registry (`io.github.neturely/okffs`): added `server.json` and an `mcpName` field to `package.json` for registry package-ownership verification.

## [0.2.1] - 2026-06-30
### Changed
- Migrated the project to the `neturely` GitHub organization; updated repository, homepage, and documentation links accordingly.
- Renamed the npm package from `okffs` to the scoped `@neturely/okffs` (published publicly via `publishConfig.access`). The unscoped `okffs` package is deprecated — install `@neturely/okffs` going forward.
- README: removed the "Work in progress" banner and led the auth docs with the fine-grained PAT (classic PAT demoted to a fallback).

## [0.2.0] - 2026-06-28
### Fixed
- The MCP server now reports the real package version instead of a hard-coded `0.0.1`.
- Auto-doc entries are now concise title-based one-liners instead of truncated summary dumps; CLAUDE.md and CONTRIBUTING.md are no longer auto-updated (CHANGELOG.md, plus SECURITY.md when relevant, are the only auto-doc targets) ([#60](https://github.com/2b9sa2owa/okffs/issues/60)).
- Corrected the stale `OKFFS_EXCLUDE_DOCS` example in the README (valid options are `CHANGELOG.md`, `SECURITY.md`) ([#62](https://github.com/2b9sa2owa/okffs/issues/62)).

### Added
- `prepare_release` tool — bumps the version (`package.json` + `package-lock.json`), rolls the CHANGELOG (`[Unreleased]` → a dated version section with updated compare links), commits on a release branch, and opens a PR. Two-step confirm; explicit `version`/`bump` or inferred. Does not tag or publish ([#68](https://github.com/2b9sa2owa/okffs/issues/68)).
- `update_guidance` MCP prompt (slash command) that intelligently maintains a bounded, okffs-owned `## Project Guidance (okffs usage)` section of CLAUDE.md (marker-delimited; never touches your other content) to reflect new/changed functionality, plus the `OKFFS_UPDATE_GUIDANCE` env var to nudge it at PR time ([#64](https://github.com/2b9sa2owa/okffs/issues/64), [#66](https://github.com/2b9sa2owa/okffs/issues/66)).
- A Changelog section in the README linking to Releases and `CHANGELOG.md` ([#62](https://github.com/2b9sa2owa/okffs/issues/62)).
- PR review-response workflow: new `list_pr_review_comments`, `reply_to_review_comment`, and `resolve_review_thread` tools, plus an `address_pr_review` MCP prompt (slash command) that reads a PR's review comments, fixes them, replies per thread, and posts a summary. Thread resolution is gated by the new `OKFFS_RESOLVE_THREADS` env var (default off) ([#58](https://github.com/2b9sa2owa/okffs/issues/58)).
- Reduced auth/setup friction: token resolves from `GITHUB_TOKEN` or falls back to `gh auth token`, and owner/repo auto-detect from the `origin` git remote when env vars are unset ([#56](https://github.com/2b9sa2owa/okffs/issues/56)).

## [0.1.6] - 2026-06-27
### Added
- `plan` tool — takes a free-text description plus the issue breakdown Claude generates from it (titles, descriptions, labels, inter-task relationships), previews the plan, and creates all issues + branches (and draft PRs when `OKFFS_AUTO_PR=true`) in one shot. Resolves relationships to issue numbers and writes them to each issue's `## Relationships` section ([#42](https://github.com/2b9sa2owa/okffs/issues/42)).
- Redesigned `list_issues` — each open issue now shows its branch + URL, any linked open/draft PR (matched by head branch), and its relationships (parent, children, blocked-by, blocking) as a tree ([#43](https://github.com/2b9sa2owa/okffs/issues/43)).
- `OKFFS_IDENTIFIER` env var — when set, branch names use `{issue-number}-{identifier}-{slug}` instead of `{issue-number}-{slug}` ([#41](https://github.com/2b9sa2owa/okffs/issues/41)).

### Changed
- `OKFFS_UPDATE_DOCS` auto-changelog now fires only on `create_pull_request`; `comment_issue` and `close_issue` no longer trigger doc updates, making `create_pull_request` the single source of changelog entries and eliminating noisy/duplicate entries ([#47](https://github.com/2b9sa2owa/okffs/issues/47)).
- `create_pull_request` now commits all updated docs (CLAUDE.md, CONTRIBUTING.md, SECURITY.md), not just CHANGELOG.md.

### Fixed
- `OKFFS_AUTO_PR=true` left the CHANGELOG with no auto-update trigger. `create_pull_request` now reuses an existing open PR for the branch (e.g. a draft opened by `create_issue`), updating it and marking it ready for review instead of erroring ([#49](https://github.com/2b9sa2owa/okffs/issues/49)).
- Docs incorrectly claimed `Closes #N` auto-closes on merge to `main`; it only fires when merging into the repo's default branch. Corrected the docs and added a warning in `create_pull_request` when the PR base isn't the default branch ([#51](https://github.com/2b9sa2owa/okffs/issues/51)).

## [0.1.5] - 2026-06-26
### Added
- New `commit_and_update` tool — stages all changes, builds a commit message from a hint (or the changed file list), commits, pushes to the issue branch, and posts a rich progress comment to the linked issue.
- `prepublishOnly` hook so `dist/` is always freshly built before publishing.
- `.github/instructions/okffs.instructions.md` Copilot instructions file.

### Changed
- Redesigned `OKFFS_AUTO_PR`: a draft PR is now opened at branch-creation time by `create_issue` (instead of on issue close), pushing an empty init commit first so GitHub accepts the draft immediately.
- `close_issue` now returns a `/clear` tip and no longer triggers a PR on close.
- `CHANGELOG.md` is now shipped in the npm package.

### Fixed
- `create_pull_request` commits the updated CHANGELOG onto the branch and pushes the branch before opening the PR, with non-blocking error handling ([#38](https://github.com/2b9sa2owa/okffs/issues/38)).
- All git operations now run via `execFileSync` with argument arrays (no shell), removing command-injection risk from branch names and commit hints; tools also checkout the target branch before committing/pushing and restore the original branch afterward.

[Unreleased]: https://github.com/neturely/okffs/compare/v0.10.1...HEAD
[0.10.1]: https://github.com/neturely/okffs/compare/v0.10.0...v0.10.1
[0.10.0]: https://github.com/neturely/okffs/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/neturely/okffs/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/neturely/okffs/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/neturely/okffs/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/neturely/okffs/compare/v0.5.2...v0.6.0
[0.5.2]: https://github.com/neturely/okffs/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/neturely/okffs/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/neturely/okffs/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/neturely/okffs/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/neturely/okffs/compare/v0.2.2...v0.3.0
[0.2.2]: https://github.com/neturely/okffs/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/neturely/okffs/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/neturely/okffs/compare/v0.1.6...v0.2.0
[0.1.6]: https://github.com/neturely/okffs/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/neturely/okffs/compare/v0.1.4...v0.1.5
