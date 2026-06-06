import "dotenv/config";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
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

const tools = [createIssue, listIssues, closeIssue, deleteIssue, deleteBranch, getIssue, commentIssue, createIssuesFromList];

const server = new Server(
  { name: "okffs", version: "0.0.1" },
  { capabilities: { tools: {} } }
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

const transport = new StdioServerTransport();
await server.connect(transport);
