// Resolve an issue's branch, inferring and backfilling a missing **Branch:**
// line (#173, #304). Shared by create_pull_request and commit_and_update so
// both trust exactly the same evidence. Pure parts live in issue_body.ts.

import { extractBranchFromBody, updateIssueBody } from "./github.js";
import { currentBranch } from "./git.js";
import { inferIssueBranch, appendBranchLine } from "./issue_body.js";

export interface ResolvedIssueBranch {
  branch: string | null;
  /** "backfilled" when the **Branch:** line was written now, "backfill-failed" when that write failed. */
  backfill: "none" | "backfilled" | "backfill-failed";
}

export async function resolveIssueBranch(
  issueNumber: number,
  body: string | null,
  explicit?: string
): Promise<ResolvedIssueBranch> {
  const linked = extractBranchFromBody(body);
  if (linked) return { branch: linked, backfill: "none" };
  const branch = inferIssueBranch(issueNumber, currentBranch(), explicit);
  if (!branch) return { branch: null, backfill: "none" };
  try {
    await updateIssueBody(issueNumber, appendBranchLine(body, branch));
    return { branch, backfill: "backfilled" };
  } catch (err) {
    // Non-fatal: proceed with the resolved branch even if the backfill fails.
    console.warn(`[okffs] Could not backfill the **Branch:** line on #${issueNumber}:`, err instanceof Error ? err.message : err);
    return { branch, backfill: "backfill-failed" };
  }
}
