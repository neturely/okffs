# Changelog

All notable changes to this project will be documented in this file.
See [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

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

[Unreleased]: https://github.com/2b9sa2owa/okffs/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/2b9sa2owa/okffs/compare/v0.1.6...v0.2.0
[0.1.6]: https://github.com/2b9sa2owa/okffs/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/2b9sa2owa/okffs/compare/v0.1.4...v0.1.5
