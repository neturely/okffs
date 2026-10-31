// Shared PR merge gates (#311). The base-tier merge (merge_pull_request,
// fix_into_base) and the opt-in protected-tier merge on a promote_branch re-run
// must refuse for exactly the same reasons — so the classification lives here
// once. The decision functions are pure over the fetched shapes (unit-tested);
// verifyMergeable() is the thin fetching wrapper.

import {
  getCombinedStatus,
  getCheckRuns,
  getPullRequestReview,
  type PullRequestDetail,
  type CombinedStatus,
  type CheckRunsResult,
  type PullRequestReview,
} from "./github.js";
import { waitForChecks, clampWaitSeconds, waitRefusal } from "./check_wait.js";

export type PrLike = Pick<PullRequestDetail, "number" | "state" | "draft" | "merged" | "mergeable" | "mergeable_state" | "head" | "base"> & {
  requested_reviewers?: Array<{ login: string }>;
  requested_teams?: Array<{ slug: string }>;
};

export function prLabel(pr: PrLike): string {
  return `PR #${pr.number} (${pr.head.ref} → ${pr.base.ref})`;
}

/** Refusal for the PR's own state/mergeability, or null when it is fine. Pure. */
export function mergeabilityRefusal(pr: PrLike, baseTier: string): string | null {
  const label = prLabel(pr);
  if (pr.merged) return `${label} is already merged — nothing to do.`;
  if (pr.state !== "open") return `[okffs] Refusing to merge ${label}: the PR is ${pr.state}, not open.`;
  if (pr.draft) return `[okffs] Refusing to merge ${label}: it is still a draft. Mark it ready (e.g. create_pull_request finalizes it) first.`;
  if (pr.mergeable === false || pr.mergeable_state === "dirty") {
    return `[okffs] Refusing to merge ${label}: it has merge conflicts with \`${baseTier}\`. Resolve them, then retry.`;
  }
  if (pr.mergeable_state === "behind") {
    return `[okffs] Refusing to merge ${label}: the branch is behind \`${baseTier}\`. Update it (merge/rebase base in), then retry.`;
  }
  if (pr.mergeable_state === "blocked") {
    return `[okffs] Refusing to merge ${label}: GitHub reports it as blocked by a required gate (required review or required check not yet satisfied).`;
  }
  if (pr.mergeable === null || pr.mergeable_state === "unknown") {
    return `[okffs] Refusing to merge ${label}: GitHub hasn't finished computing its mergeability. Try again shortly.`;
  }
  return null;
}

/** Statuses/check runs that are not green, rendered `name (state)`. Pure. */
export function outstandingChecks(combined: CombinedStatus, checks: CheckRunsResult): string[] {
  const badStatuses = combined.statuses.filter((s) => s.state !== "success").map((s) => `${s.context} (${s.state})`);
  const badChecks = checks.check_runs
    .filter((c) => c.status !== "completed" || !["success", "neutral", "skipped"].includes(c.conclusion ?? ""))
    .map((c) => `${c.name} (${c.status === "completed" ? c.conclusion : c.status})`);
  return [...badStatuses, ...badChecks];
}

/** Refusal when the PR's base changed between validation and merge (e.g. during a wait), else null. Pure. */
export function retargetRefusal(before: PrLike, after: PrLike): string | null {
  if (after.base.ref === before.base.ref) return null;
  return `[okffs] Refusing to merge ${prLabel(after)}: it was retargeted from \`${before.base.ref}\` to \`${after.base.ref}\` while waiting for checks. Nothing merged — re-run so the target is validated again.`;
}

/** Reviewers (users and teams) whose requested review has not been submitted yet. Pure. */
export function pendingReviewers(pr: PrLike): string[] {
  return [...(pr.requested_reviewers ?? []).map((r) => r.login), ...(pr.requested_teams ?? []).map((t) => `team:${t.slug}`)];
}

/** Unresolved review threads that actually contain comments. Pure. */
export function unresolvedThreadCount(review: Pick<PullRequestReview, "threads">): number {
  return review.threads.filter((t) => !t.isResolved && t.comments.length > 0).length;
}

export interface CheckWaitOptions {
  /** Wait (bounded) for pending checks before evaluating the gates (#347). */
  wait?: boolean;
  /** Requested wait in seconds; defaulted and capped by clampWaitSeconds. */
  timeoutSeconds?: number;
  /** Tail of the "still pending" message telling the caller how to retry. */
  retryHint?: string;
  /** Re-fetch the PR after checks settle (mergeable_state may leave `blocked`). */
  refetch?: () => Promise<PrLike>;
}

/**
 * Optionally wait for the PR's checks, then run every gate. With `wait`, a red
 * check refuses immediately (fail fast) and a check still running at the
 * deadline returns a "pending — retry" note; green re-fetches the PR and runs
 * the normal gates unchanged. Without `wait`, identical to verifyMergeable.
 */
export async function verifyMergeableWithWait(pr: PrLike, baseTier: string, opts: CheckWaitOptions = {}): Promise<string | null> {
  if (!opts.wait) return verifyMergeable(pr, baseTier);
  const outcome = await waitForChecks(clampWaitSeconds(opts.timeoutSeconds), {
    fetch: async () => {
      const [combined, checks] = await Promise.all([getCombinedStatus(pr.head.sha), getCheckRuns(pr.head.sha)]);
      return { combined, checks };
    },
  });
  if (outcome.state !== "green") {
    return waitRefusal(prLabel(pr), outcome, opts.retryHint ?? "re-run with wait_for_checks to keep waiting.");
  }
  const fresh = opts.refetch ? await opts.refetch() : pr;
  // The caller validated the target tier BEFORE the wait; a PR retargeted
  // during it (e.g. to the protected branch) must not ride that validation.
  const retarget = retargetRefusal(pr, fresh);
  if (retarget) return retarget;
  return verifyMergeable(fresh, baseTier);
}

/**
 * Every gate beyond "targets the right tier": state/mergeability, green checks,
 * no pending requested review, every thread resolved. Returns the actionable
 * refusal, or null when the PR may be merged.
 */
export async function verifyMergeable(pr: PrLike, baseTier: string): Promise<string | null> {
  const label = prLabel(pr);
  const stateRefusal = mergeabilityRefusal(pr, baseTier);
  if (stateRefusal) return stateRefusal;

  // Independently verify checks are green — a ruleset may require NO status
  // checks, yet CI can still be red. Any failing or pending check refuses.
  const [combined, checks] = await Promise.all([getCombinedStatus(pr.head.sha), getCheckRuns(pr.head.sha)]);
  const failing = outstandingChecks(combined, checks);
  if (failing.length > 0) {
    return `[okffs] Refusing to merge ${label}: not all checks are green. Outstanding: ${failing.join(", ")}. Wait for them to pass (or fix them), then retry — pass wait_for_checks: true to have okffs wait for pending checks, or run get_pr_checks to see why one failed.`;
  }

  // A requested review that hasn't been submitted yet (e.g. Copilot still
  // running on a fresh gate PR) must land before an autonomous merge.
  const pending = pendingReviewers(pr);
  if (pending.length > 0) {
    return `[okffs] Refusing to merge ${label}: review still pending from ${pending.join(", ")}. Wait for it to land, address it, then retry.`;
  }

  const review = await getPullRequestReview(pr.number);
  const unresolved = unresolvedThreadCount(review);
  if (unresolved > 0) {
    return `[okffs] Refusing to merge ${label}: ${unresolved} review thread(s) still unresolved. Address and resolve them (see the address_pr_review prompt), then retry.`;
  }
  return null;
}
