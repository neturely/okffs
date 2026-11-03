import { z } from "zod";
import { addIssueComment, getIssue, extractBranchFromBody } from "../github.js";
import { isEpicType, issueTypeName, epicToolRefusal } from "../epic.js";
import { git, gitOutput, currentBranch } from "../git.js";
import { renderAutopilotDecisions, AUTOPILOT_DECISIONS_DESCRIPTION } from "../autopilot.js";
import { matchSecretPaths, buildAutoCommitMessage, splitCommitMessage } from "../staging.js";

export const name = "commit_and_update";
export const description =
  "Stage tracked, modified files (untracked/new files require include_untracked: true), build a commit message from the provided message (used verbatim) or the staged file list, commit, push to the issue branch, and post a rich progress comment to the linked issue. Refuses to stage files matching a secrets deny-list (.env*, *.env, *.pem, *.key, id_rsa*, *credentials*, *.p12, *.pfx) unless explicitly overridden, and returns the full staged file list.";

// `message` is the canonical param name (#290); the `hint` alias shipped in
// 0.11.0 as a one-release deprecation and was removed in #297. The object is
// passthrough, not strict, so unknown keys (e.g. `commit_message`, or the
// removed `hint`) reach the handler and get an actionable rejection instead of
// being silently stripped by zod — a silently-dropped message is how the
// greyvensteins commit lost its message entirely (#290).
export const inputSchema = z.object({
  issue_number: z.number().int().positive().describe("The issue number this work is against"),
  message: z.string().optional().describe("The commit message — used verbatim (word-boundary subject/body split) and in the issue comment"),
  include_untracked: z.boolean().optional().describe("Also stage untracked (new) files — off by default so scratch/backup files can't be silently swept into a commit (#265). Set true deliberately when the work added new files."),
  allow_secret_paths: z.boolean().optional().describe("Override the secrets deny-list refusal and stage matching files anyway. Only for files that genuinely contain no secrets."),
  autopilot_decisions: z.array(z.string()).optional().describe(AUTOPILOT_DECISIONS_DESCRIPTION),
}).passthrough();

const KNOWN_PARAMS = new Set([
  "issue_number",
  "message",
  "include_untracked",
  "allow_secret_paths",
  "autopilot_decisions",
]);

// splitCommitMessage lives in staging.ts (pure, unit-testable — #259).

export async function handler(input: z.infer<typeof inputSchema>) {
  // Reject unknown params explicitly (#290): zod's default strip means a
  // mis-guessed name like `commit_message` silently vanishes and the commit
  // lands with the auto-generated fallback message instead of the caller's.
  const unknownParams = Object.keys(input).filter((k) => !KNOWN_PARAMS.has(k));
  if (unknownParams.length > 0) {
    const hintNote = unknownParams.includes("hint")
      ? " (`hint` was removed in 0.12.0 — pass the commit message as `message`.)"
      : "";
    return {
      content: [{
        type: "text" as const,
        text: `[okffs] commit_and_update: unknown parameter(s) ${unknownParams.map((k) => `\`${k}\``).join(", ")} — nothing was committed. Valid parameters: issue_number, message (the commit message), include_untracked, allow_secret_paths, autopilot_decisions.${hintNote}`,
      }],
    };
  }

  // A GitHub API failure here must surface as a contextual tool result, not a
  // raw MCP -32603 internal error. Nothing has happened yet, so a plain error
  // message is the right shape (#284).
  let issue: Awaited<ReturnType<typeof getIssue>>;
  try {
    issue = await getIssue(input.issue_number);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      content: [{
        type: "text" as const,
        text: `commit_and_update failed: could not look up issue #${input.issue_number} (${msg}). Nothing was committed.`,
      }],
    };
  }
  const branchName = extractBranchFromBody(issue.body);

  // Without a **Branch:** line there is no issue branch to commit to — carrying
  // on would commit onto whatever branch happens to be checked out and never
  // push. Refuse early instead (PR #277 review).
  if (!branchName) {
    if (isEpicType(issueTypeName(issue.type))) {
      return { content: [{ type: "text" as const, text: epicToolRefusal("commit_and_update", input.issue_number) }] };
    }
    return {
      content: [{
        type: "text" as const,
        text: `Issue #${input.issue_number} has no associated branch (no **Branch:** line), so there's nothing to commit to. Use create_pull_request with an explicit \`branch\` to backfill the link, or add the **Branch:** line to the issue body.`,
      }],
    };
  }

  // Trim so a whitespace-only message (e.g. "   ") counts as absent — otherwise
  // it is truthy and yields an empty commit subject (#236).
  const hintText = (input.message ?? "").trim();

  // Stage, commit, and push on the issue branch. Arguments are passed as an
  // array (no shell), so the hint and branch name can't be interpreted as
  // shell commands. The caller's original branch is restored afterward.
  const previousBranch = currentBranch();
  let commitHash = "";
  let idempotentRetry = false;
  let retrySubject = "";
  let commitMessage = "";
  let stagedFiles: string[] = [];
  let stagedStats: string[] = [];
  let skippedUntracked: string[] = [];
  try {
    if (branchName && previousBranch !== branchName) {
      git(["checkout", branchName]);
    }

    // Staging is tracked-modified only (`git add -u`) unless include_untracked
    // is set — the silent add-all sweep of untracked scratch/backup files is
    // how live secrets got committed three times (#265).
    const untrackedFiles = gitOutput(["ls-files", "--others", "--exclude-standard"]).split("\n").filter(Boolean);
    const trackedChanges = gitOutput(["diff", "--name-only", "HEAD"]).split("\n").filter(Boolean);
    const toStage = input.include_untracked ? [...trackedChanges, ...untrackedFiles] : trackedChanges;
    skippedUntracked = input.include_untracked ? [] : untrackedFiles;

    // Last line of defense (#265): refuse secret-looking filenames even when
    // not gitignored — GitHub-push-protection philosophy at the tool boundary.
    const secretFiles = matchSecretPaths(toStage);
    if (secretFiles.length > 0 && !input.allow_secret_paths) {
      return {
        content: [{
          type: "text" as const,
          text: [
            `commit_and_update refused: these files match the secrets deny-list (.env*, *.env, *.pem, *.key, id_rsa*, *credentials*, *.p12, *.pfx):`,
            ...secretFiles.map((f) => `- \`${f}\``),
            ``,
            `Nothing was staged or committed. Delete or gitignore them — or, only if they genuinely contain no secrets, re-call with allow_secret_paths: true.`,
          ].join("\n"),
        }],
      };
    }

    const numstatLines = (raw: string): string[] =>
      raw.split("\n").filter(Boolean).map((line) => {
        const [adds, dels, ...rest] = line.split("\t");
        return `\`${rest.join("\t")}\` (+${adds}/-${dels})`;
      });

    git(["add", input.include_untracked ? "-A" : "-u"]);
    stagedFiles = gitOutput(["diff", "--cached", "--name-only"]).split("\n").filter(Boolean);
    // Defense in depth (PR #289 review): the pre-staging check above already
    // covers pre-staged index entries (`git diff HEAD` includes the index), but
    // re-check the actually-staged list so nothing staged out-of-band can reach
    // the commit through an edge the name-diff missed.
    const stagedSecrets = matchSecretPaths(stagedFiles);
    if (stagedSecrets.length > 0 && !input.allow_secret_paths) {
      return {
        content: [{
          type: "text" as const,
          text: [
            `commit_and_update refused: these staged files match the secrets deny-list:`,
            ...stagedSecrets.map((f) => `- \`${f}\``),
            ``,
            `Nothing was committed (the files remain staged). Unstage and delete or gitignore them — or, only if they genuinely contain no secrets, re-call with allow_secret_paths: true.`,
          ].join("\n"),
        }],
      };
    }
    // Per-file additions/deletions for the tool result and issue comment, so an
    // unexpected file is visible to the caller — untruncated (#265).
    stagedStats = numstatLines(gitOutput(["diff", "--cached", "--numstat"]));

    // Idempotent retry (#269): nothing staged means `git commit` would fail
    // with "nothing to commit". That's expected when a previous invocation
    // actually completed server-side (stage+commit+push landed) but the client
    // timed out and retried. Distinguish that from a genuine no-op call by
    // comparing HEAD to the remote branch tip: HEAD already pushed → treat as
    // success and still post/refresh the issue comment; HEAD not on the
    // remote → keep a friendly error (nothing was committed or pushed).
    if (stagedFiles.length === 0) {
      const head = gitOutput(["rev-parse", "HEAD"]);
      const remoteRef = gitOutput(["ls-remote", "origin", `refs/heads/${branchName}`]);
      const remoteTip = remoteRef.split(/\s+/)[0] ?? "";
      if (remoteTip && remoteTip === head) {
        idempotentRetry = true;
        commitHash = gitOutput(["rev-parse", "--short", "HEAD"]);
        // Capture the landed commit's subject here, keyed by the full hash and
        // while still on the issue branch — a short hash can turn ambiguous as
        // history grows, and after `finally` we're back on the caller's branch
        // (PR #277 review).
        retrySubject = gitOutput(["log", "-1", "--pretty=%s", head]);
        // Retries usually happen because the caller never saw the prior output —
        // report the landed commit's files rather than "No files detected"
        // (PR #289 review).
        stagedStats = numstatLines(gitOutput(["show", "--numstat", "--format=", head]));
      } else {
        const untrackedNote = skippedUntracked.length > 0
          ? ` Note: ${skippedUntracked.length} untracked file(s) were not staged (${skippedUntracked.map((f) => `\`${f}\``).join(", ")}) — pass include_untracked: true to include them.`
          : "";
        return {
          content: [{
            type: "text" as const,
            text: `Nothing to commit: no staged changes and the latest commit is not on \`origin/${branchName}\`.${untrackedNote} Make some changes first (or push the branch manually if that was the intent).`,
          }],
        };
      }
    } else {
      // The caller's hint is the commit message, used verbatim (subject split
      // at a word boundary, remainder into the body — #228/#236); only when
      // absent is a message auto-generated, and the auto message never
      // truncates the file list (#265).
      const { subject, body: commitBody } = hintText
        ? splitCommitMessage(hintText)
        : buildAutoCommitMessage(stagedFiles);
      commitMessage = subject;
      const commitArgs = ["commit", "-m", subject];
      if (commitBody) {
        // A second -m yields a native subject + body (blank-line separated),
        // still passing every arg as an array (no shell).
        commitArgs.push("-m", commitBody);
      }
      git(commitArgs);
      if (branchName) {
        git(["push", "origin", branchName]);
      }
      commitHash = gitOutput(["rev-parse", "--short", "HEAD"]);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text" as const, text: `commit_and_update failed: ${msg}` }],
    };
  } finally {
    if (branchName && previousBranch && previousBranch !== branchName) {
      try {
        git(["checkout", previousBranch]);
      } catch (err) {
        console.warn("[okffs] Failed to restore branch:", err instanceof Error ? err.message : err);
      }
    }
  }

  // Post rich comment to issue
  const timestamp = new Date().toISOString();
  const filesSection = stagedStats.length > 0
    ? stagedStats.map((s) => `- ${s}`).join("\n")
    : "- No files detected";
  const skippedSection = skippedUntracked.length > 0
    ? `\n**Untracked files not staged** (pass \`include_untracked: true\` to include):\n${skippedUntracked.map((f) => `- \`${f}\``).join("\n")}`
    : "";

  // Autopilot decisions report (#238) — logged onto the issue as work progresses
  // so a decide-then-report run leaves an audit trail at each step, not only at PR.
  const decisionsSection = renderAutopilotDecisions(input.autopilot_decisions);

  // On an idempotent retry nothing was committed this call — report the subject
  // of the commit that actually landed rather than the rebuilt (unused) message.
  const reportedMessage = idempotentRetry ? retrySubject : commitMessage;

  const comment = [
    `### 🔧 Commit update${idempotentRetry ? " (idempotent retry — already committed and pushed)" : ""}`,
    ``,
    `**Commit:** \`${commitHash}\``,
    `**Message:** ${reportedMessage}`,
    `**Time:** ${timestamp}`,
    ``,
    `**Files changed:**`,
    filesSection,
    skippedSection,
    hintText ? `\n**Summary:** ${hintText}` : "",
    decisionsSection ? `\n${decisionsSection}` : "",
  ].filter((l) => l !== undefined).join("\n");

  // The commit+push above is durable — a failure posting the comment must be
  // reported as success-with-warning carrying the landed state (commit hash,
  // branch), never escape as a raw MCP -32603 that hides the partial success (#284).
  try {
    await addIssueComment(input.issue_number, comment);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const landed = idempotentRetry
      ? `Already committed and pushed as \`${commitHash}\` on \`${branchName}\` (idempotent retry)`
      : `Committed \`${commitHash}\` and pushed to \`${branchName}\``;
    return {
      content: [{
        type: "text" as const,
        text: `${landed}. Posting the progress comment to issue #${input.issue_number} failed (${msg}) — the commit is safe and does NOT need to be redone; retry just the comment with comment_issue.`,
      }],
    };
  }

  // The tool result carries the full, untruncated staged file list (and any
  // skipped untracked files) so the calling agent can spot an unexpected file
  // immediately (#265).
  const resultFiles = stagedStats.length > 0
    ? `\n\nFiles in commit:\n${stagedStats.map((s) => `- ${s}`).join("\n")}`
    : "";
  const resultSkipped = skippedUntracked.length > 0
    ? `\n\nUntracked files NOT staged (pass include_untracked: true to include them):\n${skippedUntracked.map((f) => `- \`${f}\``).join("\n")}`
    : "";

  return {
    content: [{
      type: "text" as const,
      text: (idempotentRetry
        ? `Already committed and pushed as \`${commitHash}\` (idempotent retry) — refreshed issue #${input.issue_number}.`
        : `Committed \`${commitHash}\` and updated issue #${input.issue_number}.`) + resultFiles + resultSkipped,
    }],
  };
}
