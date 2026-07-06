import { z } from "zod";
import {
  getIssue,
  extractBranchFromBody,
  getDefaultBranch,
  getBranchCommits,
  getIssueComments,
  createPullRequest,
  createDraftPullRequest,
  getOpenPullRequestForBranch,
  updatePullRequest,
  markPullRequestReady,
  getRepoDefaultBranch,
  addIssueComment,
  updateIssueBody,
} from "../github.js";
import { config } from "../config.js";
import { updateProjectDocs } from "../docs.js";
import { git, currentBranch, pushEmptyInitCommit } from "../git.js";

export const name = "create_pull_request";

export const description =
  "Create a pull request for the current issue branch. Reads the issue, its comments, and commits to generate a PR title and body. Always includes Closes #N. If OKFFS_UPDATE_DOCS is true, writes a per-issue changelog fragment under .changes/unreleased/ (assembled into CHANGELOG.md at release time by prepare_release — not a direct CHANGELOG.md edit), plus SECURITY.md for security-related changes, and commits them onto the branch before creating the PR. If a PR already exists for the branch (e.g. a draft opened by create_issue under OKFFS_AUTO_PR=true), it is updated and marked ready for review instead of erroring. By default, a branch with no commits ahead of base is refused (a PR needs a diff); pass allow_empty: true to instead push an empty init commit so the branch diverges and open a **draft** tracking PR — the same mechanism create_issue uses under OKFFS_AUTO_PR, for backfilling a PR onto a branch that was created empty. Posts a summary comment to the issue. If the issue has no okffs-created branch link (no **Branch:** line — e.g. a pre-okffs issue or a hand-made branch), pass an explicit branch, or check out a branch named {issue-number}-… and okffs infers it; either way it backfills the **Branch:** line. If the PR targets OKFFS_PROTECTED_BRANCH, okffs still opens it (opening is safe and reversible) and adds a reminder that the merge/tag stay with the user — OKFFS_PROTECTED_BRANCH governs autonomous merging, never PR creation.";

export const inputSchema = z.object({
  issue_number: z.number().int().positive().describe("The issue number to create a PR for"),
  summary: z.string().optional().describe("Optional summary of what was done — used in PR body and issue comment"),
  branch: z.string().optional().describe("Branch to open the PR from, for issues whose branch okffs didn't create (no **Branch:** line in the body). Usually unnecessary — okffs-created issues carry the link, and a checked-out branch named {issue-number}-… is inferred automatically. When used, okffs backfills the **Branch:** line onto the issue."),
  allow_empty: z.boolean().optional().describe("When the branch has no commits ahead of base, push an empty init commit so it diverges and open a DRAFT tracking PR instead of refusing. Opt-in (default false) — use to backfill a PR onto a branch that was created empty. Ignored when the branch already has commits."),
});

export async function handler(input: z.infer<typeof inputSchema>) {
  const issue = await getIssue(input.issue_number);
  let branchName = extractBranchFromBody(issue.body);

  // Fallback for issues whose branch okffs didn't create (no **Branch:** line) —
  // e.g. pre-okffs issues or a branch made by hand with `git checkout -b`. Use an
  // explicit `branch`, or infer it from the current git branch when it follows the
  // {issue-number}-… convention, then backfill the **Branch:** line so later okffs
  // calls resolve it automatically (#173).
  if (!branchName) {
    const current = currentBranch();
    const inferred = current && current.startsWith(`${input.issue_number}-`) ? current : null;
    const fallback = input.branch ?? inferred;
    if (fallback) {
      branchName = fallback;
      // trimEnd only — trimming both ends could strip leading whitespace the user
      // intentionally put in the issue body.
      const base = (issue.body ?? "").trimEnd();
      const newBody = base ? `${base}\n\n**Branch:** \`${branchName}\`` : `**Branch:** \`${branchName}\``;
      try {
        await updateIssueBody(input.issue_number, newBody);
      } catch (err) {
        // Non-fatal: proceed with the resolved branch even if the backfill fails.
        console.warn(`[okffs] Could not backfill the **Branch:** line on #${input.issue_number}:`, err instanceof Error ? err.message : err);
      }
    }
  }

  if (!branchName) {
    await addIssueComment(
      input.issue_number,
      `PR not created — issue #${input.issue_number} has no associated branch. Pass a \`branch\` argument, or check out the issue's branch (named \`${input.issue_number}-…\`) so okffs can infer it. (okffs-created issues carry a **Branch:** line automatically.)`
    );
    return {
      content: [{ type: "text" as const, text: `Issue #${input.issue_number} has no associated branch. Pass a \`branch\` argument or check out its branch, then retry.` }],
    };
  }

  const baseBranch = await getDefaultBranch();

  // OKFFS_PROTECTED_BRANCH governs autonomous *merging*, not PR *creation*.
  // Opening a PR into a protected branch is non-destructive and reversible — the
  // merge is the actual risk, and it's already gated by GitHub branch protection
  // plus a manual merge by the user. okffs has no merge tool, so the invariant
  // "never autonomously merge into the protected branch" holds for free; we do
  // not block or gate opening the PR here. When the PR targets the protected
  // branch we still surface a reminder that the merge/tag stay with the user
  // (#181, revisiting the #152 behaviour).
  const protectedNote =
    config.protectedBranch && baseBranch === config.protectedBranch
      ? `\n\n🔒 This PR targets \`${baseBranch}\` (OKFFS_PROTECTED_BRANCH). okffs opened it but will **not** merge or tag — that stays with you.`
      : "";

  // `Closes #N` only auto-closes the issue when the PR merges into the repo's
  // default branch. If OKFFS_BASE_BRANCH targets a non-default branch (e.g.
  // develop), warn that the issue must be closed manually after merge.
  let autoCloseNote = "";
  if (config.baseBranch) {
    const repoDefault = await getRepoDefaultBranch();
    if (baseBranch !== repoDefault) {
      autoCloseNote =
        `\n\n⚠️ This PR targets \`${baseBranch}\`, not the default branch \`${repoDefault}\` — ` +
        `merging will **not** auto-close #${input.issue_number}. Close it manually with \`close_issue\` after merge.`;
    }
  }

  let commits = await getBranchCommits(branchName, baseBranch);
  const comments = await getIssueComments(input.issue_number);

  // Whether this is a backfilled tracking PR (empty branch + allow_empty). Such
  // PRs are opened as drafts — there's no real work to review yet.
  let draftMode = false;

  if (commits.length === 0) {
    if (!input.allow_empty) {
      await addIssueComment(
        input.issue_number,
        `PR not created — branch \`${branchName}\` has no commits ahead of \`${baseBranch}\`. Push commits to the branch first, or pass \`allow_empty: true\` to open a draft tracking PR.`
      );
      return {
        content: [{ type: "text" as const, text: `PR not created — branch \`${branchName}\` has no commits ahead of \`${baseBranch}\`. Push commits first, or pass allow_empty: true for a draft tracking PR.` }],
      };
    }
    // allow_empty: push an empty init commit so the branch diverges from base,
    // then open a draft PR — the same mechanism create_issue uses under
    // OKFFS_AUTO_PR (shared helper), applied to an already-created empty branch.
    try {
      pushEmptyInitCommit(branchName, input.issue_number);
    } catch (err) {
      await addIssueComment(
        input.issue_number,
        `PR not created — branch \`${branchName}\` is empty and okffs could not push an init commit to diverge it from \`${baseBranch}\`. Push a commit manually, then retry.`
      );
      return {
        content: [{ type: "text" as const, text: `PR not created — could not push an empty init commit to \`${branchName}\`: ${err instanceof Error ? err.message : String(err)}` }],
      };
    }
    draftMode = true;
    // Re-read so the PR body's Changes section reflects the new init commit.
    commits = await getBranchCommits(branchName, baseBranch);
  }

  const title = `Close #${input.issue_number} - ${issue.title}`;

  const cleanedDescription = issue.body
    ? issue.body
        .replace(/\*\*Branch:\*\*\s*`[^`]+`/g, "")
        .replace(/## Relationships[\s\S]*/g, "")
        .trim()
    : issue.title;

  const summarySection = input.summary ?? cleanedDescription;

  const changesSection = commits.length > 0
    ? commits.map((c) => `- ${c.commit.message.split("\n")[0]}`).join("\n")
    : "- No commits found";

  const recentComments = comments.slice(0, 3).reverse();
  const commentsSection = recentComments.length > 0
    ? recentComments
        .map((c) => `\n\`\`\`\n${c.body}\n\`\`\`\n`)
        .join("\n\n---\n\n")
    : null;

  const bodyParts = [
    `## Summary`,
    summarySection,
    ``,
    `## Changes`,
    changesSection,
  ];

  if (commentsSection) {
    bodyParts.push(``, `## Issue comments`, commentsSection);
  }

  bodyParts.push(``, `Closes #${input.issue_number}`);

  const body = bodyParts.join("\n");

  let updatedDocs: string[] = [];
  if (config.updateDocs) {
    updatedDocs = await updateProjectDocs({
      trigger: "create_pull_request",
      issueNumber: input.issue_number,
      issueTitle: issue.title,
      summary: input.summary ?? cleanedDescription,
      branchName,
    });
  }

  // Commit any doc updates and push the branch before opening the PR. Operate on
  // branchName explicitly so we never commit/push the wrong branch, and restore
  // the caller's original branch afterward.
  const previousBranch = currentBranch();
  try {
    git(["checkout", branchName]);
  } catch (err) {
    console.warn(`[okffs] Failed to checkout branch ${branchName}.`, err instanceof Error ? err.message : err);
    await addIssueComment(
      input.issue_number,
      `PR not created — could not switch to branch \`${branchName}\` locally. Check out the branch, then run \`create_pull_request\` again.`
    );
    return {
      content: [{ type: "text" as const, text: `PR not created — could not switch to branch \`${branchName}\` locally.` }],
    };
  }

  try {
    // If docs were updated, commit all of them so they're in the PR diff —
    // not just CHANGELOG.md (updateProjectDocs may also touch CLAUDE.md,
    // CONTRIBUTING.md, SECURITY.md). A failure here must never block PR creation.
    if (updatedDocs.length > 0) {
      try {
        const names = updatedDocs.map((p) => p.split(/[\\/]/).pop()).join(", ");
        git(["add", ...updatedDocs]);
        git(["commit", "-m", `docs: update ${names} for #${input.issue_number}`]);
      } catch (err) {
        console.warn(
          `[okffs] Failed to commit doc updates for #${input.issue_number} — continuing without them.`,
          err instanceof Error ? err.message : err
        );
      }
    }

    // Push so GitHub sees the commits before PR creation. If commits exist only
    // locally, the API would report no commits ahead of base.
    try {
      git(["push", "origin", branchName]);
    } catch (err) {
      console.warn(
        `[okffs] Failed to push branch ${branchName} to remote.`,
        err instanceof Error ? err.message : err
      );
      await addIssueComment(
        input.issue_number,
        `PR not created — could not push branch \`${branchName}\` to remote. Please push manually (\`git push origin ${branchName}\`) then run \`create_pull_request\` to continue.`
      );
      return {
        content: [{ type: "text" as const, text: `PR not created — could not push branch \`${branchName}\` to remote. Push manually (\`git push origin ${branchName}\`) then run create_pull_request to continue.` }],
      };
    }
  } finally {
    if (previousBranch && previousBranch !== branchName) {
      try {
        git(["checkout", previousBranch]);
      } catch (err) {
        console.warn(`[okffs] Failed to restore branch ${previousBranch}.`, err instanceof Error ? err.message : err);
      }
    }
  }

  // Under OKFFS_AUTO_PR=true a draft PR already exists for this branch (opened by
  // create_issue), so creating one would fail. Detect and finalize it instead:
  // update title/body and mark it ready for review. Otherwise create a new PR.
  const existing = await getOpenPullRequestForBranch(branchName);
  let pr: { number: number; html_url: string };
  let action: string;

  if (existing) {
    await updatePullRequest(existing.number, { title, body });
    if (existing.draft) {
      try {
        await markPullRequestReady(existing.node_id);
      } catch (err) {
        console.warn(
          `[okffs] Failed to mark PR #${existing.number} ready for review — leaving it as a draft.`,
          err instanceof Error ? err.message : err
        );
      }
    }
    pr = { number: existing.number, html_url: existing.html_url };
    action = existing.draft ? "finalized (marked ready)" : "updated";
  } else if (draftMode) {
    // Empty-branch backfill — open a draft tracking PR (createDraftPullRequest
    // returns just number + html_url, which is all we surface below).
    pr = await createDraftPullRequest(title, body, branchName, baseBranch);
    action = "created (draft tracking PR)";
  } else {
    pr = await createPullRequest(title, body, branchName, baseBranch);
    action = "created";
  }

  const comment = [
    `PR ${action}: ${pr.html_url}`,
    ``,
    body,
  ].join("\n") + autoCloseNote + protectedNote;
  await addIssueComment(input.issue_number, comment);

  // OKFFS_UPDATE_GUIDANCE: nudge the agent to keep CLAUDE.md in sync with any
  // new/changed functionality. Pushing the edit to this branch updates the PR.
  const guidanceNote = config.updateGuidance
    ? `\n\n💡 OKFFS_UPDATE_GUIDANCE is on: if this PR adds or changes functionality, config, or conventions, update CLAUDE.md to match (run the update_guidance prompt) and commit it to \`${branchName}\` so it's part of this PR.`
    : "";

  return {
    content: [{ type: "text" as const, text: `PR #${pr.number} ${action}: ${pr.html_url}${autoCloseNote}${protectedNote}${guidanceNote}` }],
  };
}
