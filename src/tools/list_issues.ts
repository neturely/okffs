import { z } from "zod";
import { listIssues, buildBranchName } from "../github.js";

const owner = process.env.GITHUB_OWNER;
const repo = process.env.GITHUB_REPO;

export const name = "list_issues";

export const description = "List all open GitHub issues for the configured repository.";

export const inputSchema = z.object({});

export async function handler(_input: z.infer<typeof inputSchema>) {
  const issues = await listIssues();

  if (issues.length === 0) {
    return {
      content: [{ type: "text" as const, text: "No open issues." }],
    };
  }

  const lines = issues.map((i) => {
    const branch = buildBranchName(i.number, i.title);
    const branchUrl = `https://github.com/${owner}/${repo}/tree/${branch}`;
    return `#${i.number}  ${i.title}\n    issue:  ${i.html_url}\n    branch: ${branchUrl}`;
  });

  return {
    content: [{ type: "text" as const, text: lines.join("\n\n") }],
  };
}
