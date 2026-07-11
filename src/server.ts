// The MCP server. Split out of index.ts so the CLI entrypoint can dispatch
// `okffs setup` WITHOUT importing this file — importing it pulls in the tool
// chain (→ github.ts), which resolves the token/owner/repo at import time and
// throws when unconfigured, which is exactly the state `okffs setup` runs in.
// index.ts only dynamically imports this module for a bare (no-arg) invocation,
// so the MCP server's behaviour is unchanged.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "zod-to-json-schema";

import * as createIssue from "./tools/create_issue.js";
import * as listIssues from "./tools/list_issues.js";
import * as closeIssue from "./tools/close_issue.js";
import * as deleteIssue from "./tools/delete_issue.js";
import * as deleteBranch from "./tools/delete_branch.js";
import * as getIssue from "./tools/get_issue.js";
import * as commentIssue from "./tools/comment_issue.js";
import * as createIssuesFromList from "./tools/create_issues_from_list.js";
import * as plan from "./tools/plan.js";
import * as linkIssues from "./tools/link_issues.js";
import * as createPullRequest from "./tools/create_pull_request.js";
import * as commitAndUpdate from "./tools/commit_and_update.js";
import * as listPrReviewComments from "./tools/list_pr_review_comments.js";
import * as replyToReviewComment from "./tools/reply_to_review_comment.js";
import * as resolveReviewThread from "./tools/resolve_review_thread.js";
import * as prepareRelease from "./tools/prepare_release.js";
import * as updateProjectStatus from "./tools/update_project_status.js";
import * as setIssueFields from "./tools/set_issue_fields.js";
import * as updateIssue from "./tools/update_issue.js";
import * as promoteBranch from "./tools/promote_branch.js";
import * as mergePullRequest from "./tools/merge_pull_request.js";
import * as fixIntoBase from "./tools/fix_into_base.js";
import * as configure from "./tools/configure.js";

import * as addressPrReview from "./prompts/address_pr_review.js";
import * as updateGuidance from "./prompts/update_guidance.js";
import * as setupPrompt from "./prompts/setup.js";

import { parseEnv } from "./cli/env.js";
import { allKeys } from "./cli/manifest.js";

const tools = [createIssue, listIssues, closeIssue, deleteIssue, deleteBranch, getIssue, commentIssue, createIssuesFromList, plan, linkIssues, createPullRequest, commitAndUpdate, listPrReviewComments, replyToReviewComment, resolveReviewThread, prepareRelease, updateProjectStatus, setIssueFields, updateIssue, promoteBranch, mergePullRequest, fixIntoBase, configure];

const prompts = [addressPrReview, updateGuidance, setupPrompt];

// Read the package version so the server reports the real version (dist/server.js
// lives one level below package.json in both dev and the published package).
const version = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
).version;

// Server-level instructions: the MCP `initialize` result carries this string and
// hosts (Claude Code, etc.) surface it to the agent every session. It ships with
// the package version, so upgrading okffs automatically updates the guidance the
// agent sees — this is how new tools/behaviour get adopted instead of the agent
// defaulting to raw git/gh (#169). Keep it tight: it's always-on context. This is
// the machine-visible counterpart to the human-facing README/CLAUDE.md guidance.
const SERVER_INSTRUCTIONS = `okffs owns the GitHub issue → branch → PR → merge → close workflow (plus, when enabled, a GitHub Projects v2 board and releases).

ALWAYS reach for an okffs tool before raw git/gh/GraphQL when one covers the action — this is a correctness rule, not a style preference:
- Identity/permissions: okffs authenticates with the configured GITHUB_TOKEN (a PAT scoped for this repo, incl. Projects / org Issue Fields when set). Raw gh/git uses whatever ambient CLI token is signed in — often the wrong identity or missing the Projects/org scopes, so it fails or acts as the wrong user.
- Conventions: okffs applies branch naming ({issue}-{slug}), the **Branch:** issue link, Closes #N, board placement, changelog fragments, and the OKFFS_PROTECTED_BRANCH invariant. Hand-rolled gh/git silently skips all of that.
Fall back to raw git/gh ONLY when no okffs tool fits the action.

Common action → tool:
- Start work: create_issue (creates the issue, the linked branch, and the **Branch:** line that create_pull_request/commit_and_update rely on). Many at once: create_issues_from_list or plan.
- Progress: commit_and_update (stage + commit + push + issue comment) — prefer over raw git commit/push.
- Open/finalize an issue's PR (into the base branch): create_pull_request (always adds Closes #N).
- Promotion/release gate — a base→protected PR with no issue, e.g. develop→main: promote_branch (issue-less; adds the PR to the board; NEVER use raw \`gh pr create\` for this).
- Edit an existing issue's core fields (title, assignees, labels, milestone, body): update_issue — prefer over raw \`gh issue edit\`. (Board Priority/Effort is set_issue_fields; Status column is update_project_status — those aren't issue fields.)
- Board: create_issue sets an inferred priority/effort at creation; set them on an EXISTING issue with set_issue_fields; move columns with update_project_status (Backlog/Ready/In Progress/Review — Done is GitHub's own automation).
- PR review: list_pr_review_comments → fix → reply_to_review_comment → resolve_review_thread (honours OKFFS_RESOLVE_THREADS); or the /okffs:address_pr_review prompt.
- Release prep: prepare_release (bumps version + rolls the changelog; does NOT tag or publish).
- Land an issue PR into the BASE branch (e.g. develop): merge_pull_request — the one okffs action that merges. Opt-in (OKFFS_AUTO_MERGE_BASE=true) and heavily gated; it verifies checks/threads itself and NEVER touches OKFFS_PROTECTED_BRANCH. Off by default → it just declines.
- Land an ISSUE-LESS fix into the BASE branch (no issue, e.g. review-comment cleanups): fix_into_base — the mirror of promote_branch. Opens (always safe) then merges under the same OKFFS_AUTO_MERGE_BASE gating as merge_pull_request. Prefer over raw \`gh pr create\`/\`gh pr merge\`; never targets OKFFS_PROTECTED_BRANCH.

Setup/config: if the user needs to configure okffs — a missing token/repo, or turning on a feature like Projects — point them to \`npx @neturely/okffs setup\`, a guided wizard that writes/updates .env (preserving their own vars and comments). It is interactive, so it must be run in their own terminal, not via a tool or the \`!\` shell.

Rules: never merge, tag, or publish into OKFFS_PROTECTED_BRANCH autonomously — okffs may OPEN a PR into it (promote_branch), but the merge/tag are yours to hand back for. merge_pull_request only ever lands PRs into the base tier, never the protected branch. Destructive tools (delete_issue, delete_branch) require confirmed: true (call once to preview, again to act).`;

// Compare two dotted versions; >0 if a is newer than b. Prerelease suffixes are
// ignored (split on `.`/`-`), which is fine for the coarse "did we upgrade?" check.
function isNewer(a: string, b: string): boolean {
  const pa = a.split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  const pb = b.split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

// Upgrade nudge (#242): if this repo's .env was configured by an older okffs (or
// predates version stamping) AND this okffs version has config options not set
// here, append a one-time-per-session note so the agent can OFFER /okffs:setup.
// Gentle by construction — it lands in the always-on instructions read on connect,
// not a per-turn interruption, and self-resolves once the user runs setup (which
// stamps the current version and marks the new options known/declined).
function upgradeNudge(): string {
  try {
    const parsed = parseEnv(join(process.cwd(), ".env"));
    if (!parsed.exists) return "";
    const stamp = parsed.configuredVersion;
    const configuredCount = allKeys().filter((k) => parsed.known.has(k)).length;
    // Only for repos that actually use okffs config (a stamp, or some okffs vars);
    // don't pester a .env that just isn't an okffs-configured repo.
    if (!stamp && configuredCount === 0) return "";
    // Only when this okffs is newer than what configured the .env (or the .env
    // predates stamping — stamp === null).
    if (stamp && !isNewer(version, stamp)) return "";
    const newKeys = allKeys().filter((k) => !parsed.known.has(k));
    if (newKeys.length === 0) return "";
    const from = stamp ? `from ${stamp} ` : "";
    return `\n\nUPGRADE NUDGE: this repo's .env was configured ${from}with an older okffs; okffs ${version} has ${newKeys.length} config option(s) not set here. Once, offer to run the /okffs:setup prompt (sync) to review the new options — if the user declines, drop it, don't repeat.`;
  } catch {
    return "";
  }
}

export async function startServer(): Promise<void> {
  const server = new Server(
    { name: "okffs", version },
    { capabilities: { tools: {}, prompts: {} }, instructions: SERVER_INSTRUCTIONS + upgradeNudge() }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    // A tool may export an async getDescription() to compute its description at
    // list time (e.g. create_issue injects the board's real Priority/Effort options
    // — #133). Fall back to the static description on absence or failure.
    tools: await Promise.all(
      tools.map(async (t) => {
        let description = t.description;
        const getDescription = (t as { getDescription?: () => Promise<string> }).getDescription;
        if (getDescription) {
          try {
            description = await getDescription();
          } catch (err) {
            console.warn(`[okffs] getDescription() failed for ${t.name}, using static description:`, err instanceof Error ? err.message : err);
          }
        }
        return {
          name: t.name,
          description,
          inputSchema: zodToJsonSchema(t.inputSchema),
        };
      })
    ),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = tools.find((t) => t.name === req.params.name);
    if (!tool) {
      throw new Error(`Unknown tool: ${req.params.name}`);
    }
    const input = tool.inputSchema.parse(req.params.arguments);
    return tool.handler(input as never);
  });

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: prompts.map((p) => ({
      name: p.name,
      description: p.description,
      arguments: p.argumentDefs,
    })),
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (req) => {
    const prompt = prompts.find((p) => p.name === req.params.name);
    if (!prompt) {
      throw new Error(`Unknown prompt: ${req.params.name}`);
    }
    return prompt.build(req.params.arguments ?? {});
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
