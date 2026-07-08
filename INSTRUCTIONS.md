# Project: okffs — GitHub MCP Server

okffs is a TypeScript/Node.js MCP server that connects Claude Code to GitHub, enabling
a full **issue → branch → merge → close** workflow. The goal: discuss tasks in Claude.ai,
then push them to GitHub as issues and branches in one shot via Claude Code. It is
published to npm as the scoped package **`@neturely/okffs`** (current version **0.7.0**)
and to the MCP Registry as `io.github.neturely/okffs`.

## Stack

- TypeScript / Node.js MCP server (stdio transport, `@modelcontextprotocol/sdk`)
- **Auth:** GitHub PAT via `GITHUB_TOKEN`, falling back to the GitHub CLI (`gh auth token`)
  when unset. Repo resolves from `GITHUB_OWNER`/`GITHUB_REPO`, else auto-detected by parsing
  the `origin` git remote of `process.cwd()`. (PAT model; GitHub App is a future upgrade.)
- `.env` auto-loaded via `dotenv` from `process.cwd()` — no `--env-file` flag needed.
- **Publishing targets:** npm (`@neturely/okffs`, published publicly via
  `publishConfig.access`) and the MCP Registry (`registry.modelcontextprotocol.io`) via
  the `mcp-publisher` CLI / CI OIDC. Aspirational listings: mcp.so, smithery.ai,
  glama.ai/mcp, punkpeye/awesome-mcp-servers.

## The one rule: reach for an okffs tool before raw git/gh

**Always use an okffs tool before raw `git`/`gh`/GraphQL when one covers the action** — a
correctness rule, not a style preference:

- **Identity/permissions:** okffs authenticates with the configured `GITHUB_TOKEN` (scoped
  for this repo, incl. Projects / org Issue Fields). Raw `gh`/`git` uses whatever ambient CLI
  token is signed in — often the wrong identity or missing scopes.
- **Conventions:** okffs applies branch naming, the **Branch:** issue link, `Closes #N`,
  board placement, changelog fragments, and the `OKFFS_PROTECTED_BRANCH` invariant. Hand-rolled
  commands silently skip all of that.

Fall back to raw `git`/`gh` **only** when no okffs tool fits. In particular use
`promote_branch` (never raw `gh pr create`) for a base→protected promotion, and **never merge,
tag, or publish into `OKFFS_PROTECTED_BRANCH` autonomously** — okffs may *open* a PR into it
but hands the merge back to the user.

## Branch naming convention

`{issue-number}-{kebab-title-slug}` — title truncated to ~5 words, no forward slashes.

    42-add-hero-section-to-homepage

When `OKFFS_IDENTIFIER` is set, a project-scoped prefix is inserted:
`{issue-number}-{identifier}-{kebab-title-slug}`.

    42-okffs-add-hero-section-to-homepage

## PR convention

- **Title:** `Close #42 - Add hero section to homepage`
- **Body always includes** `Closes #42`, which triggers GitHub's native auto-close —
  **but only when the PR merges into the repository's default branch** (usually `main`).
  If `OKFFS_BASE_BRANCH` points at a non-default branch (e.g. `develop`), GitHub will
  **not** auto-close the issue on merge; close it manually with `close_issue` (or let
  `merge_pull_request` close it when it lands the base-branch merge). `create_pull_request`
  warns when the PR targets a non-default base.

## Build Phases

**Phase 1 — Core MCP server — ✓ Complete.** MCP server scaffolded; PAT auth (with `gh`
fallback) + owner/repo auto-detection; full tool surface below.

**Phase 2 — Bulk creation — ✓ Complete.** `create_issues_from_list` (and later `plan`)
create many issues + branches in one shot with two-step confirmation; per-task labels,
assignees, milestone, priority/effort/type.

**Phase 3 — Claude.ai bridge — Skipped (not required).** Natural-language task creation
already works well via Claude Code; no paste format needed.

**Phase 4 — Auto-close on merge — ✓ Complete.** `create_pull_request` + `commit_and_update`;
`Closes #N` drives native close on merge to the default branch. `OKFFS_AUTO_PR` opens a
**draft PR at branch-creation time** (via `create_issue`), not on close. Empty-branch edge
case posts a friendly comment instead of erroring — or, with `allow_empty: true`, pushes an
empty init commit and opens a draft tracking PR. `merge_pull_request` adds an opt-in,
heavily-gated autonomous merge of a green issue PR into the base branch.

**Phase 5 — GitHub Projects v2 — ✓ Complete.** Opt-in via `OKFFS_PROJECT_ENABLED`; org
board addressed by `OKFFS_PROJECT_ID` (GraphQL node ID). All board work is GraphQL
(Projects v2 has no REST API); field/option node IDs are discovered at runtime and
memoized, never hardcoded. Ships:
  - `update_project_status` — move an issue between `Backlog` / `Ready` / `In Progress` /
    `Review`. **`Done` is intentionally excluded** — owned by native GitHub automation on
    merge/close.
  - `create_issue` auto-add to the board + inferred `priority`/`effort`/`type` when
    `OKFFS_PROJECT_AUTO_ADD=true` (fallback for boards without native auto-add; non-fatal on
    failure).
  - `set_issue_fields` sets Priority/Effort and/or native Issue Type on an **existing** issue.
  - `list_issues` surfaces each issue's board column, Priority, and Issue Type, ordered by
    Priority.
  - Two field shapes are supported: project-native single-selects and org-level **Issue
    Fields** (Priority/Effort). Org Issue Fields need a **classic `admin:org` PAT** with
    `OKFFS_CLASSIC_PAT=true`; fine-grained PATs get FORBIDDEN and the path is skipped cleanly.
  - **Native GitHub Issue Types** (Task/Bug/Feature, plus Epic/Story if the org defines them)
    are inferred at creation (`OKFFS_INFER_TYPE`) and settable via `set_issue_fields`; org-level,
    skipped cleanly on user repos.

**Phase 6 — Project site — Planned (not started).** Stand up `okffs.g2mk.dev`
(pointing to Knowhost); static site pulling live data from the npm Registry API and GitHub
API (README, install command, version, download stats, stars, license); designed as a
reusable template for future `g2mk.dev` projects.

## Full tool surface

Registered in `src/index.ts` (**21 tools + 2 prompts**), descriptions from source:

| Tool | Description |
|------|-------------|
| `create_issue` | Create a GitHub issue and a matching branch. Infers labels (GitHub defaults), a board `priority`/`effort`, and a native Issue `type`, matching them against the board's/org's real options and falling back to the `OKFFS_DEFAULT_*` values. Calls `link_issues` when a relationship is mentioned. Returns issue URL, number, and branch name. |
| `list_issues` | List open issues, each with branch, any linked open/draft PR, board column, Priority, native Issue Type, and relationships (parent/children/blocked-by/blocking) as a tree. Ordered by Priority (Urgent → Low → unset). Replaces a separate PR-listing tool. |
| `get_issue` | Fetch full details of an issue by number — title, body, labels, assignees, branch, status. |
| `update_issue` | Mutate the **core fields** of an existing issue — `title`, `assignees`, `labels`, `milestone`, and/or `body` — via a single REST PATCH. Pass only what changes; `labels`/`assignees` **replace** the whole set (`[]` clears). Use instead of raw `gh issue edit`. |
| `set_issue_fields` | Set enumerated fields on an existing issue: board Priority and/or Effort (needs `OKFFS_PROJECT_ENABLED`), and/or the native Issue Type (org-level, board-independent). Fills the gap where `create_issue` only sets these at creation. |
| `comment_issue` | Post a comment to an issue. Use after committing to log what was done. |
| `link_issues` | Link two issues with `blocked_by`, `blocking`, or `parent`, stored in a `## Relationships` section of the issue body. |
| `close_issue` | Close an issue. Under `OKFFS_AUTO_PR`, an untouched auto-created draft PR (no real commits) is also closed and its branch deleted; a ready PR or real work is left untouched. |
| `delete_issue` | Close an issue and delete its matching branch. Destructive — requires `confirmed: true`; posts a comment before acting. |
| `delete_branch` | Delete a branch and close its matching issue. Destructive — requires `confirmed: true`; posts a comment before acting. |
| `create_issues_from_list` | Create multiple issues + branches from a task list; per-task inferred labels, priority/effort, and native Issue Type. Two-step confirmation. |
| `plan` | Break a free-text description into a structured list of issues (titles, descriptions, labels, priority/effort/type, task-index relationships) and create all issues + branches (+ draft PRs when `OKFFS_AUTO_PR=true`, + board placement when auto-add) in one shot. Two-step confirmation. |
| `commit_and_update` | Stage all changes, build a commit message from a hint (or the changed-file list), commit, push to the issue branch, and post a rich progress comment to the linked issue. |
| `create_pull_request` | Create a PR for the current issue branch; reads issue/comments/commits to generate title + body, always includes `Closes #N`. Updates+readies an existing draft PR. Writes changelog fragments + SECURITY.md when `OKFFS_UPDATE_DOCS=true`. `allow_empty: true` backfills a draft PR onto an empty branch. Adds a merge/tag reminder when targeting `OKFFS_PROTECTED_BRANCH`. |
| `merge_pull_request` | The **one okffs tool that merges**. Autonomously merges a green, review-resolved **issue PR into the base branch** using `OKFFS_BASE_MERGE_METHOD` (default squash), then comments and (when base isn't the repo default) closes the issue. **Opt-in + heavily gated:** does nothing unless `OKFFS_AUTO_MERGE_BASE=true`; never touches `OKFFS_PROTECTED_BRANCH` and refuses if it's unset; independently verifies all checks green + all threads resolved. |
| `promote_branch` | Open the **issue-less** release/promotion PR from one long-lived branch into another — e.g. `develop → main`. No `Closes #N`, no confirmation. Adds the PR to the board; requests `OKFFS_PROMOTION_REVIEWERS` (e.g. Copilot) on first creation when `OKFFS_PROMOTION_AUTO_REVIEW=true`. Opens and hands back — **never merges/tags**. Use instead of raw `gh pr create`. |
| `prepare_release` | Bump version (`package.json` + lockfile), roll the CHANGELOG (`[Unreleased]` → dated section + fresh `[Unreleased]` + updated compare links), assemble `.changes/unreleased/` fragments, commit on a `release/X.Y.Z` branch, and open a PR. Explicit `version`/`bump` or inferred. Two-step. Does **not** tag or publish. |
| `list_pr_review_comments` | Fetch a PR's review feedback: inline threads (comment ids, file/line, author, body, resolved state, thread ids) + overall review summaries. |
| `reply_to_review_comment` | Reply to an inline review comment thread by comment id (REST `in_reply_to`). |
| `resolve_review_thread` | Mark an inline review thread resolved (GraphQL). Gated by `OKFFS_RESOLVE_THREADS`; declines when not `true`. |
| `update_project_status` | Move an issue between board columns `Backlog` / `Ready` / `In Progress` / `Review`. `Done` excluded. Requires `OKFFS_PROJECT_ENABLED` and the issue already on the board. |

**Prompts (slash commands):**

| Prompt | Description |
|--------|-------------|
| `address_pr_review` | Read a PR's review comments, fix the valid ones, reply per thread, and post a summary — orchestrates `list_pr_review_comments` → fix → `commit_and_update` → `reply_to_review_comment` → `comment_issue` → optional `resolve_review_thread`. Handles the protected-head case (fixes route through a follow-up PR that must be merged before threads resolve). |
| `update_guidance` | Review the work done for an issue and maintain the okffs-owned `## Project Guidance (okffs usage)` section of CLAUDE.md (marker-delimited; never touches hand-written content). |

## Env vars — complete reference

Read in `src/config.ts` (plus the auth/repo vars from `src/github.ts`):

**Auth / repo (github.ts)**
- `GITHUB_TOKEN` — PAT; falls back to `gh auth token` when unset.
- `GITHUB_OWNER` / `GITHUB_REPO` — repo target; auto-detected from the `origin` remote when unset.

**Core defaults**
- `OKFFS_PROMPT_METADATA` — set `false` to silence the metadata tip (default on).
- `OKFFS_DEFAULT_ASSIGNEES` — comma-separated default assignees.
- `OKFFS_DEFAULT_LABELS` — comma-separated default labels (merged with AI-inferred labels).
- `OKFFS_DEFAULT_PRIORITY` / `OKFFS_DEFAULT_EFFORT` — board Priority/Effort applied when `create_issue` isn't given/can't infer one. Unset by default.
- `OKFFS_DEFAULT_TYPE` — native Issue Type applied when none is given/inferred (e.g. `Task`). Org-level, unset by default.
- `OKFFS_INFER_PRIORITY` / `OKFFS_INFER_EFFORT` / `OKFFS_INFER_TYPE` — default `true`; have Claude infer each field per new issue, falling back to the defaults. Set `false` to disable.
- `OKFFS_BASE_BRANCH` — branch new issue branches derive from (defaults to repo default branch).
- `OKFFS_PROTECTED_BRANCH` — a branch okffs must never autonomously **merge**/tag/publish into (e.g. `main`). Governs *merging*, not PR *creation* — okffs freely opens PRs targeting it. Unset by default.

**Identifier**
- `OKFFS_IDENTIFIER` — optional project-scoped prefix in branch names: `{number}-{identifier}-{slug}`.

**Auto-PR**
- `OKFFS_AUTO_PR` — set `true` to open a **draft PR at branch-creation time** (via `create_issue`).

**Merge methods & autonomous merge**
- `OKFFS_BASE_MERGE_METHOD` / `OKFFS_PROTECTED_MERGE_METHOD` — PR merge method per branch tier (`squash` / `merge` / `rebase`). Base defaults to `squash`, protected to `merge` — the *squash-into-develop, merge-commit-into-main* convention. **Config only** — records the method; does not grant merge permission.
- `OKFFS_AUTO_MERGE_BASE` — set `true` to let `merge_pull_request` autonomously merge a green, threads-resolved **issue PR into the base branch**. Default `false`; never merges `OKFFS_PROTECTED_BRANCH` and refuses when it's unset.

**Docs auto-update**
- `OKFFS_UPDATE_DOCS` — set `true` to auto-update local docs at PR/deletion time (see trigger logic below).
- `OKFFS_EXCLUDE_DOCS` — comma-separated filenames to exclude from auto-updates (valid: `CHANGELOG.md`, `SECURITY.md`).

**PR review workflow**
- `OKFFS_RESOLVE_THREADS` — set `true` to let okffs auto-resolve review threads after addressing (default: leave open).
- `OKFFS_UPDATE_GUIDANCE` — set `true` to nudge the agent to run `update_guidance` at PR time (prompt works regardless).

**Projects v2 (Phase 5)**
- `OKFFS_PROJECT_ENABLED` — set `true` to enable the integration (board column in `list_issues`; `update_project_status`, `set_issue_fields`). Zero overhead when unset.
- `OKFFS_PROJECT_ID` — the board's GraphQL node ID (e.g. `PVT_kwHO...`); required when enabled.
- `OKFFS_PROJECT_AUTO_ADD` — set `true` (fallback) to have `create_issue` add issues to the board when there's no native auto-add.
- `OKFFS_PROJECT_INITIAL_STATUS` — board Status column a freshly auto-added issue should land in (e.g. `Backlog`); applied after the draft PR so it wins over GitHub's linked-PR "In Progress" promotion.
- `OKFFS_CLASSIC_PAT` — set `true` only when `GITHUB_TOKEN` is a classic `admin:org` PAT, to enable org-level Issue Field Priority/Effort (#91). Default `false`; coarse-scope security tradeoff.

**Promotion gate (`promote_branch`)**
- `OKFFS_PROMOTION_STATUS` — optional board Status column the promotion PR card should land in (e.g. `Review`). Requires `OKFFS_PROJECT_ENABLED`.
- `OKFFS_PROMOTION_REVIEWERS` — comma-separated reviewers requested on the gate PR (e.g. `copilot-pull-request-reviewer[bot]`). Only acted on when auto-review is on.
- `OKFFS_PROMOTION_AUTO_REVIEW` — opt-in (default `false`) to auto-request `OKFFS_PROMOTION_REVIEWERS`, **only when the gate PR is first created**. ⚠️ Copilot review is billable per newly-created promotion PR.

## Doc auto-update trigger logic (when `OKFFS_UPDATE_DOCS=true`)

Auto-updates run through the `updateProjectDocs` helper (`src/docs.ts`), touching two files:
- **CHANGELOG.md** — via a per-issue **fragment** at `.changes/unreleased/{issue-number}-{slug}.md`
  (not a direct CHANGELOG.md edit). Uniquely-named fragments never collide, so parallel issue
  branches don't hit changelog conflicts; `prepare_release` assembles them into CHANGELOG.md and
  deletes them in the release commit. The `OKFFS_EXCLUDE_DOCS` key `CHANGELOG.md` suppresses the
  fragment.
- **SECURITY.md** — only on security-related changes, and only if the file already exists.
- **CLAUDE.md, CONTRIBUTING.md, and README.md are intentionally NOT auto-updated** (they
  previously got truncated changelog-style appends that duplicated CHANGELOG).

`updateProjectDocs` is invoked from **`create_pull_request`** (the primary path — it commits the
fragment onto the branch so it lands in the PR diff). `comment_issue` and `close_issue` do **not**
trigger doc updates. Failures are logged with an `[okffs]` prefix and never block the operation.

## Conventions

- Destructive tools require `confirmed: true` — call once for a warning, re-call to proceed;
  they post a comment to the issue before acting.
- Bulk/`plan`/`prepare_release` tools use two-step confirmation (preview, then `confirmed: true`).
- **GitHub is the source of truth** for issue state — never local.
- Keep the tool surface minimal — do one thing well per tool.
- AI-inferred labels are merged with `OKFFS_DEFAULT_LABELS`; `update_issue`/`set_issue_fields`
  **replace** their fields.
- **Never merge/tag/publish into `OKFFS_PROTECTED_BRANCH` autonomously** — okffs may open a PR
  into it, but hands the merge back. `merge_pull_request` is the only merging tool, and only for
  the base tier when opted in.
- Branch naming: `{issue-number}-{kebab-title-slug}` (`+identifier` when `OKFFS_IDENTIFIER` set).
- `dotenv` auto-loads from `process.cwd()` — no hardcoded `--env-file` path.
- Local dev `.mcp.json` uses `node dist/index.js`; consumer repos use `npx @neturely/okffs@latest`.
  New tools don't appear in consumer repos until a new version is published to npm.
- Release flow: `develop` → `main` via **merge commit** (never squash); `prepare_release` opens
  the release PR; tag `vX.Y.Z` after merge triggers the CI npm + MCP Registry publish. okffs does
  not tag/publish itself.

## Recent infrastructure changes

- **Org migration** — project moved to the **`neturely`** GitHub org (repo, homepage, and
  doc links updated from the old `2b9sa2owa` org).
- **npm scope change** — package renamed from unscoped `okffs` to **`@neturely/okffs`**
  (published publicly via `publishConfig.access`); the old unscoped package is deprecated.
- **MCP Registry** — published as `io.github.neturely/okffs` (`server.json` +
  `package.json` for package-ownership verification).
- **Publish workflow hardening** — a `vX.Y.Z` tag auto-publishes to **both** npm and the
  MCP Registry via GitHub OIDC (no stored registry token); prerelease-safe npm dist-tag
  (prerelease → `next`, stable → `latest`) plus a verify-only job.

---

## Changes from the previous brief (0.3.0 → 0.7.0)

- **Version** bumped 0.3.0 → **0.7.0** throughout.
- **Tool surface grew from 17 → 21 tools:** added `merge_pull_request` (the sole, gated,
  autonomous base-branch merge), `promote_branch` (issue-less `develop → main` gate PR),
  `set_issue_fields` (Priority/Effort/Type on an existing issue), and `update_issue`
  (core-field edits on an existing issue). Prompts unchanged (`address_pr_review`,
  `update_guidance`).
- **Native GitHub Issue Types** added — inferred at creation, settable via `set_issue_fields`,
  surfaced in `list_issues`.
- **Per-tier merge methods** (`OKFFS_BASE_MERGE_METHOD` / `OKFFS_PROTECTED_MERGE_METHOD`) and the
  **opt-in autonomous base merge** (`OKFFS_AUTO_MERGE_BASE`) added.
- **`OKFFS_PROTECTED_BRANCH`** documented as the never-autonomously-merge invariant.
- **Changelog handling rewritten** — `OKFFS_UPDATE_DOCS` now writes per-issue **fragments** under
  `.changes/unreleased/` (assembled by `prepare_release`), not direct CHANGELOG.md edits; the
  destructive-tool doc-update trigger was dropped (`create_pull_request` is now the path).
- **Projects v2 expanded** — `OKFFS_PROJECT_INITIAL_STATUS`, `OKFFS_CLASSIC_PAT` for org Issue
  Fields, inference toggles (`OKFFS_INFER_*`), defaults (`OKFFS_DEFAULT_PRIORITY/EFFORT/TYPE`),
  and the promotion-gate env group (`OKFFS_PROMOTION_STATUS/REVIEWERS/AUTO_REVIEW`).
- **`create_pull_request`** now supports `allow_empty` (backfill a draft PR onto an empty branch)
  and backfills the **Branch:** link for pre-okffs issues.
