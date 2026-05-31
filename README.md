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

## Getting started

> The server is not yet published. These steps describe the intended local setup.

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

## NAS backup hook

This repo includes a `pre-push` git hook ([.githooks/pre-push](.githooks/pre-push)) that backs up the files changed in the most recent commit to a remote server (e.g. a NAS) over SSH before each push. Failed transfers are queued and retried on the next push.

### Requirements

- `sshpass`, `ssh`, and `scp` available on your `PATH`.
- The backup target must accept **password-based** SSH (keyboard-interactive); public-key auth is explicitly disabled in the hook.

### Setup

1. **Enable the hook directory** so git runs the hook:

   ```bash
   git config core.hooksPath .githooks
   ```

2. **Add the backup variables to `.env`** (same file as `GITHUB_TOKEN`; git-ignored):

   ```bash
   BACKUP_USER=youruser
   BACKUP_SERVER=nas.local          # hostname or IP
   BACKUP_PATH=/volume1/backups/okffs
   BACKUP_PASSWORD=yourpassword
   BACKUP_PORT=22                   # optional, defaults to 22
   ```

   All four of `BACKUP_USER`, `BACKUP_SERVER`, `BACKUP_PATH`, and `BACKUP_PASSWORD` are required. If `.env` is missing or incomplete the hook skips the backup with a warning rather than blocking the push.

### Behaviour

- On each push, files changed in `HEAD` are copied to `BACKUP_PATH` on the server, preserving their repo-relative paths.
- If the server is unreachable or a file fails to transfer, it is added to a retry queue (`logs/.backup-queue`) and flushed on the next successful push.
- Activity is logged to `logs/.pre-push.log`. Both `logs/` and `.env` are git-ignored.
