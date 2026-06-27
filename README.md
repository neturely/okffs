# okffs

> **Work in progress.**

**okffs** is a TypeScript/Node.js [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that connects Claude Code to GitHub, enabling a full **issue → branch → merge → close** workflow. Discuss tasks in Claude.ai, then push them to GitHub as issues and branches in one shot via Claude Code.

## Stack

- TypeScript / Node.js MCP server
- GitHub Personal Access Token (PAT) authentication (GitHub App support planned)
- Published to [npm](https://www.npmjs.com/) and the [MCP Registry](https://registry.modelcontextprotocol.io)

## Status

This project is being built in phases. See [CLAUDE.md](CLAUDE.md) for the full roadmap.

| Phase | Scope | Status |
|------|-------|--------|
| 1 | Core MCP server — `create_issue`, `list_issues`, `close_issue`, `delete_issue`, `delete_branch`, `get_issue`, `comment_issue`, `link_issues` | **Complete** |
| 2 | Bulk creation — `create_issues_from_list` | **Complete** |
| 3 | Claude.ai bridge | Skipped — not required |
| 4 | Auto-close on merge — `create_pull_request`, `commit_and_update` | **Complete** |
| 5 | GitHub Projects v2 (optional) | Planned |
| 6 | Project site — `okffs.g2mk.dev` | Planned |

## Usage with Claude Code

Add okffs to any project by creating a `.mcp.json` in the project root:

```json
{
  "mcpServers": {
    "okffs": {
      "command": "npx",
      "args": ["okffs@latest"]
    }
  }
}
```

Create a `.env` file in the same directory with your GitHub credentials:

```env
GITHUB_TOKEN=ghp_your_personal_access_token_here
GITHUB_OWNER=your-github-username
GITHUB_REPO=your-repo-name
```

okffs loads `.env` automatically from the directory it starts in — no `--env-file` flag needed.

Once configured, Claude Code will pick up the tools automatically. You can ask Claude things like:

- *"Create an issue called 'Fix login button' with description '...'"*
- *"List all open issues"*
- *"Create issues from this task list: ..."*
- *"Post a comment to issue #12 saying what was done"*
- *"Mark issue #5 as blocked by issue #3"*
- *"Done with issue #42, close it and open a PR"*

Claude infers appropriate labels (`bug`, `enhancement`, etc.) from the issue title and description, and merges them with your `OKFFS_DEFAULT_LABELS`.

## Getting started

### Prerequisites

- Node.js (LTS) and npm
- A GitHub Personal Access Token with fine-grained permissions — [create one here](https://github.com/settings/tokens)
  - Required: Issues (read/write), Contents (read/write), Metadata (read), Pull requests (read/write), Administration (read/write)

### Quick start (recommended)

No installation needed. Add the `.mcp.json` and `.env` to your project as shown in [Usage with Claude Code](#usage-with-claude-code) above — `npx` fetches okffs automatically on first use.

### Local development setup

1. Clone the repo and install dependencies:

   ```bash
   git clone https://github.com/2b9sa2owa/okffs.git
   cd okffs
   npm install
   ```

2. Copy the environment template and fill in your credentials:

   ```bash
   cp .env.example .env
   ```

   Required vars:

   ```env
   GITHUB_TOKEN=ghp_your_personal_access_token_here
   GITHUB_OWNER=your-github-username
   GITHUB_REPO=your-repo-name
   ```

3. Optionally set defaults applied to every new issue:

   ```env
   OKFFS_DEFAULT_ASSIGNEES=your-github-username   # comma-separated
   OKFFS_DEFAULT_LABELS=okffs                     # merged with any inferred labels
   OKFFS_PROMPT_METADATA=true                     # set to false to hide the tip
   OKFFS_BASE_BRANCH=main                         # branch to create issues from; defaults to repo default
   OKFFS_IDENTIFIER=okffs                         # optional prefix: branches become {number}-{identifier}-{slug}
   OKFFS_UPDATE_DOCS=false                        # set to true to auto-update project docs on workflow events
   OKFFS_AUTO_PR=false                            # set to true to open a draft PR when a new issue branch is created
   OKFFS_EXCLUDE_DOCS=CLAUDE.md,CONTRIBUTING.md   # comma-separated — valid options: CLAUDE.md, SECURITY.md, CONTRIBUTING.md, CHANGELOG.md
   ```

4. Build and point your `.mcp.json` at the local build:

   ```bash
   npm run build
   ```

   ```json
   {
     "mcpServers": {
       "okffs": {
         "command": "node",
         "args": ["dist/index.js"]
       }
     }
   }
   ```

## Tools

| Tool | Description |
|------|-------------|
| `create_issue` | Creates a GitHub issue and a matching branch. Infers labels automatically; merges them with `OKFFS_DEFAULT_LABELS`. Supports optional `assignees`, `labels`, and `milestone`. If `OKFFS_AUTO_PR=true`, pushes an empty init commit and opens a draft PR for the branch immediately. |
| `create_issues_from_list` | Creates multiple issues and branches from a task list in one shot. Confirms before acting. Per-task `labels`, `assignees`, and `milestone` supported. |
| `list_issues` | Lists all open issues with their issue URL and branch URL. |
| `get_issue` | Fetches full details of an issue — title, body, labels, assignees, branch, and status. |
| `comment_issue` | Posts a comment to an issue. Useful for logging work done on a branch. |
| `link_issues` | Links two issues with a relationship — `blocked_by`, `blocking`, or `parent`. Stored in the issue body under a `## Relationships` section. |
| `close_issue` | Closes a GitHub issue by number. Returns a tip to run `/clear` in Claude Code before starting the next issue. |
| `create_pull_request` | Creates a PR for an issue branch. Generates title and body from the issue, commits, and comments. If `OKFFS_UPDATE_DOCS=true`, commits the updated CHANGELOG onto the branch; pushes the branch before opening the PR. Always includes `Closes #N`. Posts a summary comment to the issue. |
| `commit_and_update` | Stages all changes, builds a commit message from the provided `hint` (or the changed file list), commits, pushes to the issue branch, and posts a rich progress comment to the linked issue. |
| `delete_issue` | Closes an issue **and** deletes its matching branch. Destructive — requires `confirmed: true`. |
| `delete_branch` | Deletes a branch **and** closes its matching issue. Destructive — requires `confirmed: true`. |

Destructive tools (`delete_issue`, `delete_branch`) follow a two-step confirmation pattern: call once to see a warning, then re-call with `confirmed: true` to proceed. A comment is posted to the issue before any action is taken.

## Automatic doc updates

When `OKFFS_UPDATE_DOCS=true` in your `.env`, okffs will automatically update local project docs when workflow events fire (closing issues, creating PRs, posting comments). Changes are written to local files — committing is your responsibility.

Files updated when relevant:
- `CHANGELOG.md` — always updated, created if missing. Entries follow [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) format. `create_pull_request` updates it before opening the PR and commits it onto the branch so it's included in the diff.
- `CLAUDE.md` — updated when convention, workflow, tool, config, or architecture keywords are detected.
- `SECURITY.md` — updated when security, vulnerability, or CVE keywords are detected.
- `CONTRIBUTING.md` — updated when convention, contributing, or workflow keywords are detected.

Use `OKFFS_EXCLUDE_DOCS` to exclude specific files per repo:
```env
OKFFS_EXCLUDE_DOCS=CLAUDE.md,CONTRIBUTING.md
```
README.md is intentionally excluded from auto-updates — maintain it manually.

## Conventions

**Branch naming:** `{issue-number}-{kebab-title-slug}` (title truncated to ~5 words)

```
42-add-hero-section-to-homepage
```

**Pull requests:**

- Title: `Close #42 - Add hero section to homepage`
- Body always includes `Closes #42` so GitHub auto-closes the issue when the PR merges to `main`.

**Operating principles:**

- Destructive tools require `confirmed: true` — call once for a warning, re-call to proceed. Bulk-creating tools confirm before acting.
- GitHub is always the source of truth for issue state — never local.
- Keep the tool surface minimal: do one thing well per tool.

## Publishing to npm

Requires an npm account with maintainer access to the `okffs` package.

1. Bump the version in `package.json` following [semver](https://semver.org/)
2. Commit and merge to `main`
3. Tag and push:

   ```bash
   git tag v0.1.4
   git push origin v0.1.4
   ```

The GitHub Actions workflow publishes to npm automatically on semver tags (`v*.*.*`). The `NPM_TOKEN` secret must be set in the repository settings.

## Codebase search

This project uses [semble](https://github.com/MinishLab/semble) for semantic code search via MCP. The sub-agent config lives at `.claude/agents/semble-search.md` and is picked up automatically by Claude Code.

To search manually (requires `uv`):

```bash
uvx --from "semble[mcp]" semble search "your query" .
```