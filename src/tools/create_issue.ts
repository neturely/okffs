import { execSync } from "node:child_process";
import { z } from "zod";
import { createIssue, updateIssueBody, getDefaultBranch, getRef, createBranch, slugify, createDraftPullRequest } from "../github.js";
import { config } from "../config.js";

export const name = "create_issue";

export const description =
  "Create a GitHub issue and automatically create a matching branch. Before calling this tool, infer appropriate labels from the issue title and description using GitHub's default labels: bug, documentation, duplicate, enhancement, good first issue, help wanted, invalid, question, wontfix. Pass the inferred labels in the labels parameter unless the user has specified their own. If the user mentions that this issue is blocked by, blocking, or a child of another issue, call link_issues after creating this issue to set the relationship. Returns the issue URL, issue number, and branch name.";

export const inputSchema = z.object({
  title: z.string().describe("Issue title"),
  description: z.string().describe("Issue body / description"),
  assignees: z.array(z.string()).optional().describe("GitHub usernames to assign"),
  labels: z.array(z.string()).optional().describe("Labels to apply e.g. bug, feature"),
  milestone: z.number().int().optional().describe("Milestone number to assign"),
});

export async function handler(input: z.infer<typeof inputSchema>) {
  const resolvedAssignees = input.assignees ?? config.defaultAssignees;
  const resolvedLabels = [
    ...new Set([...(input.labels ?? []), ...config.defaultLabels])
  ];

  const issue = await createIssue(input.title, input.description, resolvedAssignees, resolvedLabels, input.milestone);

  const branchName = `${issue.number}-${slugify(input.title)}`;

  const defaultBranch = await getDefaultBranch();
  const ref = await getRef(defaultBranch);
  await createBranch(branchName, ref.object.sha);

  const updatedBody = `${input.description}\n\n**Branch:** \`${branchName}\``;
  await updateIssueBody(issue.number, updatedBody);

  // Push an empty init commit so the branch diverges from base,
  // allowing GitHub to accept a draft PR immediately.
  try {
    const previousBranch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8" }).trim();
    execSync(`git fetch origin`, { stdio: "ignore" });
    execSync(`git checkout ${branchName}`, { stdio: "ignore" });
    execSync(`git commit --allow-empty -m "chore: init branch for #${issue.number}"`, { stdio: "ignore" });
    execSync(`git push origin ${branchName}`, { stdio: "ignore" });
    if (previousBranch && previousBranch !== branchName) {
      execSync(`git checkout ${previousBranch}`, { stdio: "ignore" });
    }
  } catch (err) {
    console.warn("[okffs] Failed to push init commit:", err instanceof Error ? err.message : err);
  }

  let draftPRUrl: string | null = null;
  if (config.autoPR) {
    try {
      const baseBranch = defaultBranch;
      const pr = await createDraftPullRequest(
        `WIP: #${issue.number} - ${input.title}`,
        `Closes #${issue.number}`,
        branchName,
        baseBranch
      );
      draftPRUrl = pr.html_url;
    } catch (err) {
      console.warn("[okffs] Failed to create draft PR:", err instanceof Error ? err.message : err);
    }
  }

  const lines = [
    `Issue #${issue.number} created: ${issue.html_url}`,
    `Branch: \`${branchName}\``,
  ];

  if (draftPRUrl) {
    lines.push(`Draft PR: ${draftPRUrl}`);
  }

  if (resolvedAssignees.length > 0) {
    const source = input.assignees ? "" : " (default)";
    lines.push(`Assignees: ${resolvedAssignees.join(", ")}${source}`);
  }

  if (resolvedLabels.length > 0) {
    const source = input.labels ? "" : " (default)";
    lines.push(`Labels: ${resolvedLabels.join(", ")}${source}`);
  }

  lines.push(
    ``,
    `To start work:`,
    `  git fetch origin`,
    `  git checkout ${branchName}`,
  );

  if (config.promptForMetadata && !input.assignees && !input.labels) {
    lines.push(
      ``,
      `Tip: You can include assignees and labels next time:`,
      `  assignees: ["your-github-username"]`,
      `  labels: ["feature", "bug"]`,
      `Or set OKFFS_PROMPT_METADATA=false in .env to hide this tip.`
    );
  }

  return {
    content: [{ type: "text" as const, text: lines.join("\n") }],
  };
}
