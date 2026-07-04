# Contributing to okffs

Thanks for your interest in contributing to okffs. This document covers how to report bugs, suggest features, and submit pull requests.

## Reporting bugs

Open an issue on [GitHub](https://github.com/neturely/okffs/issues) with:
- A clear title describing the problem
- Steps to reproduce
- Expected vs actual behaviour
- Your Node.js version and okffs version (`npm show okffs version`)

## Suggesting features

Open an issue with the `enhancement` label. Describe the use case and how it fits the okffs workflow (issue → branch → PR → close).

## Development setup

1. Fork and clone the repo:
   ```bash
   git clone https://github.com/neturely/okffs.git
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

Maintainer only. Requires an npm account with maintainer access to `@neturely/okffs` (published publicly via `publishConfig.access`).

1. **Prepare the release** with the `prepare_release` tool (ask Claude, e.g. *"prepare a release"* or *"prepare release 0.2.0"*). It bumps `package.json` + `package-lock.json`, rolls the CHANGELOG, and opens a release PR. Review and merge it, then merge to `main`.
2. **Tag and push** the version:
   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```

GitHub Actions publishes to npm automatically on semver tags (`v*.*.*`), so **do not run `npm publish` manually** — it would collide with CI. The `NPM_TOKEN` secret must be set in the repository settings. `prepare_release` deliberately stops before tagging so the irreversible publish stays a manual decision.

## Codebase search

This project uses [semble](https://github.com/MinishLab/semble) for semantic code search via MCP. The sub-agent config lives at `.claude/agents/semble-search.md` and is picked up automatically by Claude Code. To search manually (requires `uv`):

```bash
uvx --from "semble[mcp]" semble search "your query" .
```

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for release notes and history.