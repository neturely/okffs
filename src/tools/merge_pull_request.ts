import { z } from "zod";
import {
  getIssue,
  extractBranchFromBody,
  getDefaultBranch,
  getRepoDefaultBranch,
  getOpenPullRequestForBranch,
  getPullRequest,
  getCombinedStatus,
  getCheckRuns,
  getPullRequestReview,
  mergePullRequest,
  closeIssue,
  addIssueComment,
  type PullRequestDetail,
} from "../github.js";
import { config } from "../config.js";

export const name = "merge_pull_request";

export const description =
  "Autonomously merge a GREEN, review-resolved issue PR into the BASE branch (e.g. develop) using the configured per-tier merge method (OKFFS_BASE_MERGE_METHOD, default squash). " +
  "This is the ONE okffs action that merges — every other tool only opens PRs and hands back. It is therefore heavily gated and OPT-IN: it does nothing unless OKFFS_AUTO_MERGE_BASE=true. " +
  "It NEVER merges OKFFS_PROTECTED_BRANCH (e.g. main) — that stays a manual, user-driven merge/tag — and refuses entirely if OKFFS_PROTECTED_BRANCH is unset, so it can't merge into an unnamed protected branch. " +
  "Before merging it independently verifies (not merely trusting branch-protection rules): the PR targets the base tier and not the protected branch; it is open, not a draft, and free of conflicts; all commit statuses AND check runs on the head are green (no failing or pending checks); the PR is not blocked by a required gate; and every review thread is resolved. Any unmet gate → it refuses with an actionable reason and does not merge. " +
  "On success it merges, comments on the issue, and — when the base isn't the repo default (so GitHub's Closes #N won't auto-close) — closes the issue to complete the loop. Use for landing small review-fix / feature PRs into develop without a human merge; the develop→main promotion always stays with the user.";

export const inputSchema = z.object({
  issue_number: z.number().int().positive().describe("The issue whose PR (into the base branch) should be merged"),
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

  const issue = await getIssue(input.issue_number);
  const branch = extractBranchFromBody(issue.body);
  if (!branch) {
    return text(`Issue #${input.issue_number} has no associated branch (no **Branch:** line), so there's no PR to merge.`);
  }

  const baseTier = await getDefaultBranch(); // OKFFS_BASE_BRANCH or the repo default

  // Misconfiguration guard: the base tier must not itself be the protected branch.
  if (baseTier === config.protectedBranch) {
    return text(
      `[okffs] Refusing to merge: the base branch (\`${baseTier}\`) is the same as OKFFS_PROTECTED_BRANCH. ` +
        "okffs never autonomously merges the protected branch — set OKFFS_BASE_BRANCH to a distinct base tier (e.g. develop)."
    );
  }

  const prRef = await getOpenPullRequestForBranch(branch, baseTier);
  if (!prRef) {
    return text(`No open PR found for branch \`${branch}\` into \`${baseTier}\`. Open one with create_pull_request first.`);
  }

  const pr = await getPullRequestWhenComputed(prRef.number);
  const label = `PR #${pr.number} (${branch} → ${pr.base.ref})`;

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

  // ── Basic state: open, not draft, not already merged ──────────────────────
  if (pr.merged) return text(`${label} is already merged — nothing to do.`);
  if (pr.state !== "open") return text(`[okffs] Refusing to merge ${label}: the PR is ${pr.state}, not open.`);
  if (pr.draft) return text(`[okffs] Refusing to merge ${label}: it is still a draft. Mark it ready (e.g. create_pull_request finalizes it) first.`);

  // ── Conflicts / needs-update / required-gate signals (mergeable_state) ────
  if (pr.mergeable === false || pr.mergeable_state === "dirty") {
    return text(`[okffs] Refusing to merge ${label}: it has merge conflicts with \`${baseTier}\`. Resolve them, then retry.`);
  }
  if (pr.mergeable_state === "behind") {
    return text(`[okffs] Refusing to merge ${label}: the branch is behind \`${baseTier}\`. Update it (merge/rebase base in), then retry.`);
  }
  if (pr.mergeable_state === "blocked") {
    return text(
      `[okffs] Refusing to merge ${label}: GitHub reports it as blocked by a required gate (required review or required check not yet satisfied).`
    );
  }
  if (pr.mergeable === null || pr.mergeable_state === "unknown") {
    return text(`[okffs] Refusing to merge ${label}: GitHub hasn't finished computing its mergeability. Try again shortly.`);
  }

  // ── Gate 4: independently verify checks are green (don't trust the ruleset) ─
  // A ruleset may require NO status checks, yet CI can still be red — so verify
  // the head commit's statuses AND check runs ourselves. Any failing or pending
  // check refuses the merge.
  const [combined, checks] = await Promise.all([
    getCombinedStatus(pr.head.sha),
    getCheckRuns(pr.head.sha),
  ]);

  const badStatuses = combined.statuses
    .filter((s) => s.state !== "success")
    .map((s) => `${s.context} (${s.state})`);

  const badChecks = checks.check_runs
    .filter((c) => c.status !== "completed" || !["success", "neutral", "skipped"].includes(c.conclusion ?? ""))
    .map((c) => `${c.name} (${c.status === "completed" ? c.conclusion : c.status})`);

  const failing = [...badStatuses, ...badChecks];
  if (failing.length > 0) {
    return text(
      `[okffs] Refusing to merge ${label}: not all checks are green. Outstanding: ${failing.join(", ")}. ` +
        "Wait for them to pass (or fix them), then retry."
    );
  }

  // ── Gate 5: every review thread must be resolved ──────────────────────────
  const review = await getPullRequestReview(pr.number);
  const unresolved = review.threads.filter((t) => !t.isResolved && t.comments.length > 0);
  if (unresolved.length > 0) {
    return text(
      `[okffs] Refusing to merge ${label}: ${unresolved.length} review thread(s) still unresolved. ` +
        "Address and resolve them (see the address_pr_review prompt), then retry."
    );
  }

  // ── All gates passed — merge with the base-tier method ────────────────────
  const method = config.baseMergeMethod;
  try {
    await mergePullRequest(pr.number, method);
  } catch (err) {
    return text(`[okffs] Merge of ${label} failed at the GitHub API: ${err instanceof Error ? err.message : String(err)}`);
  }

  const lines = [`✅ Merged ${label} into \`${baseTier}\` via ${method}.`];

  // Complete the loop: `Closes #N` only auto-closes when merging into the repo
  // default. For a non-default base tier (e.g. develop) the issue stays open, so
  // close it here. Non-fatal — the merge already succeeded.
  const repoDefault = await getRepoDefaultBranch();
  if (baseTier !== repoDefault) {
    try {
      await closeIssue(input.issue_number);
      lines.push(`Closed #${input.issue_number} (merging into \`${baseTier}\` doesn't trigger GitHub's auto-close).`);
    } catch (err) {
      lines.push(`⚠ Could not auto-close #${input.issue_number} — close it manually. (${err instanceof Error ? err.message : String(err)})`);
    }
  } else {
    lines.push(`GitHub will auto-close #${input.issue_number} via \`Closes #${input.issue_number}\` (merged into the default branch).`);
  }

  // Log the merge on the issue for an audit trail.
  try {
    await addIssueComment(input.issue_number, lines.join("\n"));
  } catch {
    /* non-fatal: the response still reports the outcome */
  }

  return text(lines.join("\n"));
}
