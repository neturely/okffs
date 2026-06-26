import { z } from "zod";
import { addIssueComment, getIssue, extractBranchFromBody } from "../github.js";
import { git, gitOutput, currentBranch } from "../git.js";

export const name = "commit_and_update";
export const description =
  "Stage all changes, build a commit message from the provided hint (or the changed file list), commit, push to the issue branch, and post a rich progress comment to the linked issue.";

export const inputSchema = z.object({
  issue_number: z.number().int().positive().describe("The issue number this work is against"),
  hint: z.string().optional().describe("Short description of what was done — used to build the commit message and issue comment"),
});

export async function handler(input: z.infer<typeof inputSchema>) {
  const issue = await getIssue(input.issue_number);
  const branchName = extractBranchFromBody(issue.body);

  // Files changed relative to HEAD — used for the commit message and comment.
  let changedFiles: string[] = [];
  try {
    changedFiles = gitOutput(["diff", "--name-only", "HEAD"]).split("\n").filter(Boolean);
  } catch {
    changedFiles = [];
  }

  const hintText = input.hint ?? "";
  const filesText = changedFiles.length > 0 ? changedFiles.join(", ") : "various files";

  // Build the commit message from the hint when provided, else the file list.
  const commitMessage = hintText
    ? hintText.slice(0, 72)
    : `chore: update ${filesText.slice(0, 60)}`;

  // Stage, commit, and push on the issue branch. Arguments are passed as an
  // array (no shell), so the hint and branch name can't be interpreted as
  // shell commands. The caller's original branch is restored afterward.
  const previousBranch = currentBranch();
  let commitHash = "";
  try {
    if (branchName && previousBranch !== branchName) {
      git(["checkout", branchName]);
    }
    git(["add", "-A"]);
    git(["commit", "-m", commitMessage]);
    if (branchName) {
      git(["push", "origin", branchName]);
    }
    commitHash = gitOutput(["rev-parse", "--short", "HEAD"]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text" as const, text: `commit_and_update failed: ${msg}` }],
    };
  } finally {
    if (branchName && previousBranch && previousBranch !== branchName) {
      try {
        git(["checkout", previousBranch]);
      } catch (err) {
        console.warn("[okffs] Failed to restore branch:", err instanceof Error ? err.message : err);
      }
    }
  }

  // Post rich comment to issue
  const timestamp = new Date().toISOString();
  const filesSection = changedFiles.length > 0
    ? changedFiles.map((f) => `- \`${f}\``).join("\n")
    : "- No files detected";

  const comment = [
    `### 🔧 Commit update`,
    ``,
    `**Commit:** \`${commitHash}\``,
    `**Message:** ${commitMessage}`,
    `**Time:** ${timestamp}`,
    ``,
    `**Files changed:**`,
    filesSection,
    hintText ? `\n**Summary:** ${hintText}` : "",
  ].filter((l) => l !== undefined).join("\n");

  await addIssueComment(input.issue_number, comment);

  return {
    content: [{ type: "text" as const, text: `Committed \`${commitHash}\` and updated issue #${input.issue_number}.` }],
  };
}
