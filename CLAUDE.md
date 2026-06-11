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
- **Destructive actions post a comment to the issue before acting.**

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
- Tools: `create_issue`, `list_issues`, `close_issue`, `delete_issue`, `delete_branch`, `get_issue`, `comment_issue`, `link_issues`, `create_issues_from_list`.
- `create_issue` auto-creates a branch, embeds the branch name in the issue body, applies default assignees/labels from `.env`, infers labels from title/description and merges with `OKFFS_DEFAULT_LABELS`. Supports optional `assignees`, `labels`, `milestone`. If a relationship is mentioned (blocked by, blocking, parent), automatically calls `link_issues` after creation.
- `create_issues_from_list` accepts a list of tasks and creates all issues + branches in one shot. Two-step confirmation. Per-task `labels`, `assignees`, and `milestone` supported.
- `list_issues` returns each issue with its issue URL and inferred branch URL.
- `get_issue` fetches full issue details — title, body, status, branch, assignees, labels.
- `comment_issue` posts a comment to an issue. Use after committing to log what was done.
- `link_issues` links two issues with a relationship — `blocked_by`, `blocking`, or `parent`. Stored in the issue body under a `## Relationships` section.
- `close_issue` closes the issue. If `OKFFS_AUTO_PR=true`, automatically creates a PR instead of posting a branch-remains-open comment.
- `delete_issue` closes an issue and deletes its branch. Two-step: call once for a warning, re-call with `confirmed: true` to proceed. Posts a comment before acting.
- `delete_branch` deletes a branch and closes its issue (issue number parsed from branch name prefix). Same two-step confirmation pattern. Posts a comment before acting.
- Optional `.env` defaults: `OKFFS_DEFAULT_ASSIGNEES`, `OKFFS_DEFAULT_LABELS`, `OKFFS_PROMPT_METADATA`, `OKFFS_BASE_BRANCH`, `OKFFS_UPDATE_DOCS`, `OKFFS_AUTO_PR`.
- `OKFFS_BASE_BRANCH` — branch to create new issue branches from. Defaults to the repo's default branch.
- `OKFFS_UPDATE_DOCS` — set to `true` to auto-update local project docs on workflow events. Default `false`.
- `OKFFS_AUTO_PR` — set to `true` to automatically create a PR when closing an issue. Default `false`.

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
- If `OKFFS_UPDATE_DOCS=true`, updates CHANGELOG before the PR is created so the change is included in the PR diff.
- If `OKFFS_AUTO_PR=true`, `close_issue` automatically triggers `create_pull_request`.
- GitHub natively closes the issue on merge via `Closes #N` — no webhook infrastructure needed.
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
- Required: `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO`.
- Optional: `OKFFS_DEFAULT_ASSIGNEES` (comma-separated), `OKFFS_DEFAULT_LABELS` (comma-separated), `OKFFS_PROMPT_METADATA` (set to `false` to silence the tip), `OKFFS_BASE_BRANCH` (branch to create from; defaults to repo default), `OKFFS_UPDATE_DOCS` (set to `true` to enable auto doc updates), `OKFFS_AUTO_PR` (set to `true` to auto-create PR on issue close).

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