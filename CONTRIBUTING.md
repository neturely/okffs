# Contributing to okffs

Thanks for your interest in contributing to okffs. This document covers how to report bugs, suggest features, and submit pull requests.

## Reporting bugs

Open an issue on [GitHub](https://github.com/2b9sa2owa/okffs/issues) with:
- A clear title describing the problem
- Steps to reproduce
- Expected vs actual behaviour
- Your Node.js version and okffs version (`npm show okffs version`)

## Suggesting features

Open an issue with the `enhancement` label. Describe the use case and how it fits the okffs workflow (issue → branch → PR → close).

## Development setup

1. Fork and clone the repo:
   ```bash
   git clone https://github.com/2b9sa2owa/okffs.git
   cd okffs
   npm install
   ```

2. Copy the env template and fill in your credentials:
   ```bash
   cp .env.example .env
   ```

3. Build and run locally:
   ```bash
   npm run build
   npm run dev
   ```

4. Wire up to Claude Code for testing:
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

## Adding a new tool

Each tool lives in `src/tools/{tool_name}.ts` and exports `name`, `description`, `inputSchema`, and `handler`. Register it in `src/index.ts`.

Follow the existing patterns:
- Destructive tools require `confirmed: true` — warn on first call, act on second
- Always post a comment to the issue before destructive actions
- Use `getIssue()` to fetch issue context; use `extractBranchFromBody()` to find the linked branch
- Call `updateProjectDocs()` when `config.updateDocs` is true

## Branch and PR conventions

- Branch from `OKFFS_BASE_BRANCH` (or the repo default branch): `{issue-number}-{kebab-title-slug}`
- PR title: `Close #N - Issue title`
- PR body must include `Closes #N`
- One logical change per PR

## Commit messages

Use conventional commits:
- `feat:` — new tool or feature
- `fix:` — bug fix
- `docs:` — documentation only
- `chore:` — build, config, deps

## Publishing

Maintainer only. Bump `package.json` version, merge to `main`, tag with `vX.Y.Z` — GitHub Actions handles the npm publish automatically.

## Changelog
- 2026-06-28: Adds an out-of-the-box PR review-response workflow. New tools: list_pr_review_comments (fetch inline threads + review summaries via GraphQL, with comment ids, file/line, author, body, resolved state, and thread ids), reply_to_review_comment (reply to a thread by id), and resolve_review_thread (resolve via GraphQL, gated by the new OKFFS_RESOLVE_THREADS env var — declines unless enabled so threads are left for the user by default). Adds an MCP prompt address_pr_review (surfaced as a slash command) that orchestrates read → triage/fix → commit_and_update → reply per thread → comment_issue summary → optional resolve, and wires up the MCP prompts capability in index.ts. Top-level PR summary comments reuse comment_issue (PRs are issues). Documented in README (tools table + new "Responding to PR reviews" section), .env.example, and CLAUDE.md. Verified live against PR #57 (threads, ids, replies parsed correctly), the resolve guard, and the prompt builder.