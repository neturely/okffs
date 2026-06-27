# Changelog

All notable changes to this project will be documented in this file.
See [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]
### Added
- Redesigned `list_issues` — each open issue now shows its branch + URL, any linked open/draft PR (matched by head branch), and its relationships (parent, children, blocked-by, blocking) as a tree ([#43](https://github.com/2b9sa2owa/okffs/issues/43)).
- New `plan` tool — takes a free-text description plus the issue breakdown Claude generates from it (titles, descriptions, labels, inter-task relationships), previews the plan, and creates all issues + branches in one shot. Resolves relationships to issue numbers and opens a draft PR per branch when `OKFFS_AUTO_PR=true` ([#42](https://github.com/2b9sa2owa/okffs/issues/42)).
- `OKFFS_IDENTIFIER` env var — when set, branch names use `{issue-number}-{identifier}-{slug}` instead of `{issue-number}-{slug}` ([#41](https://github.com/2b9sa2owa/okffs/issues/41)).

### Changed
- `OKFFS_UPDATE_DOCS` auto-changelog now fires only on `create_pull_request`. `comment_issue` and `close_issue` no longer trigger doc updates, making `create_pull_request` the single source of changelog entries and eliminating noisy/duplicate entries ([#47](https://github.com/2b9sa2owa/okffs/issues/47)).
### Fixed
- fix: docs reference main for auto-close but workflow merges to develop ([#51](https://github.com/2b9sa2owa/okffs/issues/51)) — Corrects the auto-close documentation and adds a runtime guard. GitHub's `Closes #N` only auto-closes an issue when the PR merges into the repository's default branch; with…
- bug: OKFFS_AUTO_PR=true leaves CHANGELOG with no auto-update trigger ([#49](https://github.com/2b9sa2owa/okffs/issues/49)) — create_pull_request now reuses an existing open PR for the branch (e.g. a draft opened by create_issue under OKFFS_AUTO_PR=true): it updates the title/body and marks the draft ready for review…

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

[Unreleased]: https://github.com/2b9sa2owa/okffs/compare/v0.1.5...HEAD
[0.1.5]: https://github.com/2b9sa2owa/okffs/compare/v0.1.4...v0.1.5
