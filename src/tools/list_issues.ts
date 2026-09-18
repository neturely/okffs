import { z } from "zod";
import { priorityRank } from "../priority.js";
import {
  listIssues,
  listOpenPullRequests,
  parseRelationships,
  buildBranchName,
  extractBranchFromBody,
  getPullRequestReview,
  owner,
  repo,
  type IssueRelationships,
  type PullRequestSummary,
} from "../github.js";
import { config } from "../config.js";
import { appFromLabels } from "../multisite.js";
import { getProjectFieldsByIssueNumber, getOrgIssueFieldValuesByNumber } from "../projects.js";
import { summarizeReviewThreads, renderReviewGateWarning } from "../review_gate.js";

// The open promotion/gate PR (base branch → protected branch), when one exists.
// Requires both tiers configured — without them there is no gate to look for.
function findPromotionPr(prs: PullRequestSummary[]): PullRequestSummary | undefined {
  if (!config.baseBranch || !config.protectedBranch) return undefined;
  return prs.find((pr) => pr.head.ref === config.baseBranch && pr.base.ref === config.protectedBranch);
}

// "Release gate" header for the listing: only present when the open gate PR has
// unresolved review threads, so a clean gate adds no noise (#302). Best-effort.
async function releaseGateLines(prs: PullRequestSummary[]): Promise<string[]> {
  const gatePr = findPromotionPr(prs);
  if (!gatePr) return [];
  try {
    const review = await getPullRequestReview(gatePr.number);
    const warning = renderReviewGateWarning(gatePr.number, summarizeReviewThreads(review.threads));
    if (!warning) return [];
    return [`Release gate (${config.baseBranch} → ${config.protectedBranch}): ${gatePr.html_url}`, warning, ""];
  } catch (err) {
    console.warn("[okffs] Failed to check the promotion PR's review threads:", err instanceof Error ? err.message : err);
    return [];
  }
}

export const name = "list_issues";

export const description =
  "List all open GitHub issues, each with its branch, any linked open or draft PR, its board column (project), its Priority, its native Issue Type (Task/Bug/Feature/…, when the org defines them), and its relationships (parent, children, blocked-by, blocking) shown as a tree. Issues are ordered by Priority (Urgent → High → Medium → Low → unset) so the most important work surfaces first — factor Priority in when deciding what to do next. Replaces the need for a separate PR-listing tool.";

export const inputSchema = z.object({});

// priorityRank lives in priority.ts (pure, unit-testable — #259).

export async function handler(_input: z.infer<typeof inputSchema>) {
  const [issues, prs] = await Promise.all([listIssues(), listOpenPullRequests()]);

  // Board Status + Priority per issue. Non-fatal: if a project fetch fails (e.g.
  // token lacks the permission), the listing still renders without that field.
  let projectStatus = new Map<number, string>();
  let priorityByIssue = new Map<number, string>();
  let effortByIssue = new Map<number, string>();
  if (config.projectEnabled && config.projectId) {
    try {
      const fields = await getProjectFieldsByIssueNumber();
      for (const [num, f] of fields) {
        if (f.status) projectStatus.set(num, f.status);
        if (f.priority) priorityByIssue.set(num, f.priority); // project-native
        if (f.effort) effortByIssue.set(num, f.effort);
      }
    } catch (err) {
      console.warn("[okffs] Failed to fetch project fields:", err instanceof Error ? err.message : err);
    }
    // Org-level Issue Field values (Priority/Effort on Neturely-style boards).
    // Needs the org permission, so only attempt when opted into a classic PAT.
    if (config.classicPat) {
      try {
        const orgValues = await getOrgIssueFieldValuesByNumber();
        for (const [num, vals] of orgValues) {
          const p = vals.get("priority");
          const e = vals.get("effort");
          if (p) priorityByIssue.set(num, p); // org value wins
          if (e) effortByIssue.set(num, e);
        }
      } catch (err) {
        console.warn("[okffs] Failed to fetch org Issue Field values:", err instanceof Error ? err.message : err);
      }
    }
  }

  // Pending review feedback on the open promotion PR must surface even when the
  // issue list is empty — it is exactly the "everything merged, gate waiting"
  // moment when someone looks here (#302).
  const gateLines = await releaseGateLines(prs);

  if (issues.length === 0) {
    return {
      content: [{ type: "text" as const, text: [...gateLines, "No open issues."].join("\n") }],
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

    const effort = effortByIssue.get(issue.number);
    if (effort) {
      lines.push(`    effort: ${effort}`);
    }

    // Native GitHub Issue Type (Task/Bug/Feature/…), read straight off the issue
    // object — no extra fetch. Absent on user repos / when the org defines none.
    if (issue.type) {
      lines.push(`    type: ${issue.type}`);
    }

    // Multisite (#309): which app the issue belongs to, by its app label.
    const app = appFromLabels((issue as { labels?: unknown }).labels, config.apps.length ? config.apps : config.app ? [config.app] : []);
    if (app) {
      lines.push(`    app: ${app}`);
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
    content: [{ type: "text" as const, text: [...gateLines, blocks.join("\n\n")].join("\n") }],
  };
}
