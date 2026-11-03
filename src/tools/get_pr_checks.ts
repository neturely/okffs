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
  resolveCommitSha,
} from "../github.js";
import {
  failedActionsRuns,
  logTail,
  renderChecksReport,
  compileLogMatch,
  completedActionsRuns,
  matchLogLines,
  renderLogMatches,
} from "../pr_checks.js";
import { waitForChecks, clampWaitSeconds } from "../check_wait.js";

export const name = "get_pr_checks";

export const description =
  "Read-only: report every commit status and check run on a commit with its state (passed / failed / pending) and link, plus — for each FAILED GitHub Actions check — the last ~50 lines of that job's log, so a red check can be diagnosed without raw `gh pr checks` / `gh run view --log-failed`. " +
  "Provide exactly one of pr_number, issue_number (the issue's open PR into the base branch), or ref — a tag, branch or commit sha, e.g. the release tag or `main` after a promotion, to watch the deploy run it triggered instead of raw `gh run list` / `gh run watch`. " +
  "wait_for_checks: true waits (bounded: default 90s, max 180s) for pending runs first — a red run stops the wait at once; still running at the deadline is reported, re-call to keep waiting. " +
  "log_match (a regex) searches every completed GitHub Actions run's log and reports the matching lines — e.g. `\\[health\\] applied` to confirm a deploy's migrations ran — instead of grepping logs by hand. " +
  "Fetching logs needs the token's Actions: read permission; when a log can't be fetched the checks are still listed with the reason. " +
  "To wait for checks before MERGING a PR, use merge_pull_request with wait_for_checks: true instead.";

export const inputSchema = z.object({
  pr_number: z.number().int().positive().optional().describe("The pull request number. Provide exactly one of pr_number, issue_number, ref."),
  issue_number: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("An issue whose open PR (from its **Branch:** into the base branch) should be checked. Provide exactly one of pr_number, issue_number, ref."),
  ref: z
    .string()
    .min(1)
    .optional()
    .describe("A tag, branch or commit sha whose checks to report — e.g. a release tag or `main` to watch the deploy run a push/tag triggered. Provide exactly one of pr_number, issue_number, ref."),
  wait_for_checks: z.boolean().optional().describe("Wait (bounded) for pending runs to finish before reporting. A failing run stops the wait immediately."),
  wait_timeout_seconds: z.number().int().nonnegative().optional().describe("How long wait_for_checks may block, in seconds (default 90, capped at 180). For long runs, re-call rather than raising this."),
  log_match: z
    .string()
    .min(1)
    .optional()
    .describe("A regular expression searched in every completed GitHub Actions run's log, e.g. `\\[health\\] applied`; the matching lines are reported per run."),
});

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

export async function handler(input: z.infer<typeof inputSchema>) {
  const given = [input.pr_number, input.issue_number, input.ref].filter((v) => v !== undefined).length;
  if (given !== 1) {
    return text(`[okffs] Provide exactly one of pr_number, issue_number, or ref. ${given === 0 ? "You passed none." : `You passed ${given}.`}`);
  }

  let matcher: RegExp | null = null;
  if (input.log_match !== undefined) {
    const compiled = compileLogMatch(input.log_match);
    if (typeof compiled === "string") return text(compiled);
    matcher = compiled;
  }

  let sha: string;
  let header: string;
  if (input.ref !== undefined) {
    try {
      sha = await resolveCommitSha(input.ref);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return text(`[okffs] Could not resolve ref \`${input.ref}\` to a commit: ${msg}`);
    }
    header = `\`${input.ref}\` @ ${sha.slice(0, 7)}`;
  } else {
    let prNumber: number;
    if (input.issue_number !== undefined) {
      const issue = await getIssue(input.issue_number);
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
    sha = pr.head.sha;
    header = `PR #${pr.number} (${pr.head.ref} → ${pr.base.ref}) @ ${sha.slice(0, 7)}`;
  }

  const fetchChecks = async () => {
    const [combined, checks] = await Promise.all([getCombinedStatus(sha), getCheckRuns(sha)]);
    return { combined, checks };
  };

  let waitNote: string | null = null;
  if (input.wait_for_checks) {
    const outcome = await waitForChecks(clampWaitSeconds(input.wait_timeout_seconds), { fetch: fetchChecks });
    const secs = Math.round(outcome.waitedMs / 1000);
    if (outcome.state === "pending") waitNote = `⏳ Still pending after waiting ${secs}s — re-call with wait_for_checks: true to keep waiting.`;
    else if (outcome.state === "failed") waitNote = `Stopped waiting after ${secs}s: a run failed.`;
    else waitNote = `Waited ${secs}s for the runs to settle.`;
  }
  const { combined, checks } = await fetchChecks();

  // One log fetch per run, shared by the failure tail and log_match.
  const rawLogs = new Map<number, Promise<string>>();
  const logOf = (id: number) => {
    if (!rawLogs.has(id)) rawLogs.set(id, getActionsJobLog(id));
    return rawLogs.get(id)!;
  };
  const describeLogError = (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    const hint = /\b(403|404)\b/.test(msg) ? " The token may lack Actions: read, or the log has expired." : "";
    return `${msg}${hint}`;
  };

  const logs = new Map<number, string[] | string>();
  const matches = new Map<number, string[] | string>();
  await Promise.all([
    ...failedActionsRuns(checks).map(async (c) => {
      try {
        logs.set(c.id!, logTail(await logOf(c.id!)));
      } catch (err) {
        logs.set(c.id!, describeLogError(err));
      }
    }),
    ...(matcher
      ? completedActionsRuns(checks).map(async (c) => {
          try {
            matches.set(c.id!, matchLogLines(await logOf(c.id!), matcher!));
          } catch (err) {
            matches.set(c.id!, describeLogError(err));
          }
        })
      : []),
  ]);

  const parts = [renderChecksReport(header, combined, checks, logs)];
  if (matcher) {
    const running = checks.check_runs.filter((c) => c.status !== "completed" && c.app?.slug === "github-actions").map((c) => c.name);
    parts.push(renderLogMatches(input.log_match!, checks, matches, running));
  }
  if (waitNote) parts.push(waitNote);
  return text(parts.join("\n\n"));
}
