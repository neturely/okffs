import { z } from "zod";
import { closeIssue, getIssue, addIssueComment, extractBranchFromBody, owner, repo } from "../github.js";
import { config } from "../config.js";

export const name = "close_issue";

export const description = "Close a GitHub issue by issue number.";

export const inputSchema = z.object({
  issue_number: z.number().int().positive().describe("The issue number to close"),
});

export async function handler(input: z.infer<typeof inputSchema>) {
  const issue = await getIssue(input.issue_number);
  const branchName = extractBranchFromBody(issue.body);

  await closeIssue(input.issue_number);

  if (branchName && !config.autoPR) {
    const comment = [
      `Issue closed. Branch \`${branchName}\` remains open — https://github.com/${owner}/${repo}/tree/${branchName}`,
      ``,
      `No action has been taken on the branch.`,
    ].join("\n");
    await addIssueComment(input.issue_number, comment);
  }

  // Closing no longer triggers a CHANGELOG update. create_pull_request is the
  // single source of auto-changelog entries — firing here too produced
  // duplicates (the PR already logged the change).

  return {
    content: [{ type: "text" as const, text: `Issue #${input.issue_number} closed.\n\n💡 Tip: run /clear to reset Claude Code context and save tokens before starting the next issue.` }],
  };
}
