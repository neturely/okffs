# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project

**okffs** is a TypeScript/Node.js MCP server that connects Claude Code to GitHub, enabling a full **issue → branch → merge → close** workflow. The goal: discuss tasks in Claude.ai, then push them to GitHub as issues and branches in one shot via Claude Code.

## Stack

- TypeScript / Node.js MCP server
- GitHub Personal Access Token (PAT) authentication (upgrade to a GitHub App later)
- Published to npm (package name: `okffs`) and the MCP Registry (`registry.modelcontextprotocol.io`)

## Conventions

- **Destructive tools require `confirmed: true`** — call once for a warning, re-call to proceed.
- **GitHub is the source of truth** for issue state, never local.
- **Keep the tool surface minimal** — do one thing well per tool.
- **Destructive actions post a comment to the issue before acting.**

### Branch naming

`{issue-number}-{kebab-title-slug}` — title truncated to ~5 words, no forward slashes.

```
42-add-hero-section-to-homepage
```

When `OKFFS_IDENTIFIER` is set, a project-scoped prefix is inserted: `{issue-number}-{identifier}-{kebab-title-slug}`.

```
42-okffs-add-hero-section-to-homepage
```

### Pull requests

- Title: `Close #42 - Add hero section to homepage`
- Body **always** includes `Closes #42` — this triggers GitHub's native auto-close **only when the PR merges into the repository's default branch** (usually `main`). If `OKFFS_BASE_BRANCH` points at a non-default branch (e.g. `develop`), GitHub will **not** auto-close the issue on merge — close it manually with `close_issue`. `create_pull_request` warns when the PR targets a non-default base.

## Build phases

### Phase 1 — Core MCP server ✓ Complete

- TypeScript MCP server scaffolded.
- PAT auth via `.env` (`GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO`).
- `.env` is loaded automatically via `dotenv` from `process.cwd()` — no `--env-file` flag needed in `.mcp.json`.
- Tools: `create_issue`, `list_issues`, `close_issue`, `delete_issue`, `delete_branch`, `get_issue`, `comment_issue`, `link_issues`, `create_issues_from_list`, `plan`, `create_pull_request`, `commit_and_update`, `list_pr_review_comments`, `reply_to_review_comment`, `resolve_review_thread`.
- Prompts (MCP `prompts` capability, surfaced as slash commands): `address_pr_review` — read a PR's review comments, fix the valid ones, reply per thread, post a summary, and optionally resolve threads.
- `create_issue` auto-creates a branch, embeds the branch name in the issue body, applies default assignees/labels from `.env`, infers labels from title/description and merges with `OKFFS_DEFAULT_LABELS`. Supports optional `assignees`, `labels`, `milestone`. If a relationship is mentioned (blocked by, blocking, parent), automatically calls `link_issues` after creation. If `OKFFS_AUTO_PR=true`, pushes an empty init commit to the branch (capturing and restoring the current branch) and opens a draft PR immediately.
- `create_issues_from_list` accepts a list of tasks and creates all issues + branches in one shot. Two-step confirmation. Per-task `labels`, `assignees`, and `milestone` supported.
- `plan` takes a free-text `description` plus the issue breakdown Claude generates from it (titles, descriptions, labels, inter-task relationships referenced by 1-based index) and creates all issues + branches in one shot. Two-step confirmation (preview, then `confirmed: true`). Resolves task-index relationships to real issue numbers and writes them to each issue's `## Relationships` section. If `OKFFS_AUTO_PR=true`, pushes an empty init commit per branch and opens a draft PR for each. Extends the `create_issues_from_list` pattern — Claude is the AI layer that produces the breakdown.
- `list_issues` returns each open issue with its issue URL, branch name + URL, any matched open/draft PR (by head branch), and its relationships (parent, children, blocked-by, blocking) rendered as a tree. Children are derived by inverting `Parent:` links across issues. Replaces the need for a separate PR-listing tool.
- `get_issue` fetches full issue details — title, body, status, branch, assignees, labels.
- `comment_issue` posts a comment to an issue. Use after committing to log what was done.
- `link_issues` links two issues with a relationship — `blocked_by`, `blocking`, or `parent`. Stored in the issue body under a `## Relationships` section.
- `close_issue` closes the issue and returns a tip suggesting the user runs `/clear` in Claude Code to reset context before the next issue. (Under `OKFFS_AUTO_PR=true` the draft PR already exists from `create_issue`, so no PR is created here.)
- `commit_and_update` stages all changes, builds a commit message from the optional `hint` (or the changed file list), commits, pushes to the issue branch, and posts a rich progress comment to the linked issue.
- `list_pr_review_comments` fetches a PR's review feedback via GraphQL — inline threads (comment ids, file/line, author, body, resolved state, thread ids) and review summaries. The agent reads these, fixes, then replies/resolves.
- `reply_to_review_comment` replies to an inline review comment thread by id (REST `in_reply_to`).
- `resolve_review_thread` resolves a review thread (GraphQL). Gated by `OKFFS_RESOLVE_THREADS`: declines unless that env var is `true`, leaving threads for the user to resolve manually.
- `address_pr_review` (MCP prompt / slash command) orchestrates the loop: `list_pr_review_comments` → triage + fix → `commit_and_update` → `reply_to_review_comment` per thread → `comment_issue` summary → `resolve_review_thread` (respects `OKFFS_RESOLVE_THREADS`). The host LLM provides triage/fixes; okffs provides the plumbing.
- `delete_issue` closes an issue and deletes its branch. Two-step: call once for a warning, re-call with `confirmed: true` to proceed. Posts a comment before acting.
- `delete_branch` deletes a branch and closes its issue (issue number parsed from branch name prefix). Same two-step confirmation pattern. Posts a comment before acting.
- Optional `.env` defaults: `OKFFS_DEFAULT_ASSIGNEES`, `OKFFS_DEFAULT_LABELS`, `OKFFS_PROMPT_METADATA`, `OKFFS_BASE_BRANCH`, `OKFFS_IDENTIFIER`, `OKFFS_UPDATE_DOCS`, `OKFFS_AUTO_PR`.
- `OKFFS_BASE_BRANCH` — branch to create new issue branches from. Defaults to the repo's default branch.
- `OKFFS_IDENTIFIER` — optional project-scoped prefix inserted into branch names: `{issue-number}-{identifier}-{slug}`. Unset by default.
- `OKFFS_UPDATE_DOCS` — set to `true` to auto-update local project docs (CHANGELOG.md, CLAUDE.md, SECURITY.md, CONTRIBUTING.md) when a pull request is created (`create_pull_request`). Default `false`. README.md is intentionally excluded. `comment_issue` and `close_issue` do not trigger doc updates — `create_pull_request` is the single source of auto-changelog entries (avoids duplicate/noisy entries).
- `OKFFS_AUTO_PR` — set to `true` to open a draft PR when a new issue branch is created (via `create_issue`). Default `false`.
- `OKFFS_RESOLVE_THREADS` — set to `true` to let okffs auto-resolve PR review threads after they're addressed (via `resolve_review_thread`). Default `false` — threads are left open for the user to resolve.

### Phase 2 — Bulk creation ✓ Complete

- `create_issues_from_list` tool (included in Phase 1 tool surface).
- Accepts a list of tasks; creates all issues + branches in one shot.
- Two-step confirmation: call once to preview, re-call with `confirmed: true` to proceed.
- Per-task `labels`, `assignees`, and `milestone` supported; labels merged with `OKFFS_DEFAULT_LABELS`.
- Auto-generates branch names from issue number + title slug.

### Phase 3 — Claude.ai bridge (not required — skipped)

- Natural language task creation already works well enough via Claude Code.
- No slash command or paste format needed.

### Phase 4 — Auto-close on merge ✓ Complete

- `create_pull_request` tool — reads the issue, commits on the branch, and issue comments to generate a PR title and body. Always includes `Closes #N`. Posts a summary comment back to the issue.
- If `OKFFS_UPDATE_DOCS=true`, updates CHANGELOG before the PR is created and commits it onto the branch (`git add CHANGELOG.md` + commit) so the change is included in the PR diff. A commit failure is logged with an `[okffs]` prefix and never blocks PR creation.
- Before creating the PR, the branch is pushed to remote (`git push origin <branch>`). If the push fails, a comment is posted to the issue and the PR is not created.
- `OKFFS_AUTO_PR` no longer triggers a PR on close — the draft PR is opened at branch-creation time by `create_issue`. To accept the draft PR immediately, `create_issue` first pushes an empty init commit so the branch diverges from base.
- `commit_and_update` tool — stages all changes, generates a conventional commit message, commits, pushes to the current branch, and posts a rich progress comment to the linked issue.
- GitHub natively closes the issue on merge via `Closes #N` — no webhook infrastructure needed. Note: this only fires when merging into the repo's default branch. With a `develop`-based workflow (`OKFFS_BASE_BRANCH=develop`), merge to `develop` does not auto-close; use `close_issue`.
- Edge case: if the branch has no commits ahead of the base branch, a friendly comment is posted instead of erroring.

### Phase 5 — GitHub Projects v2 (optional, later)

- Add issues to a GitHub Project board on creation.
- Update status fields as work progresses.
- Requires the GraphQL API.

### Phase 6 — Project site

- Set up `okffs.g2mk.dev` subdomain on Cloudflare (point to Knowhost).
- Build static site pulling live data from npm Registry API and GitHub API.
- Display: README content, install command, version, download stats, GitHub stars, license.
- Design as a reusable template for future projects under `g2mk.dev`.

## Publishing targets

- **npm** — package name: `okffs`
- **MCP Registry** (`registry.modelcontextprotocol.io`) — via the `mcp-publisher` CLI
- Listings: `mcp.so`, `smithery.ai`, `glama.ai/mcp`, `punkpeye/awesome-mcp-servers`

## Local setup

- `.env` holds the GitHub PAT (`GITHUB_TOKEN`) with fine-grained permissions. It is git-ignored — see [.env.example](.env.example).
- `.env` is loaded automatically at startup via `dotenv` from `process.cwd()`. No `--env-file` flag required in `.mcp.json`.
- Auth resolution: `GITHUB_TOKEN` if set, otherwise falls back to the GitHub CLI (`gh auth token`). If neither is available, startup fails with a message linking to the one-click PAT page.
- Repo resolution: `GITHUB_OWNER`/`GITHUB_REPO` if set, otherwise auto-detected by parsing the `origin` git remote of `process.cwd()`. So with `gh` signed in and okffs run inside the target repo, no `.env` is required.
- Resolution lives in `src/github.ts` (`resolveToken`, `resolveOwnerRepo`); `owner`/`repo` are exported from there and reused (e.g. `docs.ts`) so detected values flow everywhere.
- Optional: `OKFFS_DEFAULT_ASSIGNEES` (comma-separated), `OKFFS_DEFAULT_LABELS` (comma-separated), `OKFFS_PROMPT_METADATA` (set to `false` to silence the tip), `OKFFS_BASE_BRANCH` (branch to create from; defaults to repo default), `OKFFS_IDENTIFIER` (optional project-scoped branch prefix: `{number}-{identifier}-{slug}`), `OKFFS_UPDATE_DOCS` (set to `true` to enable auto doc updates), `OKFFS_AUTO_PR` (set to `true` to auto-create PR on issue close), `OKFFS_RESOLVE_THREADS` (set to `true` to auto-resolve PR review threads after addressing; default leaves them for the user), `OKFFS_EXCLUDE_DOCS` (comma-separated filenames to exclude from auto-updates — valid options: `CLAUDE.md`, `SECURITY.md`, `CONTRIBUTING.md`, `CHANGELOG.md`).

## Local dev vs published package

- **okffs dev repo** — `.mcp.json` points at local build: `{ "command": "node", "args": ["dist/index.js"] }`
- **Consumer repos** — `.mcp.json` uses published package: `{ "command": "npx", "args": ["okffs@latest"] }`
- New tools won't appear in consumer repos until a new version is published to npm.
- After any build change in the okffs repo, restart Claude Code or run `/mcp` to pick up the updated `dist/index.js`.

## Codebase search

This project uses [semble](https://github.com/MinishLab/semble) for semantic code search. The MCP server is registered at the user level (`~/.claude.json`) and a dedicated sub-agent is configured at `.claude/agents/semble-search.md`.

**Claude Code should use the `semble-search` sub-agent for any exploratory or semantic codebase questions** — finding implementations, understanding how something works, locating related code — instead of grep/glob/read directly.

To search manually:

```bash
uvx --from "semble[mcp]" semble search "your query" .
```

## Recent Changes
- 2026-06-28 ([#58](https://github.com/2b9sa2owa/okffs/issues/58)): Added an out-of-the-box PR review-response workflow — `list_pr_review_comments`, `reply_to_review_comment`, and `resolve_review_thread` tools plus an `address_pr_review` MCP prompt, gated by `OKFFS_RESOLVE_THREADS`.
- 2026-06-28 ([#56](https://github.com/2b9sa2owa/okffs/issues/56)): Reduced auth/setup friction — token resolves from `GITHUB_TOKEN` or falls back to `gh auth token`; owner/repo auto-detect from the `origin` git remote when env vars are unset.