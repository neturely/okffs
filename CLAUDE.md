# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project

**okffs** is a TypeScript/Node.js MCP server that connects Claude Code (VS Code) to GitHub, enabling a full **issue → branch → merge → close** workflow. The goal: discuss tasks in Claude.ai, then push them to GitHub as issues and branches in one shot via Claude Code.

## Stack

- TypeScript / Node.js MCP server
- GitHub Personal Access Token (PAT) authentication (upgrade to a GitHub App later)
- Published to npm (package name: `okffs`) and the MCP Registry (`registry.modelcontextprotocol.io`)

## Conventions

- **All tools confirm before bulk-creating** — safety first.
- **GitHub is the source of truth** for issue state, never local.
- **Keep the tool surface minimal** — do one thing well per tool.

### Branch naming

`close-{issue-number}-{kebab-title-slug}` — title truncated to ~5 words, no forward slashes.

```
close-42-add-hero-section-to-homepage
```

### Pull requests

- Title: `Close #42 - Add hero section to homepage`
- Body **always** includes `Closes #42` — this triggers GitHub's native auto-close when the PR merges to `main`.

## Build phases

### Phase 1 — Core MCP server
- Scaffold the TypeScript MCP server.
- PAT auth via `.env`.
- Tools: `create_issue`, `create_branch`, `list_issues`, `close_issue`.
- Single issue + branch creation, end to end.

### Phase 2 — Bulk creation
- `create_issues_from_list` tool.
- Accepts a markdown task list; creates all issues + branches in one shot.
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
