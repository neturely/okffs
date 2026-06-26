import { z } from "zod";
import { closeIssue, getIssue, addIssueComment, extractBranchFromBody, owner, repo } from "../github.js";
import { config } from "../config.js";
import { updateProjectDocs } from "../docs.js";

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

  // In the auto-PR flow, create_pull_request already updates and commits the
  // CHANGELOG for this issue — skip here to avoid duplicate entries.
  if (config.updateDocs && !config.autoPR) {
    await updateProjectDocs({
      trigger: "close_issue",
      issueNumber: input.issue_number,
      issueTitle: issue.title,
      summary: issue.body
        ? issue.body
            .replace(/\*\*Branch:\*\*\s*`[^`]+`/g, "")
            .replace(/## Relationships[\s\S]*/g, "")
            .trim()
            .slice(0, 200)
        : issue.title,
      branchName: branchName ?? undefined,
    });
  }

  return {
    content: [{ type: "text" as const, text: `Issue #${input.issue_number} closed.\n\n💡 Tip: run /clear to reset Claude Code context and save tokens before starting the next issue.` }],
  };
}
