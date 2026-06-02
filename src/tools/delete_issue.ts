import { z } from "zod";
import { getIssue, addIssueComment, closeIssue, deleteBranch, extractBranchFromBody } from "../github.js";

export const name = "delete_issue";

export const description =
  "Close a GitHub issue and delete its matching branch. Destructive — requires confirmed: true.";

export const inputSchema = z.object({
  issue_number: z.number().int().positive().describe("The issue number to close and whose branch to delete"),
  confirmed: z.boolean().optional().describe("Must be true to proceed with the destructive action"),
});

export async function handler(input: z.infer<typeof inputSchema>) {
  const issue = await getIssue(input.issue_number);
  const branchName = extractBranchFromBody(issue.body);

  if (!input.confirmed) {
    const branchNote = branchName ? `and delete branch \`${branchName}\`` : "(no branch found in issue body)";
    return {
      content: [{
        type: "text" as const,
        text: `⚠️  This will close issue #${input.issue_number} ${branchNote}.\nRe-call delete_issue with confirmed: true to proceed.`,
      }],
    };
  }

  if (branchName) {
    await addIssueComment(input.issue_number, `Issue closed and branch \`${branchName}\` deleted via okffs.`);
  }
  await closeIssue(input.issue_number);
  if (branchName) {
    await deleteBranch(branchName);
  }

  const lines = [`Issue #${input.issue_number} closed.`];
  if (branchName) lines.push(`Branch \`${branchName}\` deleted.`);

  return {
    content: [{ type: "text" as const, text: lines.join("\n") }],
  };
}
