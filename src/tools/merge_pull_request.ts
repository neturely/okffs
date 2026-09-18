import { z } from "zod";
import {
  getIssue,
  extractBranchFromBody,
  getDefaultBranch,
  getRepoDefaultBranch,
  getOpenPullRequestForBranch,
  getPullRequest,
  mergePullRequest,
  closeIssue,
  addIssueComment,
  owner,
  repo,
  type PullRequestDetail,
} from "../github.js";
import { config } from "../config.js";
import { verifyMergeable } from "../pr_gates.js";

export const name = "merge_pull_request";

export const description =
  "Autonomously merge a GREEN, review-resolved PR into the BASE branch (e.g. develop) using the configured per-tier merge method (OKFFS_BASE_MERGE_METHOD, default squash). " +
  "Provide EXACTLY ONE of: issue_number (merge the issue's PR and complete the loop — comment on the issue and close it when the base isn't the repo default) OR pr_number (merge-only mode for an ISSUE-LESS fix PR into the base branch — skips the issue lookup, comment, and close, and needs no **Branch:** line). " +
  "This is the ONE okffs action that merges — every other tool only opens PRs and hands back. It is therefore heavily gated and OPT-IN: it does nothing unless OKFFS_AUTO_MERGE_BASE=true. " +
  "It NEVER merges OKFFS_PROTECTED_BRANCH (e.g. main) — that stays a manual, user-driven merge/tag — and refuses entirely if OKFFS_PROTECTED_BRANCH is unset, so it can't merge into an unnamed protected branch. " +
  "Before merging it independently verifies (not merely trusting branch-protection rules): the PR targets the base tier and not the protected branch; it is open, not a draft, and free of conflicts; all commit statuses AND check runs on the head are green (no failing or pending checks); the PR is not blocked by a required gate; and every review thread is resolved. Any unmet gate → it refuses with an actionable reason and does not merge. " +
  "On success (issue mode) it merges, comments on the issue, and — when the base isn't the repo default (so GitHub's Closes #N won't auto-close) — closes the issue to complete the loop. Use for landing small review-fix / feature PRs into develop without a human merge; the develop→main promotion always stays with the user.";

export const inputSchema = z.object({
  issue_number: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "The issue whose PR (into the base branch) should be merged — completes the loop (issue comment + close). Provide this OR pr_number, not both."
    ),
  pr_number: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Merge-only mode: merge an ISSUE-LESS fix PR into the base branch directly by PR number — no issue comment/close and no **Branch:** line required, but all the same green gates apply. Provide this OR issue_number, not both."
    ),
});

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

// Poll the PR until GitHub finishes computing `mergeable` (it returns null right
// after a push). A few short retries; if it never settles we refuse rather than
// guess. Uses setTimeout (not a shell sleep) so it works inside the server.
async function getPullRequestWhenComputed(prNumber: number): Promise<PullRequestDetail> {
  let detail = await getPullRequest(prNumber);
  for (let i = 0; detail.mergeable === null && i < 5; i++) {
    await new Promise((r) => setTimeout(r, 800));
    detail = await getPullRequest(prNumber);
  }
  return detail;
}

export async function handler(input: z.infer<typeof inputSchema>) {
  // ── Gate 0: exactly one of issue_number / pr_number ───────────────────────
  const hasIssue = input.issue_number !== undefined;
  const hasPr = input.pr_number !== undefined;
  if (hasIssue === hasPr) {
    return text(
      "[okffs] Provide exactly one of issue_number (merge an issue's PR and complete the loop — comment + close) " +
        "or pr_number (merge-only mode for an issue-less fix PR into the base branch). " +
        (hasIssue ? "You passed both." : "You passed neither.")
    );
  }

  // ── Gate 1: opt-in ────────────────────────────────────────────────────────
  if (!config.autoMergeBase) {
    return text(
      "Autonomous merge is off. okffs will not merge a PR unless OKFFS_AUTO_MERGE_BASE=true — set it to opt in " +
        "(the develop→main promotion always stays a manual, user-driven merge regardless)."
    );
  }

  // ── Gate 2: protected branch must be named ────────────────────────────────
  if (!config.protectedBranch) {
    return text(
      "[okffs] Refusing to merge: OKFFS_PROTECTED_BRANCH is unset. okffs must know which branch it may never merge " +
        "into before it merges anything — set OKFFS_PROTECTED_BRANCH (e.g. main) so autonomous merges can be confined to the base tier."
    );
  }

  const baseTier = await getDefaultBranch(); // OKFFS_BASE_BRANCH or the repo default

  // Misconfiguration guard: the base tier must not itself be the protected branch.
  if (baseTier === config.protectedBranch) {
    return text(
      `[okffs] Refusing to merge: the base branch (\`${baseTier}\`) is the same as OKFFS_PROTECTED_BRANCH. ` +
        "okffs never autonomously merges the protected branch — set OKFFS_BASE_BRANCH to a distinct base tier (e.g. develop)."
    );
  }

  // Resolve the PR to merge. Issue mode reads the issue's **Branch:** line and
  // finds its open PR into the base tier; merge-only mode takes the PR directly.
  let prNumber: number;
  if (hasIssue) {
    const issue = await getIssue(input.issue_number!);
    const branch = extractBranchFromBody(issue.body);
    if (!branch) {
      return text(`Issue #${input.issue_number} has no associated branch (no **Branch:** line), so there's no PR to merge.`);
    }
    const prRef = await getOpenPullRequestForBranch(branch, baseTier);
    if (!prRef) {
      return text(`No open PR found in \`${owner}/${repo}\` for branch \`${branch}\` into \`${baseTier}\`. Open one with create_pull_request first — and if the PR plainly exists, check that okffs is pointed at the right repository (GITHUB_OWNER/GITHUB_REPO or the origin remote).`);
    }
    prNumber = prRef.number;
  } else {
    prNumber = input.pr_number!;
  }

  const pr = await getPullRequestWhenComputed(prNumber);
  const label = `PR #${pr.number} (${pr.head.ref} → ${pr.base.ref})`;

  // ── Gate 3: target is the base tier, never the protected branch ───────────
  if (pr.base.ref === config.protectedBranch) {
    return text(
      `[okffs] Refusing to merge ${label}: it targets the protected branch \`${config.protectedBranch}\`. ` +
        "Promotion into the protected branch is a manual, user-driven merge (use promote_branch to open it) — okffs never merges it."
    );
  }
  if (pr.base.ref !== baseTier) {
    return text(
      `[okffs] Refusing to merge ${label}: it targets \`${pr.base.ref}\`, not the base tier \`${baseTier}\`. ` +
        "Autonomous merge only lands issue PRs into the base branch."
    );
  }

  // ── Gates 4–5: state, green checks, no pending review, threads resolved ──
  // Shared with the opt-in protected-tier merge in promote_branch (#311) so both
  // tiers refuse for identical reasons (src/pr_gates.ts).
  const refusal = await verifyMergeable(pr, baseTier);
  if (refusal) return text(refusal);

  // ── All gates passed — merge with the base-tier method ────────────────────
  const method = config.baseMergeMethod;
  try {
    await mergePullRequest(pr.number, method);
  } catch (err) {
    return text(`[okffs] Merge of ${label} failed at the GitHub API: ${err instanceof Error ? err.message : String(err)}`);
  }

  const lines = [`✅ Merged ${label} into \`${baseTier}\` via ${method}.`];

  // Merge-only mode: there's no issue to comment on or close — we're done.
  if (!hasIssue) {
    return text(lines.join("\n"));
  }

  const issueNumber = input.issue_number!;

  // Complete the loop: `Closes #N` only auto-closes when merging into the repo
  // default. For a non-default base tier (e.g. develop) the issue stays open, so
  // close it here. Non-fatal — the merge already succeeded.
  const repoDefault = await getRepoDefaultBranch();
  if (baseTier !== repoDefault) {
    try {
      await closeIssue(issueNumber);
      lines.push(`Closed #${issueNumber} (merging into \`${baseTier}\` doesn't trigger GitHub's auto-close).`);
    } catch (err) {
      lines.push(`⚠ Could not auto-close #${issueNumber} — close it manually. (${err instanceof Error ? err.message : String(err)})`);
    }
  } else {
    lines.push(`GitHub will auto-close #${issueNumber} via \`Closes #${issueNumber}\` (merged into the default branch).`);
  }

  // Log the merge on the issue for an audit trail.
  try {
    await addIssueComment(issueNumber, lines.join("\n"));
  } catch {
    /* non-fatal: the response still reports the outcome */
  }

  return text(lines.join("\n"));
}
