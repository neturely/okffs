# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project

**okffs** is a TypeScript/Node.js MCP server that connects Claude Code (VS Code) to GitHub, enabling a full **issue → branch → merge → close** workflow. The goal: discuss tasks in Claude.ai, then push them to GitHub as issues and branches in one shot via Claude Code.

## Stack

- TypeScript / Node.js MCP server
- GitHub Personal Access Token (PAT) authentication (upgrade to a GitHub App later)
- Published to npm (package name: `okffs`) and the MCP Registry (`registry.modelcontextprotocol.io`)

## Conventions

- **Destructive tools require `confirmed: true`** — call once for a warning, re-call to proceed.
- **GitHub is the source of truth** for issue state, never local.
- **Keep the tool surface minimal** — do one thing well per tool.

### Branch naming

`{issue-number}-{kebab-title-slug}` — title truncated to ~5 words, no forward slashes.

```
42-add-hero-section-to-homepage
```

### Pull requests

- Title: `Close #42 - Add hero section to homepage`
- Body **always** includes `Closes #42` — this triggers GitHub's native auto-close when the PR merges to `main`.

## Build phases

### Phase 1 — Core MCP server ✓ Complete
- TypeScript MCP server scaffolded.
- PAT auth via `.env` (`GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO`).
- `.env` is loaded automatically via `dotenv` from `process.cwd()` — no `--env-file` flag needed in `.mcp.json`.
- Tools: `create_issue`, `list_issues`, `close_issue`, `delete_issue`, `delete_branch`, `get_issue`, `comment_issue`.
- `create_issue` auto-creates a branch, embeds the branch name in the issue body, and surfaces default assignees/labels from `.env` (shown as `(default)` in output). Infers labels automatically; merges inferred labels with `OKFFS_DEFAULT_LABELS`. Supports optional `milestone`.
- `list_issues` returns each issue with its issue URL and inferred branch URL.
- `get_issue` fetches full issue details — title, body, status, branch, assignees, labels.
- `comment_issue` posts a comment to an issue. Use after committing to log what was done.
- `close_issue` closes the issue and posts a comment noting the branch remains open (branch name extracted from the embedded `**Branch:**` line).
- `delete_issue` closes an issue and deletes its branch. Two-step: call once for a warning, re-call with `confirmed: true` to proceed. Posts a comment to the issue before acting.
- `delete_branch` deletes a branch and closes its issue (issue number parsed from branch name prefix). Same two-step confirmation pattern.
- Optional `.env` defaults: `OKFFS_DEFAULT_ASSIGNEES`, `OKFFS_DEFAULT_LABELS`, `OKFFS_PROMPT_METADATA`, `OKFFS_BASE_BRANCH`.
- `OKFFS_BASE_BRANCH` — set to override the base branch for new issue branches (skips the GitHub API call). Defaults to the repo's default branch.

### Phase 2 — Bulk creation ✓ Complete
- `create_issues_from_list` tool.
- Accepts a list of tasks; creates all issues + branches in one shot.
- Two-step confirmation: call once to preview, re-call with `confirmed: true` to proceed.
- Per-task `labels`, `assignees`, and `milestone` supported; labels merged with `OKFFS_DEFAULT_LABELS`.
- Auto-generates branch names from issue number + title slug.

### Phase 3 — Claude.ai bridge
- Define a standard markdown paste format to carry task lists from claude.ai into Claude Code.
- Slash command (e.g. `/push-to-github`) that reads the task list and triggers Phase 2.

### Phase 4 — Auto-close on merge
- Embed `Closes #42` in the PR body automatically on branch/PR creation.
- GitHub natively closes the issue on merge — no webhook infrastructure needed.

### Phase 5 — GitHub Projects v2 (optional, later)
- Add issues to a GitHub Project board on creation.
- Update status fields as work progresses.
- Requires the GraphQL API.

## Publishing targets

- **npm** — package name: `okffs`
- **MCP Registry** (`registry.modelcontextprotocol.io`) — via the `mcp-publisher` CLI
- Listings: `mcp.so`, `smithery.ai`, `glama.ai/mcp`, `punkpeye/awesome-mcp-servers`

## Local setup

- `.env` holds the GitHub PAT (`GITHUB_TOKEN`) with `repo` + `project` scopes. It is git-ignored — see [.env.example](.env.example).
- `.env` is loaded automatically at startup via `dotenv` from `process.cwd()`. No `--env-file` flag required in `.mcp.json`.
- Optional defaults applied to every new issue: `OKFFS_DEFAULT_ASSIGNEES` (comma-separated), `OKFFS_DEFAULT_LABELS` (comma-separated), `OKFFS_PROMPT_METADATA` (set to `false` to silence the tip), `OKFFS_BASE_BRANCH` (branch to create from; defaults to repo default branch).

## Codebase search

This project uses [semble](https://github.com/MinishLab/semble) for semantic code search. The MCP server is registered at the user level (`~/.claude.json`) and a dedicated sub-agent is configured at `.claude/agents/semble-search.md`.

**Claude Code should use the `semble-search` sub-agent for any exploratory or semantic codebase questions** — finding implementations, understanding how something works, locating related code — instead of grep/glob/read directly.

To search manually:

```bash
uvx --from "semble[mcp]" semble search "your query" .
```
