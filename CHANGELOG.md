# Changelog

All notable changes to this project will be documented in this file.
See [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

## [0.1.5] - 2026-06-26
### Added
- feat: add okffs_plan tool — plan and create issues from context in one shot ([#42](https://github.com/2b9sa2owa/okffs/issues/42)) — Adds a new `plan` tool. It takes a free-text `description` of the work plus the structured issue breakdown Claude generates from it (titles, descriptions, labels, and inter-task relationships referenced by 1-based index), previews the plan, and on `confirmed: true` creates all issues + branches i...
- New `commit_and_update` tool — stages all changes, builds a commit message from a hint (or the changed file list), commits, pushes to the issue branch, and posts a rich progress comment to the linked issue.
- `prepublishOnly` hook so `dist/` is always freshly built before publishing.
- `.github/instructions/okffs.instructions.md` Copilot instructions file.

### Changed
- Redesigned `OKFFS_AUTO_PR`: a draft PR is now opened at branch-creation time by `create_issue` (instead of on issue close), pushing an empty init commit first so GitHub accepts the draft immediately.
- `close_issue` now returns a `/clear` tip and no longer triggers a PR on close.
- `CHANGELOG.md` is now shipped in the npm package.

### Fixed
- feat: add OKFFS_IDENTIFIER env var for project-scoped branch prefix ([#41](https://github.com/2b9sa2owa/okffs/issues/41)) — Add optional OKFFS_IDENTIFIER env var that inserts a project-scoped prefix into branch names ({number}-{identifier}-{slug}). Added config flag, a centralized buildBranchName() helper in github.ts, updated create_issue / create_issues_from_list / list_issues to use it, and documented the var in .e...
- `create_pull_request` commits the updated CHANGELOG onto the branch and pushes the branch before opening the PR, with non-blocking error handling ([#38](https://github.com/2b9sa2owa/okffs/issues/38)).
- All git operations now run via `execFileSync` with argument arrays (no shell), removing command-injection risk from branch names and commit hints; tools also checkout the target branch before committing/pushing and restore the original branch afterward.

[Unreleased]: https://github.com/2b9sa2owa/okffs/compare/v0.1.5...HEAD
[0.1.5]: https://github.com/2b9sa2owa/okffs/compare/v0.1.4...v0.1.5
