import { z } from "zod";
import {
  listIssues,
  listOpenPullRequests,
  parseRelationships,
  buildBranchName,
  extractBranchFromBody,
  owner,
  repo,
  type IssueRelationships,
} from "../github.js";

export const name = "list_issues";

export const description =
  "List all open GitHub issues, each with its branch, any linked open or draft PR, and its relationships (parent, children, blocked-by, blocking) shown as a tree. Replaces the need for a separate PR-listing tool.";

export const inputSchema = z.object({});

export async function handler(_input: z.infer<typeof inputSchema>) {
  const [issues, prs] = await Promise.all([listIssues(), listOpenPullRequests()]);

  if (issues.length === 0) {
    return {
      content: [{ type: "text" as const, text: "No open issues." }],
    };
  }

  // Match PRs to issues by head branch.
  const prByBranch = new Map(prs.map((pr) => [pr.head.ref, pr]));

  // Parse relationships once per issue and invert parent links to find children.
  const relsByIssue = new Map<number, IssueRelationships>();
  const childrenOf = new Map<number, number[]>();
  for (const issue of issues) {
    const rels = parseRelationships(issue.body);
    relsByIssue.set(issue.number, rels);
    for (const parent of rels.parent) {
      childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), issue.number]);
    }
  }

  const fmt = (nums: number[]) => nums.map((n) => `#${n}`).join(", ");

  const blocks = issues.map((issue) => {
    const branch = extractBranchFromBody(issue.body) ?? buildBranchName(issue.number, issue.title);
    const branchUrl = `https://github.com/${owner}/${repo}/tree/${branch}`;
    const pr = prByBranch.get(branch);
    const rels = relsByIssue.get(issue.number)!;
    const children = childrenOf.get(issue.number) ?? [];

    const lines = [
      `#${issue.number}  ${issue.title}`,
      `    issue:  ${issue.html_url}`,
      `    branch: ${branch}`,
      `            ${branchUrl}`,
    ];

    if (pr) {
      lines.push(`    PR:     #${pr.number} (${pr.draft ? "draft" : "open"})  ${pr.html_url}`);
    }

    // Relationships as a small tree under the issue.
    const relLines: string[] = [];
    if (rels.parent.length) relLines.push(`parent:     ${fmt(rels.parent)}`);
    if (children.length) relLines.push(`children:   ${fmt(children)}`);
    if (rels.blockedBy.length) relLines.push(`blocked by: ${fmt(rels.blockedBy)}`);
    if (rels.blocking.length) relLines.push(`blocking:   ${fmt(rels.blocking)}`);

    relLines.forEach((rl, idx) => {
      const connector = idx === relLines.length - 1 ? "└─" : "├─";
      lines.push(`    ${connector} ${rl}`);
    });

    return lines.join("\n");
  });

  return {
    content: [{ type: "text" as const, text: blocks.join("\n\n") }],
  };
}
