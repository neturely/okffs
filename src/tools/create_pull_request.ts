import { execSync } from "node:child_process";
import { z } from "zod";
import {
  getIssue,
  extractBranchFromBody,
  getDefaultBranch,
  getBranchCommits,
  getIssueComments,
  createPullRequest,
  addIssueComment,
} from "../github.js";
import { config } from "../config.js";
import { updateProjectDocs } from "../docs.js";

export const name = "create_pull_request";

export const description =
  "Create a pull request for the current issue branch. Reads the issue, its comments, and commits to generate a PR title and body. Always includes Closes #N. If OKFFS_UPDATE_DOCS is true, updates CHANGELOG before creating the PR. Posts a summary comment to the issue.";

export const inputSchema = z.object({
  issue_number: z.number().int().positive().describe("The issue number to create a PR for"),
  summary: z.string().optional().describe("Optional summary of what was done — used in PR body and issue comment"),
});

export async function handler(input: z.infer<typeof inputSchema>) {
  const issue = await getIssue(input.issue_number);
  const branchName = extractBranchFromBody(issue.body);

  if (!branchName) {
    await addIssueComment(
      input.issue_number,
      `PR not created — issue #${input.issue_number} has no associated branch. Add a **Branch:** line to the issue body first.`
    );
    return {
      content: [{ type: "text" as const, text: `Issue #${input.issue_number} has no associated branch.` }],
    };
  }

  const baseBranch = await getDefaultBranch();
  const commits = await getBranchCommits(branchName, baseBranch);
  const comments = await getIssueComments(input.issue_number);

  if (commits.length === 0) {
    await addIssueComment(
      input.issue_number,
      `PR not created — branch \`${branchName}\` has no commits ahead of \`${baseBranch}\`. Push commits to the branch first, then create the PR.`
    );
    return {
      content: [{ type: "text" as const, text: `PR not created — branch \`${branchName}\` has no commits ahead of \`${baseBranch}\`. Push commits first.` }],
    };
  }

  const title = `Close #${input.issue_number} - ${issue.title}`;

  const cleanedDescription = issue.body
    ? issue.body
        .replace(/\*\*Branch:\*\*\s*`[^`]+`/g, "")
        .replace(/## Relationships[\s\S]*/g, "")
        .trim()
    : issue.title;

  const summarySection = input.summary ?? cleanedDescription;

  const changesSection = commits.length > 0
    ? commits.map((c) => `- ${c.commit.message.split("\n")[0]}`).join("\n")
    : "- No commits found";

  const recentComments = comments.slice(0, 3).reverse();
  const commentsSection = recentComments.length > 0
    ? recentComments
        .map((c) => `\n\`\`\`\n${c.body}\n\`\`\`\n`)
        .join("\n\n---\n\n")
    : null;

  const bodyParts = [
    `## Summary`,
    summarySection,
    ``,
    `## Changes`,
    changesSection,
  ];

  if (commentsSection) {
    bodyParts.push(``, `## Issue comments`, commentsSection);
  }

  bodyParts.push(``, `Closes #${input.issue_number}`);

  const body = bodyParts.join("\n");

  if (config.updateDocs) {
    const docsResult = await updateProjectDocs({
      trigger: "create_pull_request",
      issueNumber: input.issue_number,
      issueTitle: issue.title,
      summary: input.summary ?? cleanedDescription,
      branchName,
    });

    // If docs were updated, commit the CHANGELOG onto the current (PR) branch so
    // it's included in the PR diff. A failure here must never block PR creation.
    if (docsResult) {
      try {
        execSync("git add CHANGELOG.md", { stdio: "ignore" });
        execSync(`git commit -m "docs: update CHANGELOG for #${input.issue_number}"`, { stdio: "ignore" });
      } catch (err) {
        console.warn(
          `[okffs] Failed to commit CHANGELOG for #${input.issue_number} — continuing without it.`,
          err instanceof Error ? err.message : err
        );
      }
    }
  }

  // Push the branch to remote so GitHub sees the commits before PR creation.
  // If commits exist only locally, the API would report no commits ahead of base.
  try {
    execSync(`git push origin ${branchName}`, { stdio: "ignore" });
  } catch (err) {
    console.warn(
      `[okffs] Failed to push branch ${branchName} to remote.`,
      err instanceof Error ? err.message : err
    );
    await addIssueComment(
      input.issue_number,
      `PR not created — could not push branch \`${branchName}\` to remote. Please push manually (\`git push origin ${branchName}\`) then run \`create_pull_request\` to continue.`
    );
    return {
      content: [{ type: "text" as const, text: `PR not created — could not push branch \`${branchName}\` to remote. Push manually (\`git push origin ${branchName}\`) then run create_pull_request to continue.` }],
    };
  }

  const pr = await createPullRequest(title, body, branchName, baseBranch);

  const comment = [
    `PR opened: ${pr.html_url}`,
    ``,
    body,
  ].join("\n");
  await addIssueComment(input.issue_number, comment);

  return {
    content: [{ type: "text" as const, text: `PR #${pr.number} created: ${pr.html_url}` }],
  };
}
