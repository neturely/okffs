import { z } from "zod";
import {
  getIssue,
  extractBranchFromBody,
  getDefaultBranch,
  getOpenPullRequestForBranch,
  getPullRequest,
  getCombinedStatus,
  getCheckRuns,
  getActionsJobLog,
} from "../github.js";
import { failedActionsRuns, logTail, renderChecksReport } from "../pr_checks.js";

export const name = "get_pr_checks";

export const description =
  "Read-only: report every commit status and check run on a pull request's head commit with its state (passed / failed / pending) and link, plus — for each FAILED GitHub Actions check — the last ~50 lines of that job's log, so a red check can be diagnosed without raw `gh pr checks` / `gh run view --log-failed`. " +
  "Provide exactly one of pr_number or issue_number (the issue's open PR into the base branch). Fetching logs needs the token's Actions: read permission; when a log can't be fetched the checks are still listed with the reason. " +
  "To wait for pending checks before merging, use merge_pull_request with wait_for_checks: true instead of polling this.";

export const inputSchema = z.object({
  pr_number: z.number().int().positive().optional().describe("The pull request number. Provide this OR issue_number."),
  issue_number: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("An issue whose open PR (from its **Branch:** into the base branch) should be checked. Provide this OR pr_number."),
});

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

export async function handler(input: z.infer<typeof inputSchema>) {
  const hasIssue = input.issue_number !== undefined;
  if (hasIssue === (input.pr_number !== undefined)) {
    return text(`[okffs] Provide exactly one of pr_number or issue_number. ${hasIssue ? "You passed both." : "You passed neither."}`);
  }

  let prNumber: number;
  if (hasIssue) {
    const issue = await getIssue(input.issue_number!);
    const branch = extractBranchFromBody(issue.body);
    if (!branch) return text(`Issue #${input.issue_number} has no associated branch (no **Branch:** line), so there's no PR to check.`);
    const base = await getDefaultBranch();
    const prRef = await getOpenPullRequestForBranch(branch, base);
    if (!prRef) return text(`No open PR for branch \`${branch}\` into \`${base}\`. Pass pr_number directly if it targets another branch.`);
    prNumber = prRef.number;
  } else {
    prNumber = input.pr_number!;
  }

  const pr = await getPullRequest(prNumber);
  const [combined, checks] = await Promise.all([getCombinedStatus(pr.head.sha), getCheckRuns(pr.head.sha)]);

  const logs = new Map<number, string[] | string>();
  await Promise.all(
    failedActionsRuns(checks).map(async (c) => {
      try {
        logs.set(c.id!, logTail(await getActionsJobLog(c.id!)));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const hint = /\b(403|404)\b/.test(msg) ? " The token may lack Actions: read, or the log has expired." : "";
        logs.set(c.id!, `${msg}${hint}`);
      }
    })
  );

  const header = `PR #${pr.number} (${pr.head.ref} → ${pr.base.ref}) @ ${pr.head.sha.slice(0, 7)}`;
  return text(renderChecksReport(header, combined, checks, logs));
}
