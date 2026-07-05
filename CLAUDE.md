# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project

**okffs** is a TypeScript/Node.js MCP server that connects Claude Code to GitHub, enabling a full **issue → branch → merge → close** workflow. The goal: discuss tasks in Claude.ai, then push them to GitHub as issues and branches in one shot via Claude Code.

## Stack

- TypeScript / Node.js MCP server
- GitHub Personal Access Token (PAT) authentication (upgrade to a GitHub App later)
- Published to npm (package name: `@neturely/okffs`) and the MCP Registry (`registry.modelcontextprotocol.io`)

## Conventions

- **Destructive tools require `confirmed: true`** — call once for a warning, re-call to proceed.
- **GitHub is the source of truth** for issue state, never local.
- **Keep the tool surface minimal** — do one thing well per tool.
- **Destructive actions post a comment to the issue before acting.**
- **Always reach for an okffs tool before raw `git`/`gh`/GraphQL** when one covers the action — a correctness rule, not a style preference. okffs authenticates with the configured `GITHUB_TOKEN` (scoped for this repo, incl. Projects/org Issue Fields), whereas raw `gh`/`git` uses whatever ambient CLI token is signed in — often the wrong identity or missing scopes; and okffs applies the conventions (branch naming, the **Branch:** link, `Closes #N`, board placement, changelog fragments, the `OKFFS_PROTECTED_BRANCH` invariant) that hand-rolled commands silently skip. When an okffs tool covers the action — issues, PRs (`create_pull_request` for an issue's PR; **`promote_branch` for a base→protected promotion like `develop → main`**, never raw `gh pr create`), comments, review threads (`resolve_review_thread` / the `address_pr_review` prompt), releases (`prepare_release`), project status — use it and honour its env toggles (`OKFFS_RESOLVE_THREADS`, `OKFFS_BASE_BRANCH`, `OKFFS_PROTECTED_BRANCH`, `OKFFS_PROMOTION_*`, …) rather than re-deriving the behaviour. Fall back to raw `git`/`gh` only when no okffs tool fits. Never merge/tag/publish into `OKFFS_PROTECTED_BRANCH` autonomously (okffs may *open* a PR into it, but not merge) — hand back to the user.

### Branch naming

`{issue-number}-{kebab-title-slug}` — title truncated to ~5 words, no forward slashes.

```
42-add-hero-section-to-homepage
```

When `OKFFS_IDENTIFIER` is set, a project-scoped prefix is inserted: `{issue-number}-{identifier}-{kebab-title-slug}`.

```
42-okffs-add-hero-section-to-homepage
```

### Pull requests

- Title: `Close #42 - Add hero section to homepage`
- Body **always** includes `Closes #42` — this triggers GitHub's native auto-close **only when the PR merges into the repository's default branch** (usually `main`). If `OKFFS_BASE_BRANCH` points at a non-default branch (e.g. `develop`), GitHub will **not** auto-close the issue on merge — close it manually with `close_issue`. `create_pull_request` warns when the PR targets a non-default base.

## Build phases

### Phase 1 — Core MCP server ✓ Complete

- TypeScript MCP server scaffolded.
- PAT auth via `.env` (`GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO`).
- `.env` is loaded automatically via `dotenv` from `process.cwd()` — no `--env-file` flag needed in `.mcp.json`.
- Tools: `create_issue`, `list_issues`, `close_issue`, `delete_issue`, `delete_branch`, `get_issue`, `comment_issue`, `link_issues`, `create_issues_from_list`, `plan`, `create_pull_request`, `commit_and_update`, `list_pr_review_comments`, `reply_to_review_comment`, `resolve_review_thread`, `prepare_release`, `update_project_status`.
- Prompts (MCP `prompts` capability, surfaced as slash commands): `address_pr_review` — read a PR's review comments, fix the valid ones, reply per thread, post a summary, and optionally resolve threads; `update_guidance` — review an issue's changes and intelligently maintain the bounded `## Project Guidance (okffs usage)` section of CLAUDE.md to reflect new/changed functionality (substantive, marker-delimited; never touches the user's other content).
- `create_issue` auto-creates a branch, embeds the branch name in the issue body, applies default assignees/labels from `.env`, infers labels from title/description and merges with `OKFFS_DEFAULT_LABELS`. Supports optional `assignees`, `labels`, `milestone`. If a relationship is mentioned (blocked by, blocking, parent), automatically calls `link_issues` after creation. If `OKFFS_AUTO_PR=true`, pushes an empty init commit to the branch (capturing and restoring the current branch) and opens a draft PR immediately.
- `create_issues_from_list` accepts a list of tasks and creates all issues + branches in one shot. Two-step confirmation. Per-task `labels`, `assignees`, and `milestone` supported.
- `plan` takes a free-text `description` plus the issue breakdown Claude generates from it (titles, descriptions, labels, inter-task relationships referenced by 1-based index) and creates all issues + branches in one shot. Two-step confirmation (preview, then `confirmed: true`). Resolves task-index relationships to real issue numbers and writes them to each issue's `## Relationships` section. If `OKFFS_AUTO_PR=true`, pushes an empty init commit per branch and opens a draft PR for each. Extends the `create_issues_from_list` pattern — Claude is the AI layer that produces the breakdown.
- `list_issues` returns each open issue with its issue URL, branch name + URL, any matched open/draft PR (by head branch), its board column (`project:`), its `priority:`, and its relationships (parent, children, blocked-by, blocking) rendered as a tree. Issues are **ordered by Priority** (Urgent → High → Medium → Low → unset) so the most important work surfaces first — the agent factors Priority in when deciding what to do next. Priority is read from the project-native Priority field, or the org-level Issue Field when `OKFFS_CLASSIC_PAT=true`. Children are derived by inverting `Parent:` links across issues. Replaces the need for a separate PR-listing tool.
- `get_issue` fetches full issue details — title, body, status, branch, assignees, labels.
- `comment_issue` posts a comment to an issue. Use after committing to log what was done.
- `link_issues` links two issues with a relationship — `blocked_by`, `blocking`, or `parent`. Stored in the issue body under a `## Relationships` section.
- `close_issue` closes the issue and returns a tip suggesting the user runs `/clear` in Claude Code to reset context before the next issue. (Under `OKFFS_AUTO_PR=true` the draft PR already exists from `create_issue`, so no PR is created here.)
- `commit_and_update` stages all changes, builds a commit message from the optional `hint` (or the changed file list), commits, pushes to the issue branch, and posts a rich progress comment to the linked issue.
- `list_pr_review_comments` fetches a PR's review feedback via GraphQL — inline threads (comment ids, file/line, author, body, resolved state, thread ids) and review summaries. The agent reads these, fixes, then replies/resolves.
- `reply_to_review_comment` replies to an inline review comment thread by id (REST `in_reply_to`).
- `resolve_review_thread` resolves a review thread (GraphQL). Gated by `OKFFS_RESOLVE_THREADS`: declines unless that env var is `true`, leaving threads for the user to resolve manually.
- `address_pr_review` (MCP prompt / slash command) orchestrates the loop: `list_pr_review_comments` → triage + fix → `commit_and_update` → `reply_to_review_comment` per thread → `comment_issue` summary → `resolve_review_thread` (respects `OKFFS_RESOLVE_THREADS`). The host LLM provides triage/fixes; okffs provides the plumbing. When the reviewed PR's head is a protected integration branch you can't push to directly — a promotion/gate PR like `develop → main` — fixes can't commit onto the head; instead they route through a follow-up PR into the head branch that must be **merged** to actually land the fix, and threads are only resolved **after** that merge (resolving while the fix sits in an unmerged PR is misleading). Complete the loop — don't leave a dangling follow-up PR. Never merge into `OKFFS_PROTECTED_BRANCH` autonomously (#192).
- `prepare_release` bumps the version in `package.json` + `package-lock.json`, rolls the CHANGELOG (`[Unreleased]` → `## [X.Y.Z] - <date>`, fresh empty `[Unreleased]`, updated compare links), commits on a `release/X.Y.Z` branch off `OKFFS_BASE_BRANCH`, and opens a PR. Takes an explicit `version` or a `bump` level; if neither, infers the level from `[Unreleased]` (`### Added` → minor, else patch) and surfaces it. Two-step confirmation. It does **not** tag or publish — tag `vX.Y.Z` after merge to trigger the CI npm publish.
- `promote_branch` opens the **issue-less** release/promotion PR from one long-lived branch into another — e.g. `develop → main`. Use it instead of raw `gh pr create` for a base→protected promotion. Head defaults to `OKFFS_BASE_BRANCH`, base to `OKFFS_PROTECTED_BRANCH` (else the repo default); both overridable. No `Closes #N`, and **no confirmation** — opening a PR is safe and reversible (the merge/tag are the user-gated steps okffs never drives). Adds the **PR itself** to the Projects v2 board as a card (Projects v2 accepts PRs as first-class items), optionally into `OKFFS_PROMOTION_STATUS`, and — when `OKFFS_PROMOTION_AUTO_REVIEW=true` — requests `OKFFS_PROMOTION_REVIEWERS` (e.g. Copilot) **on PR creation only** (never on re-runs, to avoid repeat/billable reviews) — all best-effort, surfaced in the response, never blocking. Reuses an already-open PR for the head→base rather than erroring. okffs opens and hands back; it never merges (#182, #194).
- `update_guidance` (MCP prompt / slash command) reviews an issue's diff and maintains a single okffs-owned region of CLAUDE.md — the `## Project Guidance (okffs usage)` section delimited by `<!-- okffs:guidance:start -->` / `<!-- okffs:guidance:end -->` markers (created once if absent). It curates only that region (tools, env vars, prompts, conventions) and never edits the user's hand-written content elsewhere; not a changelog append; skips when nothing substantive changed. `create_pull_request` nudges the agent to run it when `OKFFS_UPDATE_GUIDANCE=true`.
- `delete_issue` closes an issue and deletes its branch. Two-step: call once for a warning, re-call with `confirmed: true` to proceed. Posts a comment before acting.
- `delete_branch` deletes a branch and closes its issue (issue number parsed from branch name prefix). Same two-step confirmation pattern. Posts a comment before acting.
- Optional `.env` defaults: `OKFFS_DEFAULT_ASSIGNEES`, `OKFFS_DEFAULT_LABELS`, `OKFFS_DEFAULT_PRIORITY`, `OKFFS_DEFAULT_EFFORT`, `OKFFS_PROMPT_METADATA`, `OKFFS_BASE_BRANCH`, `OKFFS_PROTECTED_BRANCH`, `OKFFS_IDENTIFIER`, `OKFFS_UPDATE_DOCS`, `OKFFS_AUTO_PR`.
- `OKFFS_BASE_BRANCH` — branch to create new issue branches from. Defaults to the repo's default branch.
- `OKFFS_PROTECTED_BRANCH` — a branch okffs must never autonomously **merge**, tag, or publish into (e.g. `main`). It governs *merging*, not PR *creation*: okffs will freely **open** a PR that targets it (opening is safe and reversible — the merge is the risk, and it's already gated by branch protection plus your manual merge), and `create_pull_request` adds a reminder that the merge/tag stay with you when the base is protected. `prepare_release` likewise flags merging/tagging into it as manual, user-gated steps an agent must not drive autonomously. Unset by default (#152, #181).
- `OKFFS_IDENTIFIER` — optional project-scoped prefix inserted into branch names: `{issue-number}-{identifier}-{slug}`. Unset by default.
- `OKFFS_UPDATE_DOCS` — set to `true` to auto-update local project docs when a pull request is created (`create_pull_request`). Default `false`. For the changelog it writes a per-issue **fragment** at `.changes/unreleased/{issue-number}-{slug}.md` rather than editing the shared **CHANGELOG.md** directly — uniquely-named fragments never collide, so parallel issue branches don't hit add/add or same-hunk conflicts on the changelog (#105). `prepare_release` assembles the fragments into CHANGELOG.md (grouped under the right `###` heading) and deletes them in the release commit. Also updates **SECURITY.md** (security-related changes only); entries are title-based one-liners. CLAUDE.md, CONTRIBUTING.md, and README.md are intentionally **not** auto-updated (they previously got truncated changelog-style appends that duplicated CHANGELOG). `comment_issue` and `close_issue` do not trigger doc updates — `create_pull_request` is the single source of auto-changelog fragments. The `OKFFS_EXCLUDE_DOCS` key `CHANGELOG.md` still suppresses the fragment entirely.
- `OKFFS_AUTO_PR` — set to `true` to open a draft PR when a new issue branch is created (via `create_issue`). Default `false`.
- `OKFFS_RESOLVE_THREADS` — set to `true` to let okffs auto-resolve PR review threads after they're addressed (via `resolve_review_thread`). Default `false` — threads are left open for the user to resolve.
- `OKFFS_UPDATE_GUIDANCE` — set to `true` to have `create_pull_request` nudge the agent to keep CLAUDE.md in sync with new/changed functionality (via the `update_guidance` prompt). Default `false`. The prompt is always available regardless.
- `set_issue_fields` sets a board Priority and/or Effort on an **existing** issue (adds it to the board first if needed), reusing the shared `board.ts` path so it handles both project-native single-selects and org-level Issue Fields (classic PAT) and surfaces skips like `create_issue`. Fills the gap where `create_issue` only sets these at creation time; Status stays with `update_project_status`. Requires `OKFFS_PROJECT_ENABLED` (#171).
- `update_project_status` moves an issue between GitHub Projects v2 board columns (`Backlog`, `Ready`, `In Progress`, `Review`) via GraphQL. `Done` is intentionally excluded — it is owned by native GitHub board automation on merge/close. Guarded by `OKFFS_PROJECT_ENABLED`; resolves the board's field/option node IDs at runtime (no hardcoding). Driven conversationally: after `create_issue` places an issue on the board, the agent offers to move it to `In Progress` and start.
- `OKFFS_PROJECT_ENABLED` — set to `true` to enable the Projects v2 integration (`list_issues` shows each issue's board column; `update_project_status` works). Default `false`; zero overhead when unset.
- `OKFFS_PROJECT_ID` — the Project's GraphQL node ID (e.g. `PVT_kwHO...`). Required when the feature is enabled.
- `OKFFS_PROJECT_AUTO_ADD` — set to `true` (fallback only) to have `create_issue` add new issues to the board via GraphQL, optionally setting a `priority`. Default `false` — leave off if your board uses GitHub's native auto-add workflow. Non-fatal: failures warn `[okffs]` and are also surfaced in the `create_issue` response (so an auto-add failure isn't invisible — see #101) and never block issue creation. Projects v2 needs a Projects-capable token (fine-grained: org "Projects: Read and write"; classic: `project` scope); missing permission surfaces a clear `[okffs]` error. **Note:** when relying on the gh-CLI fallback token (no `GITHUB_TOKEN` set), that token usually lacks the `project` scope — grant it with `gh auth refresh -s project,read:project`.
- `OKFFS_PROMOTION_STATUS` — optional board Status column (e.g. `Review`) the `promote_branch` PR card should land in. Unset by default (leave it to the board's own automation). Requires `OKFFS_PROJECT_ENABLED`. (#182)
- `OKFFS_PROMOTION_REVIEWERS` — optional comma-separated reviewers requested on the `promote_branch` gate PR (e.g. `copilot-pull-request-reviewer[bot]` for GitHub Copilot code review — the develop→main review convention). Unset by default. Only acted on when `OKFFS_PROMOTION_AUTO_REVIEW=true`. Best-effort: a failure warns `[okffs]` and is surfaced in the response, never blocking the PR. (#182)
- `OKFFS_PROMOTION_AUTO_REVIEW` — explicit opt-in (default `false`) for `promote_branch` to auto-request `OKFFS_PROMOTION_REVIEWERS`. When `true`, reviewers are requested **only when the gate PR is first created** — never on updates/re-runs — so a reviewer isn't re-triggered each time; re-review after new commits is a manual step. **⚠️ Cost:** GitHub Copilot code review is billable, so enabling this with Copilot incurs a charge per newly-created promotion PR. Leave `false` to request reviews manually. (#194)
- `OKFFS_PROJECT_INITIAL_STATUS` — optional board Status column (e.g. `Backlog`) that a freshly auto-added issue should land in. `create_issue` applies it **after** the draft PR is created, so it wins over GitHub's built-in "PR linked to issue" workflow — which would otherwise flip a just-scaffolded issue straight to "In Progress" (#103). Unset by default (leave the board's own automation in charge). Must exactly match one of the board's Status option names; non-fatal `[okffs]` warning if it doesn't. Best-effort: GitHub's linked-PR automation is asynchronous, so in rare cases it may still re-flip after okffs sets the status.

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
- If `OKFFS_UPDATE_DOCS=true`, writes a changelog **fragment** under `.changes/unreleased/` (see #105) before the PR is created and commits it onto the branch (`git add` + commit) so it's included in the PR diff. A commit failure is logged with an `[okffs]` prefix and never blocks PR creation.
- Before creating the PR, the branch is pushed to remote (`git push origin <branch>`). If the push fails, a comment is posted to the issue and the PR is not created.
- `OKFFS_AUTO_PR` no longer triggers a PR on close — the draft PR is opened at branch-creation time by `create_issue`. To accept the draft PR immediately, `create_issue` first pushes an empty init commit so the branch diverges from base.
- `commit_and_update` tool — stages all changes, generates a conventional commit message, commits, pushes to the current branch, and posts a rich progress comment to the linked issue.
- GitHub natively closes the issue on merge via `Closes #N` — no webhook infrastructure needed. Note: this only fires when merging into the repo's default branch. With a `develop`-based workflow (`OKFFS_BASE_BRANCH=develop`), merge to `develop` does not auto-close; use `close_issue`.
- Edge case: if the branch has no commits ahead of the base branch, a friendly comment is posted instead of erroring.

### Phase 5 — GitHub Projects v2 ✓ Complete

- Opt-in via `OKFFS_PROJECT_ENABLED`; org-level board addressed by `OKFFS_PROJECT_ID` (GraphQL node ID). Zero overhead when disabled.
- Projects v2 has no REST API — all board work goes through GraphQL, reusing the shared `graphqlRequest` helper (exported from `github.ts`). Projects code lives in `src/projects.ts`; field and single-select option node IDs are **discovered at runtime and memoized**, never hardcoded (they differ per board).
- `create_issue` — when `OKFFS_PROJECT_AUTO_ADD=true`, adds the new issue to the board and optionally sets a `priority` and/or `effort` (both handled by one generic helper). By default the tool description tells Claude to **infer** the `priority`/`effort` from the task itself (like it already infers labels), using the common scale, and to omit the field when it can't judge — so `OKFFS_DEFAULT_PRIORITY`/`OKFFS_DEFAULT_EFFORT` become the fallback for the ambiguous case rather than a blunt always-value. Inference is toggled per field by `OKFFS_INFER_PRIORITY` / `OKFFS_INFER_EFFORT` (default on). Injecting the board's *real* option names for arbitrary boards is tracked in #133. Two field shapes are supported for each: a **project-native single-select** field (set on the project item) and a GitHub **org-level Issue Field** (Phase 5.1, #91). When the project field reports no options — the signature of an org Issue Field — okffs resolves the option via `organization.issueFields` (any single-select field by name) and sets it on the **issue** with `setIssueFieldValue`. Non-fatal, mirroring the `autoPR` block: any failure warns `[okffs]` and never blocks issue creation. `OKFFS_PROJECT_AUTO_ADD` is a fallback for boards without GitHub's native auto-add workflow.
- `update_project_status` — moves an issue between `Backlog`, `Ready`, `In Progress`, `Review`. **`Done` is intentionally excluded** — native GitHub board automation owns it on PR merge / issue close (okffs already writes `Closes #N`). Driven conversationally by the agent at the natural workflow moments.
- `list_issues` — surfaces each issue's current board column (`project: <column>`), its `priority:`, and its `effort:`, and orders the listing by Priority (Urgent → High → Medium → Low → unset). Priority and Effort come from the project-native fields, or the org Issue Fields when `OKFFS_CLASSIC_PAT=true` (one extra batched query returning all org single-select values, gated on that flag). Non-fatal: the listing still renders if either Projects fetch fails.
- Token permission: fine-grained PAT → org "Projects: Read and write"; classic PAT → `project` scope. Missing permission surfaces a clear `[okffs]` 403 error. **Org-level Issue Fields (Priority) need a *different* permission** than Projects: a **classic PAT with `admin:org`** can read `organization.issueFields` and write via `setIssueFieldValue`; **fine-grained PATs currently return FORBIDDEN** for this preview API. This path is gated behind **`OKFFS_CLASSIC_PAT=true`** — an explicit opt-in (default off) that declares `GITHUB_TOKEN` is a broad-scoped classic `admin:org` token. When off (or the token can't reach it), the org-priority path is skipped with an actionable `[okffs]` message (set Priority in the UI, or enable the flag with an `admin:org` classic token).
- `OKFFS_CLASSIC_PAT` — default `false`. Set `true` only when `GITHUB_TOKEN` is a classic PAT with `admin:org`, to enable setting org-level Issue Field Priority (#91). **Security tradeoff:** classic `admin:org` tokens are coarse (all your repos + org admin), so this is opt-in and warned about in `.env.example`.

### Phase 6 — Project site

- Set up `okffs.g2mk.dev` subdomain on Cloudflare (point to Knowhost).
- Build static site pulling live data from npm Registry API and GitHub API.
- Display: README content, install command, version, download stats, GitHub stars, license.
- Design as a reusable template for future projects under `g2mk.dev`.

## Publishing targets

- **npm** — package name: `@neturely/okffs`
- **MCP Registry** (`registry.modelcontextprotocol.io`) — via the `mcp-publisher` CLI
- Listings: `mcp.so`, `smithery.ai`, `glama.ai/mcp`, `punkpeye/awesome-mcp-servers`

## Local setup

- `.env` holds the GitHub PAT (`GITHUB_TOKEN`) with fine-grained permissions. It is git-ignored — see [.env.example](.env.example).
- `.env` is loaded automatically at startup via `dotenv` from `process.cwd()`. No `--env-file` flag required in `.mcp.json`.
- Auth resolution: `GITHUB_TOKEN` if set, otherwise falls back to the GitHub CLI (`gh auth token`). If neither is available, startup fails with a message linking to the one-click PAT page.
- Repo resolution: `GITHUB_OWNER`/`GITHUB_REPO` if set, otherwise auto-detected by parsing the `origin` git remote of `process.cwd()`. So with `gh` signed in and okffs run inside the target repo, no `.env` is required.
- Resolution lives in `src/github.ts` (`resolveToken`, `resolveOwnerRepo`); `owner`/`repo` are exported from there and reused (e.g. `docs.ts`) so detected values flow everywhere.
- Optional: `OKFFS_DEFAULT_ASSIGNEES` (comma-separated), `OKFFS_DEFAULT_LABELS` (comma-separated), `OKFFS_PROMPT_METADATA` (set to `false` to silence the tip), `OKFFS_BASE_BRANCH` (branch to create from; defaults to repo default), `OKFFS_PROTECTED_BRANCH` (a branch okffs won't autonomously merge/tag/publish into, e.g. `main`; it may still open a PR targeting it — the gate is on merging, not PR creation; unset by default — #152, #181), `OKFFS_IDENTIFIER` (optional project-scoped branch prefix: `{number}-{identifier}-{slug}`), `OKFFS_UPDATE_DOCS` (set to `true` to enable auto doc updates), `OKFFS_AUTO_PR` (set to `true` to open a draft PR at branch-creation time via `create_issue`), `OKFFS_RESOLVE_THREADS` (set to `true` to auto-resolve PR review threads after addressing; default leaves them for the user), `OKFFS_UPDATE_GUIDANCE` (set to `true` to nudge keeping CLAUDE.md in sync with functionality changes at PR time), `OKFFS_EXCLUDE_DOCS` (comma-separated filenames to exclude from auto-updates — valid options: `CHANGELOG.md`, `SECURITY.md`), `OKFFS_PROJECT_ENABLED` (set to `true` to enable the GitHub Projects v2 integration), `OKFFS_PROJECT_ID` (the board's GraphQL node ID; required when enabled), `OKFFS_PROJECT_AUTO_ADD` (set to `true` as a fallback to have `create_issue` add issues to the board when your board has no native auto-add), `OKFFS_PROJECT_INITIAL_STATUS` (board Status column a freshly auto-added issue should land in, e.g. `Backlog`; set after the draft PR so it wins over GitHub's linked-PR "In Progress" promotion — #103), `OKFFS_CLASSIC_PAT` (set to `true` only when `GITHUB_TOKEN` is a classic `admin:org` PAT, to enable org-level Issue Field Priority — #91; default `false`; security tradeoff), `OKFFS_DEFAULT_PRIORITY` (Priority applied to a new issue when `create_issue` isn't given an explicit one, e.g. `Medium`; mirrors `OKFFS_DEFAULT_LABELS`; unset by default), `OKFFS_DEFAULT_EFFORT` (same as `OKFFS_DEFAULT_PRIORITY` but for the board's Effort field, e.g. `Medium`; unset by default), `OKFFS_INFER_PRIORITY` / `OKFFS_INFER_EFFORT` (default `true` — have Claude infer the priority/effort for each new issue from the task, falling back to the defaults when unsure; set `false` to disable the inference instruction).

## Local dev vs published package

- **okffs dev repo** — `.mcp.json` points at local build: `{ "command": "node", "args": ["dist/index.js"] }`
- **Consumer repos** — `.mcp.json` uses published package: `{ "command": "npx", "args": ["@neturely/okffs@latest"] }`
- New tools won't appear in consumer repos until a new version is published to npm.
- After any build change in the okffs repo, restart Claude Code or run `/mcp` to pick up the updated `dist/index.js`.

## Codebase search

This project uses [semble](https://github.com/MinishLab/semble) for semantic code search. The MCP server is registered at the user level (`~/.claude.json`) and a dedicated sub-agent is configured at `.claude/agents/semble-search.md`.

**Claude Code should use the `semble-search` sub-agent for any exploratory or semantic codebase questions** — finding implementations, understanding how something works, locating related code — instead of grep/glob/read directly.

To search manually:

```bash
uvx --from "semble[mcp]" semble search "your query" .
```

## Recent Changes

See [CHANGELOG.md](CHANGELOG.md) for the full, per-version history and [Releases](https://github.com/neturely/okffs/releases) for release notes. This file's tool and phase sections above are kept current; the changelog is the single source of dated change history.