# okffs

> **Work in progress.**

**okffs** is a TypeScript/Node.js [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that connects Claude Code (VS Code) to GitHub, enabling a full **issue → branch → merge → close** workflow. Discuss tasks in Claude.ai, then push them to GitHub as issues and branches in one shot via Claude Code.

## Stack

- TypeScript / Node.js MCP server
- GitHub Personal Access Token (PAT) authentication (GitHub App support planned)
- Published to [npm](https://www.npmjs.com/) and the [MCP Registry](https://registry.modelcontextprotocol.io)

## Status

This project is being built in phases. See [CLAUDE.md](CLAUDE.md) for the full roadmap.

| Phase | Scope | Status |
|------|-------|--------|
| 1 | Core MCP server — `create_issue`, `create_branch`, `list_issues`, `close_issue` | Planned |
| 2 | Bulk creation — `create_issues_from_list` | Planned |
| 3 | Claude.ai bridge — markdown paste format + `/push-to-github` | Planned |
| 4 | Auto-close on merge — embed `Closes #N` in PR body | Planned |
| 5 | GitHub Projects v2 (optional) | Planned |

## Publishing to npm

Requires an npm account with maintainer access to the `okffs` package.

1. Log in:

   ```bash
   npm login
   ```

2. Bump the version in `package.json` following [semver](https://semver.org/), then publish:

   ```bash
   npm version patch   # or minor / major
   npm publish
   ```

3. Verify:

   ```bash
   npm show okffs
   ```

Files excluded from the published package are listed in [.npmignore](.npmignore).

## Getting started

### Prerequisites

- Node.js (LTS) and npm
- A GitHub Personal Access Token with `repo` and `project` scopes

### Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy the environment template and add your token:

   ```bash
   cp .env.example .env
   ```

   Set `GITHUB_TOKEN` in `.env` (git-ignored, never committed):

   ```bash
   GITHUB_TOKEN=ghp_your_personal_access_token_here
   ```

### Conventions

**Branch naming:** `close-{issue-number}-{kebab-title-slug}` (title truncated to ~5 words, no slashes)

```
close-42-add-hero-section-to-homepage
```

**Pull requests:**

- Title: `Close #42 - Add hero section to homepage`
- Body always includes `Closes #42` so GitHub auto-closes the issue when the PR merges to `main`.

**Operating principles:**

- Tools confirm before bulk-creating (safety first).
- GitHub is always the source of truth for issue state — never local.
- Keep the tool surface minimal: do one thing well per tool.

## Codebase search

This project uses [semble](https://github.com/MinishLab/semble) for semantic code search via MCP. The sub-agent config lives at `.claude/agents/semble-search.md` and is picked up automatically by Claude Code.

To search manually (requires `uv`):

```bash
uvx --from "semble[mcp]" semble search "your query" .
```