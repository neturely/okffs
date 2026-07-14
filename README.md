# okffs

[![npm version](https://img.shields.io/npm/v/@neturely/okffs.svg)](https://www.npmjs.com/package/@neturely/okffs)
[![license: MIT](https://img.shields.io/npm/l/@neturely/okffs.svg)](https://github.com/neturely/okffs/blob/main/LICENSE)
[![MCP](https://img.shields.io/badge/MCP-server-blue.svg)](https://modelcontextprotocol.io)

**Turn a conversation with Claude into GitHub issues, branches, and pull requests — without leaving Claude Code.**

okffs is a [Model Context Protocol](https://modelcontextprotocol.io) server that gives Claude Code a clean **issue → branch → PR → close** workflow on GitHub. Talk through the work in plain language; okffs creates the issues, matching branches, and pull requests, keeps them linked, and (optionally) syncs a GitHub Projects board — all in one shot.

- **One-shot planning** — describe a chunk of work and get every issue + branch created, with relationships wired up.
- **The whole loop** — create, comment, commit, open PRs, handle review feedback, and close, each as a simple ask.
- **Sensible defaults** — Claude infers labels, priority, and effort from the task; GitHub stays the single source of truth.
- **Little to no config** — signed in with the `gh` CLI inside your repo? You're ready.

## Quick start

**1. Run the setup wizard** from your project root:

```bash
npx @neturely/okffs setup
```

It walks you through auth, repo, and any optional features, writes a `.env`, then runs a quick GitHub sanity check. Re-run it any time (e.g. after upgrading okffs) — it only asks about options that are new since your last run. If you're happy relying on the [GitHub CLI](https://cli.github.com/) (`gh auth login`) and working inside the repo you want to manage, you can skip this step entirely — okffs works with **no config at all**.

> **Already in Claude Code?** Once okffs is connected you can configure it conversationally instead — run the **`/okffs:setup`** slash command and Claude will interview you and write the `.env` for you (no terminal needed). okffs also nudges you to run it after an upgrade introduces new options.

**2. Add a `.mcp.json`** to your project root:

```json
{
  "mcpServers": {
    "okffs": {
      "command": "npx",
      "args": ["@neturely/okffs@latest"]
    }
  }
}
```

That's it — `npx` fetches okffs on first use, and Claude Code picks up the tools automatically. To use a token or a different repo instead of the `gh`/auto-detect defaults, run `okffs setup` (above) or edit `.env` by hand — see [Configuration](#configuration).

Now just ask Claude:

- *"Create an issue called 'Fix login button' and start a branch for it."*
- *"Plan the work for adding user authentication and create the issues."*
- *"Create issues from this task list: …"*
- *"List all open issues."*
- *"Mark issue #5 as blocked by issue #3."*
- *"Done with issue #42 — open a PR and close it."*
- *"Address the review comments on PR #42."*

Claude infers labels (`bug`, `enhancement`, …) from the title and description and merges them with any you've set as defaults.

## Tools

| Tool | What it does |
|------|-------------|
| `create_issue` | Creates an issue and a matching branch. Infers labels, a board `priority`/`effort`, and a native Issue Type from the task (toggle with `OKFFS_INFER_PRIORITY`/`OKFFS_INFER_EFFORT`/`OKFFS_INFER_TYPE`). Optional `assignees`, `labels`, `milestone`, `priority`, `effort`, `type`. Opens a draft PR immediately when `OKFFS_AUTO_PR=true`. |
| `create_issues_from_list` | Creates many issues + branches from a task list in one shot. Confirms first. Per-task `labels`, `assignees`, `milestone`, `priority`, `effort`, `type`. |
| `plan` | Give it a free-text description plus the breakdown Claude generates (titles, descriptions, labels, priority/effort/type, relationships); it creates every issue + branch, wires up relationships, and opens draft PRs when `OKFFS_AUTO_PR=true`. Confirms first. |
| `list_issues` | Lists open issues with branch, linked PR, board column, `priority:`/`effort:`, native `type:`, and relationships as a tree — ordered by priority so the most important work is on top. |
| `get_issue` | Full details for one issue: title, body, labels, assignees, branch, status. |
| `comment_issue` | Posts a comment — handy for logging what a branch did. |
| `link_issues` | Links two issues (`blocked_by`, `blocking`, `parent`), stored under a `## Relationships` section. |
| `close_issue` | Closes an issue and tips you to `/clear` before the next one. |
| `create_pull_request` | Opens a PR for an issue branch — generates the title/body, pushes the branch, always includes `Closes #N`, and comments back. Can write changelog fragments when `OKFFS_UPDATE_DOCS=true`. Pass `allow_empty: true` to backfill a **draft** tracking PR on a branch with no commits (pushes an empty init commit to diverge it). |
| `commit_and_update` | Stages, commits (message from your `hint` or the diff), pushes, and posts a progress comment to the issue. |
| `merge_pull_request` | The one okffs tool that **merges**: autonomously merges a green, review-resolved issue PR into the **base** branch (e.g. `develop`) using `OKFFS_BASE_MERGE_METHOD`, then closes the issue. Opt-in (`OKFFS_AUTO_MERGE_BASE=true`) and heavily gated — never touches `OKFFS_PROTECTED_BRANCH`, independently verifies checks/mergeability/threads. The `develop → main` promotion stays your manual merge. |
| `list_pr_review_comments` | Fetches a PR's inline review threads and summaries. |
| `reply_to_review_comment` | Replies to an inline review thread by id. |
| `resolve_review_thread` | Resolves a review thread — only when `OKFFS_RESOLVE_THREADS=true`. |
| `prepare_release` | Bumps the version, rolls the CHANGELOG, commits on a release branch, and opens a PR. Confirms first; does not tag or publish. |
| `update_project_status` | Moves an issue between board columns (`Backlog`, `Ready`, `In Progress`, `Review`). Needs `OKFFS_PROJECT_ENABLED`. |
| `set_issue_fields` | Sets board Priority/Effort **and/or the native Issue Type** on an **existing** issue. Priority/Effort handle project-native and org-level Issue Fields (needs `OKFFS_PROJECT_ENABLED`); `type` is org-native and works independently. `create_issue` only sets these at creation; use this afterwards. Status stays with `update_project_status`. |
| `update_issue` | Edits an **existing** issue's core fields — `title`, `assignees`, `labels`, `milestone`, `body` — via one PATCH with the configured token. `labels`/`assignees` replace the whole set (`[]` clears). For Priority/Effort/Type use `set_issue_fields`; for Status use `update_project_status`. |
| `configure` | Writes okffs config to `.env` — the backend for the `/okffs:setup` prompt. Reuses the `okffs setup` wizard's manifest/serializer: updates only okffs's marked block, preserving your own variables and comments. Usually driven by `/okffs:setup`, not called directly. |
| `delete_issue` | Closes an issue **and** deletes its branch. Destructive — needs `confirmed: true`. |
| `delete_branch` | Deletes a branch **and** closes its issue. Destructive — needs `confirmed: true`. |

Destructive tools (`delete_issue`, `delete_branch`) always warn on the first call and only act when re-called with `confirmed: true`, posting a comment to the issue before doing anything.

## Handling PR reviews

okffs has a built-in loop for review feedback — just ask (*"address the review comments on PR #42"*). Claude reads the threads, fixes the valid ones, commits and pushes, replies per thread, and posts a summary. Claude brings the judgment and the fixes; okffs handles the GitHub plumbing. There's also a slash command, **`/okffs:address_pr_review`** (takes a PR number), that runs the same loop.

By default review threads are left open for you to resolve; set `OKFFS_RESOLVE_THREADS=true` to have okffs resolve them once addressed.

## Autopilot (minimum interference)

For a hands-off session, ask Claude to *"fully handle this"* (or *"minimum interference"*) — or set `OKFFS_AUTOPILOT=true` to make it the default. In autopilot, Claude stops asking you to choose between options for **reversible** decisions, takes the recommended option at each fork, and drives an issue all the way to a PR into the base branch (and a base merge when `OKFFS_AUTO_MERGE_BASE=true`) — then posts an **"Autopilot decisions"** report (one line per choice, with a one-line why) to the PR and the issue, so you can redirect anything in a single message.

It removes confirmation friction; it does **not** grant new powers. The hard stops always interrupt, even in autopilot: anything into `OKFFS_PROTECTED_BRANCH` (merge/tag/publish), destructive tools (`delete_issue` / `delete_branch`), anything billable (e.g. a Copilot review on a new promotion PR), and genuinely irreversible actions. And for a real *missing-information* call — where only you hold the context — Claude still asks one quick question rather than guess. Off by default.

## Keeping CLAUDE.md in sync

The **`/okffs:update_guidance`** slash command reviews the changes on the current branch and maintains one okffs-owned section of your `CLAUDE.md` — `## Project Guidance (okffs usage)`, delimited by HTML markers — without ever touching your hand-written content. It's guidance curation (tools, env vars, conventions), not a changelog. Set `OKFFS_UPDATE_GUIDANCE=true` to have `create_pull_request` nudge Claude to run it at PR time; the command is always available.

## Automatic doc updates

With `OKFFS_UPDATE_DOCS=true`, `create_pull_request` writes doc updates onto the branch so they land in the PR diff:

- **CHANGELOG.md** — a per-issue [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) **fragment** under `.changes/unreleased/`, assembled into `CHANGELOG.md` at release time by `prepare_release`. Uniquely-named fragments avoid merge conflicts across parallel branches.
- **SECURITY.md** — updated when security-related keywords are detected (only if the file exists).

`CLAUDE.md`, `CONTRIBUTING.md`, and `README.md` are intentionally left for you to maintain. Exclude specific files per repo with `OKFFS_EXCLUDE_DOCS` (valid: `CHANGELOG.md`, `SECURITY.md`).

## GitHub Projects v2

okffs can keep a **Projects v2** board in step with your workflow. It's opt-in with zero overhead when off:

```env
OKFFS_PROJECT_ENABLED=true
OKFFS_PROJECT_ID=PVT_kwHO...     # the board's GraphQL node ID
```

Once enabled, `list_issues` shows each issue's column, priority, and effort (ordered by priority); `update_project_status` moves issues between `Backlog`, `Ready`, `In Progress`, and `Review`; and `create_issue` can set priority/effort and an initial column. **`Done` is deliberately left to GitHub's native automation** (PR merge / issue close → Done) so two systems never fight over the terminal state.

**Priority & Effort** work as either a project-native single-select field (any Projects-capable token) or a GitHub org-level Issue Field. Org-level Issue Fields live outside the project and need a **classic PAT with `admin:org`** plus `OKFFS_CLASSIC_PAT=true` — fine-grained PATs can't reach them yet, so okffs skips that path and asks you to set the value in the UI. Claude infers priority/effort per task by default, falling back to the `OKFFS_DEFAULT_*` values.

**Auto-add** (`OKFFS_PROJECT_AUTO_ADD`) is a fallback for boards without GitHub's native "Auto-add to project" workflow — leave it `false` if your board already auto-adds.

**Token permission:** Projects v2 is GraphQL-only and needs a Projects-capable token — a fine-grained PAT with *Organization → Projects: Read and write*, or a classic PAT with the `project` scope. A single classic token with `repo` + `project` + `admin:org` covers everything, including org-level Issue Fields. Missing permission surfaces a clear `[okffs]` error naming what's needed.

## Configuration

The quickest way to configure okffs is the wizard — `npx @neturely/okffs setup` — which writes and maintains the `.env` described below for you. The rest of this section documents what it (or you, by hand) can set.

okffs resolves a **token** and a **target repository** with fallbacks, so most users need little config.

**Token** (first match wins):
1. `GITHUB_TOKEN` in a `.env` file — either a [fine-grained PAT](https://github.com/settings/personal-access-tokens/new) (recommended; least privilege) with **Issues**, **Contents**, **Pull requests** (read/write), **Metadata** (read), and **Administration** (read/write) on the repo, or a [classic PAT](https://github.com/settings/tokens/new?scopes=repo&description=okffs) with the `repo` scope (broader — grants access across all your repos).
2. Otherwise the **GitHub CLI** token — if you've run `gh auth login`, it just works.

**Repository** (first match wins):
1. `GITHUB_OWNER` / `GITHUB_REPO` in `.env`.
2. Otherwise **auto-detected** from the `origin` git remote of the directory okffs runs in.

okffs loads `.env` automatically from that directory — no `--env-file` flag needed. A minimal explicit `.env`:

```env
GITHUB_TOKEN=ghp_your_token_here
# Optional — auto-detected from the git origin remote when omitted:
GITHUB_OWNER=your-github-username
GITHUB_REPO=your-repo-name
```

### Optional settings

All optional; unset unless noted. Grouped by concern — the same groups appear in [`.env.example`](.env.example), a copyable template. (`GITHUB_TOKEN` / `GITHUB_OWNER` / `GITHUB_REPO` are covered under [Setup](#setup) above.)

**Branching & pull requests**

| Variable | Default | Purpose |
|----------|---------|---------|
| `OKFFS_BASE_BRANCH` | repo default | Branch new issue branches are created from. |
| `OKFFS_PROTECTED_BRANCH` | — | A branch okffs must never autonomously **merge**, tag, or publish into (e.g. `main`). Governs *merging*, not PR *creation*: okffs will freely **open** a PR targeting it (opening is safe — the merge is already gated by branch protection + your manual merge) and just adds a reminder that the merge/tag stay with you. `prepare_release` flags merging/tagging into it as a manual, user-gated step. |
| `OKFFS_IDENTIFIER` | — | Prefix for branch names: `{number}-{identifier}-{slug}`. |
| `OKFFS_AUTO_PR` | `false` | Open a draft PR when a new issue branch is created. |
| `OKFFS_BASE_MERGE_METHOD` / `OKFFS_PROTECTED_MERGE_METHOD` | `squash` / `merge` | PR merge method per branch tier (`squash`/`merge`/`rebase`). Records the convention; grants no merge permission. |
| `OKFFS_AUTO_MERGE_BASE` | `false` | Let `merge_pull_request` autonomously merge a green, threads-resolved issue PR into the base branch. Never merges `OKFFS_PROTECTED_BRANCH`. |

**Issue defaults & inference**

| Variable | Default | Purpose |
|----------|---------|---------|
| `OKFFS_DEFAULT_ASSIGNEES` | — | Comma-separated usernames assigned to every new issue. |
| `OKFFS_DEFAULT_LABELS` | — | Comma-separated labels merged with inferred ones. |
| `OKFFS_DEFAULT_PRIORITY` / `OKFFS_DEFAULT_EFFORT` | — | Board Priority/Effort fallback when none is inferred or given. |
| `OKFFS_INFER_PRIORITY` / `OKFFS_INFER_EFFORT` | `true` | Let Claude infer priority/effort from the task. |
| `OKFFS_INFER_TYPE` | `true` | Let Claude infer the native GitHub Issue Type (Task/Bug/Feature/…) from the task. Org-level; skipped cleanly on user repos. |
| `OKFFS_DEFAULT_TYPE` | — | Native Issue Type fallback when none is inferred or given (e.g. `Task`). |
| `OKFFS_PROMPT_METADATA` | `true` | Set `false` to hide the assignees/labels tip. |

**PR review**

| Variable | Default | Purpose |
|----------|---------|---------|
| `OKFFS_RESOLVE_THREADS` | `false` | Auto-resolve PR review threads after they're addressed. |

**Docs & changelog**

| Variable | Default | Purpose |
|----------|---------|---------|
| `OKFFS_UPDATE_DOCS` | `false` | Auto-write CHANGELOG/SECURITY updates on `create_pull_request`. |
| `OKFFS_EXCLUDE_DOCS` | — | Comma-separated docs to skip (`CHANGELOG.md`, `SECURITY.md`). |
| `OKFFS_UPDATE_GUIDANCE` | `false` | Nudge Claude to keep `CLAUDE.md` in sync at PR time. |

**GitHub Projects v2 (board)**

| Variable | Default | Purpose |
|----------|---------|---------|
| `OKFFS_PROJECT_ENABLED` | `false` | Enable the GitHub Projects v2 integration. |
| `OKFFS_PROJECT_ID` | — | The board's GraphQL node ID (required when enabled). |
| `OKFFS_PROJECT_AUTO_ADD` | `false` | Add new issues to the board (fallback when the board has no native auto-add). |
| `OKFFS_PROJECT_INITIAL_STATUS` | — | Column a freshly added issue lands in (e.g. `Backlog`). |
| `OKFFS_CLASSIC_PAT` | `false` | Set `true` only with a classic `admin:org` PAT — enables org-level Issue Field Priority/Effort (broad token; security tradeoff). |

**Branch promotion & releases** (`promote_branch`)

| Variable | Default | Purpose |
|----------|---------|---------|
| `OKFFS_PROMOTION_STATUS` | — | Board Status column the promotion PR card lands in (e.g. `Review`). Needs `OKFFS_PROJECT_ENABLED`. |
| `OKFFS_PROMOTION_REVIEWERS` | — | Comma-separated reviewers to request on the gate PR (e.g. `copilot-pull-request-reviewer[bot]`). Only acted on when `OKFFS_PROMOTION_AUTO_REVIEW=true`. |
| `OKFFS_PROMOTION_AUTO_REVIEW` | `false` | Opt in to auto-request those reviewers, **on gate-PR creation only** (never on re-runs). **⚠️ Cost:** Copilot code review is billable, so this charges per newly-created promotion PR. |

**Autopilot (minimum interference)**

| Variable | Default | Purpose |
|----------|---------|---------|
| `OKFFS_AUTOPILOT` | `false` | Default the session to [autopilot](#autopilot-minimum-interference): take the recommended option at each reversible fork, drive to a base-branch PR, and report the decisions. Hard stops (protected branch, destructive, billable, irreversible) still interrupt. Per-request activation (*"fully handle this"*) works regardless. |

## Conventions

- **Branches:** `{issue-number}-{kebab-title-slug}` (title truncated to ~5 words), e.g. `42-add-hero-section-to-homepage`.
- **PRs:** titled `Close #42 - Add hero section to homepage`; the body always includes `Closes #42`. GitHub auto-closes the issue when the PR merges into the repo's **default branch**. If `OKFFS_BASE_BRANCH` points at a non-default branch (e.g. `develop`), close the issue manually with `close_issue` — `create_pull_request` flags this.
- Destructive tools require `confirmed: true`; bulk-creating tools confirm first.
- GitHub is always the source of truth for issue state — never local.
- **Prefer okffs tools over raw `git`/`gh`.** When an okffs tool covers the action — issues, PRs, comments, review threads (`resolve_review_thread` / `address_pr_review`), releases, project status — use it and honour its env toggles (`OKFFS_RESOLVE_THREADS`, `OKFFS_BASE_BRANCH`, `OKFFS_PROTECTED_BRANCH`, …) rather than re-deriving the behaviour. Fall back to raw `git`/`gh` only when no okffs tool fits.

## Contributing

Bug reports, feature ideas, and PRs are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, how to add a tool, commit/branch conventions, and publishing. Release notes live in [CHANGELOG.md](CHANGELOG.md) and on the [Releases](https://github.com/neturely/okffs/releases) page.

## License

[MIT](LICENSE)
