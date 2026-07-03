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
import { config } from "../config.js";
import { getProjectFieldsByIssueNumber, getOrgIssuePrioritiesByNumber } from "../projects.js";

export const name = "list_issues";

export const description =
  "List all open GitHub issues, each with its branch, any linked open or draft PR, its board column (project), its Priority, and its relationships (parent, children, blocked-by, blocking) shown as a tree. Issues are ordered by Priority (Urgent → High → Medium → Low → unset) so the most important work surfaces first — factor Priority in when deciding what to do next. Replaces the need for a separate PR-listing tool.";

export const inputSchema = z.object({});

// Board Priority order (highest first); unknown named priorities rank between the
// known set and unset, so custom option names still sort ahead of no priority.
const PRIORITY_ORDER = ["Urgent", "High", "Medium", "Low"];
function priorityRank(p?: string): number {
  if (!p) return 99;
  const i = PRIORITY_ORDER.indexOf(p);
  return i === -1 ? 50 : i;
}

export async function handler(_input: z.infer<typeof inputSchema>) {
  const [issues, prs] = await Promise.all([listIssues(), listOpenPullRequests()]);

  // Board Status + Priority per issue. Non-fatal: if a project fetch fails (e.g.
  // token lacks the permission), the listing still renders without that field.
  let projectStatus = new Map<number, string>();
  let priorityByIssue = new Map<number, string>();
  if (config.projectEnabled && config.projectId) {
    try {
      const fields = await getProjectFieldsByIssueNumber();
      for (const [num, f] of fields) {
        if (f.status) projectStatus.set(num, f.status);
        if (f.priority) priorityByIssue.set(num, f.priority); // project-native Priority
      }
    } catch (err) {
      console.warn("[okffs] Failed to fetch project fields:", err instanceof Error ? err.message : err);
    }
    // Org-level Issue Field Priority (Neturely-style boards). Needs the org
    // permission, so only attempt it when the user has opted into a classic PAT.
    if (config.classicPat) {
      try {
        const orgPriorities = await getOrgIssuePrioritiesByNumber();
        for (const [num, p] of orgPriorities) priorityByIssue.set(num, p); // org value wins
      } catch (err) {
        console.warn("[okffs] Failed to fetch org Issue Field priorities:", err instanceof Error ? err.message : err);
      }
    }
  }

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

  // Order by Priority (highest first), then by issue number descending within the
  // same priority, so the listing itself surfaces what matters most first.
  const ordered = [...issues].sort((a, b) => {
    const byPriority = priorityRank(priorityByIssue.get(a.number)) - priorityRank(priorityByIssue.get(b.number));
    return byPriority !== 0 ? byPriority : b.number - a.number;
  });

  const blocks = ordered.map((issue) => {
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

    const status = projectStatus.get(issue.number);
    if (status) {
      lines.push(`    project: ${status}`);
    }

    const priority = priorityByIssue.get(issue.number);
    if (priority) {
      lines.push(`    priority: ${priority}`);
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
