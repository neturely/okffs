import { execSync } from "node:child_process";
import { z } from "zod";
import { addIssueComment, getIssue, extractBranchFromBody } from "../github.js";

export const name = "commit_and_update";
export const description =
  "Stage all changes, generate a conventional commit message from the diff, commit, push to the current branch, and post a rich progress comment to the linked issue.";

export const inputSchema = z.object({
  issue_number: z.number().int().positive().describe("The issue number this work is against"),
  hint: z.string().optional().describe("Short description of what was done — used to generate the commit message and issue comment"),
});

export async function handler(input: z.infer<typeof inputSchema>) {
  const issue = await getIssue(input.issue_number);
  const branchName = extractBranchFromBody(issue.body);

  // Get diff — staged first, fall back to unstaged
  let diff = "";
  try {
    diff = execSync("git diff --staged", { encoding: "utf8" });
    if (!diff.trim()) {
      diff = execSync("git diff", { encoding: "utf8" });
    }
  } catch {
    diff = "";
  }

  // Derive a short conventional commit message from hint + diff file list
  const changedFiles = (() => {
    try {
      return execSync("git diff --name-only HEAD", { encoding: "utf8" })
        .trim()
        .split("\n")
        .filter(Boolean);
    } catch {
      return [];
    }
  })();

  const hintText = input.hint ?? "";
  const filesText = changedFiles.length > 0 ? changedFiles.join(", ") : "various files";

  // Build commit message — short conventional format
  const commitMessage = hintText
    ? `${hintText.slice(0, 72)}`
    : `chore: update ${filesText.slice(0, 60)}`;

  // Stage, commit, push
  let commitHash = "";
  try {
    execSync("git add -A", { stdio: "ignore" });
    execSync(`git commit -m "${commitMessage.replace(/"/g, "'")}"`, { stdio: "ignore" });
    if (branchName) {
      execSync(`git push origin ${branchName}`, { stdio: "ignore" });
    }
    commitHash = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text" as const, text: `commit_and_update failed: ${msg}` }],
    };
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
