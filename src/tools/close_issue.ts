import { z } from "zod";
import { closeIssue, getIssue, addIssueComment, extractBranchFromBody, owner, repo } from "../github.js";

export const name = "close_issue";

export const description = "Close a GitHub issue by issue number.";

export const inputSchema = z.object({
  issue_number: z.number().int().positive().describe("The issue number to close"),
});

export async function handler(input: z.infer<typeof inputSchema>) {
  const issue = await getIssue(input.issue_number);
  const branchName = extractBranchFromBody(issue.body);

  await closeIssue(input.issue_number);

  if (branchName) {
    const comment = [
      `Issue closed. Branch \`${branchName}\` remains open — https://github.com/${owner}/${repo}/tree/${branchName}`,
      ``,
      `No action has been taken on the branch.`,
    ].join("\n");
    await addIssueComment(input.issue_number, comment);
  }

  return {
    content: [{ type: "text" as const, text: `Issue #${input.issue_number} closed.` }],
  };
}
