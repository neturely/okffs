import { z } from "zod";
import { addIssueComment, deleteBranch, closeIssue } from "../github.js";
import { config } from "../config.js";
import { updateProjectDocs } from "../docs.js";

export const name = "delete_branch";

export const description =
  "Delete a branch and close its matching GitHub issue. Destructive — requires confirmed: true.";

export const inputSchema = z.object({
  branch_name: z.string().describe("The branch name to delete (e.g. 42-add-hero-section)"),
  confirmed: z.boolean().optional().describe("Must be true to proceed with the destructive action"),
});

export async function handler(input: z.infer<typeof inputSchema>) {
  const issueNumber = parseInt(input.branch_name.split("-")[0], 10);

  if (!input.confirmed) {
    return {
      content: [{
        type: "text" as const,
        text: `⚠️  This will delete branch \`${input.branch_name}\` and close issue #${issueNumber}.\nRe-call delete_branch with confirmed: true to proceed.`,
      }],
    };
  }

  await addIssueComment(
    issueNumber,
    `Branch \`${input.branch_name}\` was deleted. No working branch remains for this issue. Issue closed via okffs.`
  );
  await deleteBranch(input.branch_name);
  await closeIssue(issueNumber);

  if (config.updateDocs) {
    await updateProjectDocs({
      trigger: "delete_branch",
      issueNumber: issueNumber,
      summary: `Branch \`${input.branch_name}\` deleted and issue #${issueNumber} closed.`,
      branchName: input.branch_name,
    });
  }

  return {
    content: [{
      type: "text" as const,
      text: `Branch \`${input.branch_name}\` deleted.\nIssue #${issueNumber} closed.`,
    }],
  };
}
