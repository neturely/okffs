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

import * as addressPrReview from "./prompts/address_pr_review.js";
import * as updateGuidance from "./prompts/update_guidance.js";

const tools = [createIssue, listIssues, closeIssue, deleteIssue, deleteBranch, getIssue, commentIssue, createIssuesFromList, plan, linkIssues, createPullRequest, commitAndUpdate, listPrReviewComments, replyToReviewComment, resolveReviewThread, prepareRelease, updateProjectStatus];

const prompts = [addressPrReview, updateGuidance];

// Read the package version so the server reports the real version (dist/index.js
// lives one level below package.json in both dev and the published package).
const version = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
).version;

const server = new Server(
  { name: "okffs", version },
  { capabilities: { tools: {}, prompts: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: zodToJsonSchema(t.inputSchema),
  })),
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
