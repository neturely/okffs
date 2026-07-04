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

Add a `.mcp.json` to your project root:

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

That's it — `npx` fetches okffs on first use, and Claude Code picks up the tools automatically. If you're signed in with the [GitHub CLI](https://cli.github.com/) (`gh auth login`) and working inside the repo you want to manage, **no other setup is needed**. To use a token or a different repo instead, see [Configuration](#configuration).

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
| `create_issue` | Creates an issue and a matching branch. Infers labels, and a board `priority`/`effort` from the task (toggle with `OKFFS_INFER_PRIORITY`/`OKFFS_INFER_EFFORT`). Optional `assignees`, `labels`, `milestone`, `priority`, `effort`. Opens a draft PR immediately when `OKFFS_AUTO_PR=true`. |
| `create_issues_from_list` | Creates many issues + branches from a task list in one shot. Confirms first. Per-task `labels`, `assignees`, `milestone`, `priority`, `effort`. |
| `plan` | Give it a free-text description plus the breakdown Claude generates (titles, descriptions, labels, relationships); it creates every issue + branch, wires up relationships, and opens draft PRs when `OKFFS_AUTO_PR=true`. Confirms first. |
| `list_issues` | Lists open issues with branch, linked PR, board column, `priority:`/`effort:`, and relationships as a tree — ordered by priority so the most important work is on top. |
| `get_issue` | Full details for one issue: title, body, labels, assignees, branch, status. |
| `comment_issue` | Posts a comment — handy for logging what a branch did. |
| `link_issues` | Links two issues (`blocked_by`, `blocking`, `parent`), stored under a `## Relationships` section. |
| `close_issue` | Closes an issue and tips you to `/clear` before the next one. |
| `create_pull_request` | Opens a PR for an issue branch — generates the title/body, pushes the branch, always includes `Closes #N`, and comments back. Can write changelog fragments when `OKFFS_UPDATE_DOCS=true`. |
| `commit_and_update` | Stages, commits (message from your `hint` or the diff), pushes, and posts a progress comment to the issue. |
| `list_pr_review_comments` | Fetches a PR's inline review threads and summaries. |
| `reply_to_review_comment` | Replies to an inline review thread by id. |
| `resolve_review_thread` | Resolves a review thread — only when `OKFFS_RESOLVE_THREADS=true`. |
| `prepare_release` | Bumps the version, rolls the CHANGELOG, commits on a release branch, and opens a PR. Confirms first; does not tag or publish. |
| `update_project_status` | Moves an issue between board columns (`Backlog`, `Ready`, `In Progress`, `Review`). Needs `OKFFS_PROJECT_ENABLED`. |
| `set_issue_fields` | Sets board Priority/Effort on an **existing** issue (adds it to the board first if needed) — handles project-native and org-level Issue Fields. `create_issue` only sets these at creation; use this afterwards. Status stays with `update_project_status`. |
| `delete_issue` | Closes an issue **and** deletes its branch. Destructive — needs `confirmed: true`. |
| `delete_branch` | Deletes a branch **and** closes its issue. Destructive — needs `confirmed: true`. |

Destructive tools (`delete_issue`, `delete_branch`) always warn on the first call and only act when re-called with `confirmed: true`, posting a comment to the issue before doing anything.

## Handling PR reviews

okffs has a built-in loop for review feedback — just ask (*"address the review comments on PR #42"*). Claude reads the threads, fixes the valid ones, commits and pushes, replies per thread, and posts a summary. Claude brings the judgment and the fixes; okffs handles the GitHub plumbing. There's also a slash command, **`/okffs:address_pr_review`** (takes a PR number), that runs the same loop.

By default review threads are left open for you to resolve; set `OKFFS_RESOLVE_THREADS=true` to have okffs resolve them once addressed.

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

All optional; unset unless noted. See [`.env.example`](.env.example) for a copyable template.

| Variable | Default | Purpose |
|----------|---------|---------|
| `OKFFS_DEFAULT_ASSIGNEES` | — | Comma-separated usernames assigned to every new issue. |
| `OKFFS_DEFAULT_LABELS` | — | Comma-separated labels merged with inferred ones. |
| `OKFFS_DEFAULT_PRIORITY` / `OKFFS_DEFAULT_EFFORT` | — | Board Priority/Effort fallback when none is inferred or given. |
| `OKFFS_INFER_PRIORITY` / `OKFFS_INFER_EFFORT` | `true` | Let Claude infer priority/effort from the task. |
| `OKFFS_PROMPT_METADATA` | `true` | Set `false` to hide the assignees/labels tip. |
| `OKFFS_BASE_BRANCH` | repo default | Branch new issue branches are created from. |
| `OKFFS_PROTECTED_BRANCH` | — | A branch okffs must never promote into without explicit user confirmation (e.g. `main`). `create_pull_request` refuses to target it without `confirmed: true`; `prepare_release` flags merging/tagging into it as a manual, user-gated step. |
| `OKFFS_IDENTIFIER` | — | Prefix for branch names: `{number}-{identifier}-{slug}`. |
| `OKFFS_AUTO_PR` | `false` | Open a draft PR when a new issue branch is created. |
| `OKFFS_RESOLVE_THREADS` | `false` | Auto-resolve PR review threads after they're addressed. |
| `OKFFS_UPDATE_GUIDANCE` | `false` | Nudge Claude to keep `CLAUDE.md` in sync at PR time. |
| `OKFFS_UPDATE_DOCS` | `false` | Auto-write CHANGELOG/SECURITY updates on `create_pull_request`. |
| `OKFFS_EXCLUDE_DOCS` | — | Comma-separated docs to skip (`CHANGELOG.md`, `SECURITY.md`). |
| `OKFFS_PROJECT_ENABLED` | `false` | Enable the GitHub Projects v2 integration. |
| `OKFFS_PROJECT_ID` | — | The board's GraphQL node ID (required when enabled). |
| `OKFFS_PROJECT_AUTO_ADD` | `false` | Add new issues to the board (fallback when the board has no native auto-add). |
| `OKFFS_PROJECT_INITIAL_STATUS` | — | Column a freshly added issue lands in (e.g. `Backlog`). |
| `OKFFS_CLASSIC_PAT` | `false` | Set `true` only with a classic `admin:org` PAT — enables org-level Issue Field Priority/Effort (broad token; security tradeoff). |

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
