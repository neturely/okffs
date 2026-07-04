#!/usr/bin/env node
import "dotenv/config";
import { readFileSync } from "node:fs";

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

import * as addressPrReview from "./prompts/address_pr_review.js";
import * as updateGuidance from "./prompts/update_guidance.js";

const tools = [createIssue, listIssues, closeIssue, deleteIssue, deleteBranch, getIssue, commentIssue, createIssuesFromList, plan, linkIssues, createPullRequest, commitAndUpdate, listPrReviewComments, replyToReviewComment, resolveReviewThread, prepareRelease, updateProjectStatus, setIssueFields];

const prompts = [addressPrReview, updateGuidance];

// Read the package version so the server reports the real version (dist/index.js
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
const SERVER_INSTRUCTIONS = `okffs owns the GitHub issue → branch → PR → merge → close workflow (plus, when enabled, a GitHub Projects v2 board and releases). Prefer okffs tools for these actions over raw git/gh/GraphQL: okffs authenticates with GITHUB_TOKEN (use a classic PAT here if org-level Issue Fields are involved) before falling back to the gh CLI, and honours its OKFFS_* env toggles — so hand-rolling git/gh often uses the wrong token or skips okffs conventions.

Common action → tool:
- Start work: create_issue (also creates the linked branch and writes the **Branch:** line that create_pull_request/commit_and_update rely on). Many at once: create_issues_from_list or plan.
- Progress: commit_and_update (stage + commit + push + issue comment). Open/finalize a PR: create_pull_request (always adds Closes #N).
- Board: create_issue sets an inferred priority/effort at creation; set them on an EXISTING issue with set_issue_fields; move columns with update_project_status (Backlog/Ready/In Progress/Review — Done is GitHub's own automation).
- PR review: list_pr_review_comments → fix → reply_to_review_comment → resolve_review_thread (honours OKFFS_RESOLVE_THREADS); or the /okffs:address_pr_review prompt.
- Release: prepare_release (it does NOT tag or publish).

Rules: never merge, tag, or publish into OKFFS_PROTECTED_BRANCH autonomously — hand back to the user for sign-off. Destructive tools (delete_issue, delete_branch) require confirmed: true (call once to preview, again to act).`;

const server = new Server(
  { name: "okffs", version },
  { capabilities: { tools: {}, prompts: {} }, instructions: SERVER_INSTRUCTIONS }
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
