import { z } from "zod";
import { addIssueComment, getIssue, extractBranchFromBody } from "../github.js";
import { git, gitOutput, currentBranch } from "../git.js";
import { renderAutopilotDecisions, AUTOPILOT_DECISIONS_DESCRIPTION } from "../autopilot.js";

export const name = "commit_and_update";
export const description =
  "Stage all changes, build a commit message from the provided hint (or the changed file list), commit, push to the issue branch, and post a rich progress comment to the linked issue.";

export const inputSchema = z.object({
  issue_number: z.number().int().positive().describe("The issue number this work is against"),
  hint: z.string().optional().describe("Short description of what was done — used to build the commit message and issue comment"),
  autopilot_decisions: z.array(z.string()).optional().describe(AUTOPILOT_DECISIONS_DESCRIPTION),
});

const SUBJECT_MAX = 72;

/**
 * Split a free-text hint into a git commit subject + optional body.
 *
 * - Subject: the first **non-blank** line, truncated to ~72 chars at a **word
 *   boundary** (never mid-word) — a single unbreakable word longer than the
 *   limit is the only case that gets a hard cut. Leading blank lines are skipped
 *   so a hint like "\nAdd X" doesn't produce an empty subject (#236).
 * - Body: any lines after the subject line, plus whatever overflowed past the
 *   subject, joined as blank-line-separated paragraphs. `undefined` when the
 *   hint fits entirely in the subject, so a short single-line hint behaves
 *   exactly as before (subject only). (#228)
 *
 * A whitespace-only hint has no usable subject line and returns `{ subject: "" }`
 * — the handler guards against that by treating a blank hint as absent (#236).
 */
export function splitCommitMessage(hint: string): { subject: string; body?: string } {
  const lines = hint.split("\n");
  // Take the subject from the first non-blank line, not lines[0], so leading
  // blank lines don't yield an empty subject.
  const firstIdx = lines.findIndex((l) => l.trim() !== "");
  if (firstIdx === -1) return { subject: "" };
  const firstLine = lines[firstIdx].trim();
  const rest = lines.slice(firstIdx + 1).join("\n").trim();

  let subject = firstLine;
  let overflow = "";
  if (firstLine.length > SUBJECT_MAX) {
    const slice = firstLine.slice(0, SUBJECT_MAX);
    const lastSpace = slice.lastIndexOf(" ");
    if (lastSpace > 0) {
      subject = firstLine.slice(0, lastSpace).trimEnd();
      overflow = firstLine.slice(lastSpace + 1).trim();
    } else {
      // A single word longer than the limit — no boundary to break on.
      subject = slice;
      overflow = firstLine.slice(SUBJECT_MAX).trim();
    }
  }

  const body = [overflow, rest].filter(Boolean).join("\n\n");
  return body ? { subject, body } : { subject };
}

export async function handler(input: z.infer<typeof inputSchema>) {
  const issue = await getIssue(input.issue_number);
  const branchName = extractBranchFromBody(issue.body);

  // Files changed relative to HEAD — used for the commit message and comment.
  let changedFiles: string[] = [];
  try {
    changedFiles = gitOutput(["diff", "--name-only", "HEAD"]).split("\n").filter(Boolean);
  } catch {
    changedFiles = [];
  }

  // Trim so a whitespace-only hint (e.g. "   ") counts as absent — otherwise it
  // is truthy and yields an empty commit subject (#236).
  const hintText = (input.hint ?? "").trim();
  const filesText = changedFiles.length > 0 ? changedFiles.join(", ") : "various files";

  // Build the commit subject (and optional body) from the hint when provided,
  // else the file list. A long/multi-line hint is split into a word-boundary
  // subject plus a body rather than blindly sliced mid-word at 72 chars (#228).
  const { subject: commitMessage, body: commitBody } = hintText
    ? splitCommitMessage(hintText)
    : { subject: `chore: update ${filesText.slice(0, 60)}`, body: undefined };

  // Stage, commit, and push on the issue branch. Arguments are passed as an
  // array (no shell), so the hint and branch name can't be interpreted as
  // shell commands. The caller's original branch is restored afterward.
  const previousBranch = currentBranch();
  let commitHash = "";
  try {
    if (branchName && previousBranch !== branchName) {
      git(["checkout", branchName]);
    }
    git(["add", "-A"]);
    const commitArgs = ["commit", "-m", commitMessage];
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
  const filesSection = changedFiles.length > 0
    ? changedFiles.map((f) => `- \`${f}\``).join("\n")
    : "- No files detected";

  // Autopilot decisions report (#238) — logged onto the issue as work progresses
  // so a decide-then-report run leaves an audit trail at each step, not only at PR.
  const decisionsSection = renderAutopilotDecisions(input.autopilot_decisions);

  const comment = [
    `### 🔧 Commit update`,
    ``,
    `**Commit:** \`${commitHash}\``,
    `**Message:** ${commitMessage}`,
    `**Time:** ${timestamp}`,
    ``,
    `**Files changed:**`,
    filesSection,
    hintText ? `\n**Summary:** ${hintText}` : "",
    decisionsSection ? `\n${decisionsSection}` : "",
  ].filter((l) => l !== undefined && l !== "").join("\n");

  await addIssueComment(input.issue_number, comment);

  return {
    content: [{ type: "text" as const, text: `Committed \`${commitHash}\` and updated issue #${input.issue_number}.` }],
  };
}
