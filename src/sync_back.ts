// Sync-back after a promotion (#361): once the gate PR lands, the protected
// branch (e.g. main) holds a merge commit the base branch (e.g. develop) lacks.
// It has to flow back as a TRUE merge commit — a squash rewrites history and
// the next promotion PR reports phantom conflicts — so the method is fixed
// here, never OKFFS_BASE_MERGE_METHOD. Pure decisions + rendering; the
// fetching/merging lives in promote_branch.

/** Always a merge commit, whatever the base tier's configured method is. */
export const SYNC_BACK_MERGE_METHOD = "merge";

export type SyncBackPlan = "none" | "open" | "reuse";

/**
 * What to do given how many commits the protected branch has that the base
 * branch lacks, and whether a sync-back PR is already open. An open PR is
 * reused (and merged) even with nothing ahead — GitHub may simply not have
 * caught up — so a stuck PR is never left behind. Pure.
 */
export function planSyncBack(commitsAhead: number, openPr: boolean): SyncBackPlan {
  if (openPr) return "reuse";
  return commitsAhead > 0 ? "open" : "none";
}

export function syncBackTitle(from: string, into: string): string {
  return `Sync ${from} → ${into}`;
}

export function syncBackBody(from: string, into: string): string {
  return [
    `Sync-back after a promotion: brings \`${from}\` back into \`${into}\` so the next promotion starts from a common history.`,
    ``,
    `Merged with a **merge commit** (never squash) — a squash would make the next \`${into} → ${from}\` promotion report phantom conflicts. No \`Closes #N\` — this is a branch sync, not an issue.`,
  ].join("\n");
}

/** Refusal-style warning unless the merged commit really is a merge commit (≥ 2 parents). Pure. */
export function mergeCommitWarning(sha: string, parents: string[]): string | null {
  if (parents.length >= 2) return null;
  return `⚠️ Sync-back commit ${sha.slice(0, 7)} has ${parents.length} parent(s), not 2 — it is not a true merge commit, so the next promotion may report phantom conflicts. Check the repo allows merge commits on the base branch.`;
}

/** Success line naming the merge commit and its parents. Pure. */
export function renderSyncBackMerged(prNumber: number, from: string, into: string, sha: string, parents: string[]): string {
  const warning = mergeCommitWarning(sha, parents);
  if (warning) return `🔄 Synced \`${from}\` → \`${into}\` via PR #${prNumber}, but: ${warning}`;
  return `🔄 Synced \`${from}\` → \`${into}\` via PR #${prNumber} — merge commit ${sha.slice(0, 7)} (parents ${parents.map((p) => p.slice(0, 7)).join(", ")}).`;
}

/**
 * A promotion with commits but no file changes carries only sync-back merge
 * commits (a sync leaves the base branch one merge commit "ahead" with an
 * identical tree) — opening a gate PR for it would be noise, and a billable
 * review. Pure.
 */
export function isEmptyPromotion(commits: number, filesChanged: number): boolean {
  return commits === 0 || filesChanged === 0;
}
