import { z } from "zod";
import {
  getDefaultBranch,
  getRepoDefaultBranch,
  getBranchCommits,
  createPullRequest,
  getOpenPullRequestForBranch,
  updatePullRequest,
  requestReviewers,
} from "../github.js";
import { config } from "../config.js";
import { addIssueToProject, getProjectMetadata, setProjectFieldValue } from "../projects.js";

export const name = "promote_branch";

export const description =
  "Open the release/promotion pull request from one long-lived branch into another — e.g. develop → main. " +
  "Use this instead of raw `gh pr create` or create_pull_request for a base→protected promotion: it is deliberately " +
  "ISSUE-LESS (no issue lookup, no Closes #N), authenticates with okffs's token, and adds the PR itself to the " +
  "Projects v2 board so the gate is visible. By default it promotes OKFFS_BASE_BRANCH (head, e.g. develop) into " +
  "OKFFS_PROTECTED_BRANCH — or the repo default branch if no protected branch is set — but head/base can be overridden. " +
  "No confirmation is needed: opening a PR is safe and reversible. okffs opens the PR and hands back — it NEVER merges " +
  "or tags; that stays with the user. If a promotion PR is already open for the head branch it is updated and returned " +
  "rather than erroring (GitHub allows only one open PR per head→base pair). When OKFFS_PROMOTION_REVIEWERS is set " +
  "(e.g. Copilot), those reviewers are requested; when OKFFS_PROMOTION_STATUS is set, the board card lands in that column.";

export const inputSchema = z.object({
  head: z
    .string()
    .optional()
    .describe("Branch to promote FROM (the PR head). Defaults to OKFFS_BASE_BRANCH, e.g. develop."),
  base: z
    .string()
    .optional()
    .describe("Branch to promote INTO (the PR base). Defaults to OKFFS_PROTECTED_BRANCH, else the repo default branch, e.g. main."),
  summary: z
    .string()
    .optional()
    .describe("Optional summary for the PR body. When omitted, the body lists the commits being promoted."),
});

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

export async function handler(input: z.infer<typeof inputSchema>) {
  // head defaults to the integration branch (OKFFS_BASE_BRANCH). getDefaultBranch()
  // returns it when set, otherwise the repo default — which is the promotion
  // *target*, not a source, so require an explicit head in that case.
  const head = input.head ?? config.baseBranch;
  if (!head) {
    return text(
      "No head branch to promote — set OKFFS_BASE_BRANCH (e.g. develop) or pass an explicit `head`."
    );
  }

  // base defaults to the protected branch (the release/publish branch), else the
  // repo's real default branch.
  const base = input.base ?? config.protectedBranch ?? (await getRepoDefaultBranch());

  if (head === base) {
    return text(
      `Nothing to promote — head and base are both \`${base}\`. Set OKFFS_BASE_BRANCH and OKFFS_PROTECTED_BRANCH to different branches, or pass distinct head/base.`
    );
  }

  // Report whether the target is the protected branch — informational only. Opening
  // the PR is never gated (the merge/tag are the user-gated steps).
  const targetsProtected = config.protectedBranch && base === config.protectedBranch;

  const commits = await getBranchCommits(head, base);
  if (commits.length === 0) {
    return text(`Nothing to promote — \`${head}\` has no commits ahead of \`${base}\`.`);
  }

  const title = `Promote ${head} → ${base}`;
  const changes = commits.map((c) => `- ${c.commit.message.split("\n")[0]}`).join("\n");
  const body = [
    input.summary ?? `Promotion PR from \`${head}\` into \`${base}\`. No \`Closes #N\` — this is a branch promotion, not an issue.`,
    ``,
    `## Promoting (${commits.length} commit${commits.length === 1 ? "" : "s"})`,
    changes,
  ].join("\n");

  // Reuse an already-open promotion PR for this head rather than erroring — GitHub
  // permits only one open PR per head→base pair.
  const existing = await getOpenPullRequestForBranch(head);
  let pr: { number: number; html_url: string; node_id: string };
  let action: string;
  if (existing) {
    await updatePullRequest(existing.number, { title, body });
    pr = { number: existing.number, html_url: existing.html_url, node_id: existing.node_id };
    action = "updated";
  } else {
    pr = await createPullRequest(title, body, head, base);
    action = "created";
  }

  // Best-effort side effects — mirror the create_issue autoPR/board pattern: a
  // failure warns with an [okffs] prefix, is surfaced in the response, and never
  // fails the promotion.
  const notes: string[] = [];

  if (config.promotionReviewers.length > 0) {
    try {
      await requestReviewers(pr.number, config.promotionReviewers);
      notes.push(`Requested review from: ${config.promotionReviewers.join(", ")}.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[okffs] Failed to request reviewers on PR #${pr.number}:`, msg);
      notes.push(`⚠️ Could not request reviewers (${config.promotionReviewers.join(", ")}): ${msg}`);
    }
  }

  if (config.projectEnabled) {
    try {
      // addIssueToProject takes any content node id — a PR node id boards the PR
      // itself as a first-class card (Projects v2 accepts PRs, not just issues).
      const itemId = await addIssueToProject(pr.node_id);
      notes.push(`Added the PR to the project board.`);
      if (config.promotionStatus) {
        const meta = await getProjectMetadata();
        const optionId = meta.statusFieldId ? meta.statusOptions.get(config.promotionStatus) : undefined;
        if (meta.statusFieldId && optionId) {
          await setProjectFieldValue(itemId, meta.statusFieldId, optionId);
          notes.push(`Moved the card to "${config.promotionStatus}".`);
        } else {
          const opts = [...meta.statusOptions.keys()].join(", ") || "none";
          notes.push(`⚠️ OKFFS_PROMOTION_STATUS "${config.promotionStatus}" is not a board column (available: ${opts}) — left the card in its default column.`);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[okffs] Failed to add promotion PR #${pr.number} to the board:`, msg);
      notes.push(`⚠️ Could not add the PR to the board: ${msg}`);
    }
  }

  const handBack = targetsProtected
    ? `\n\n🔒 \`${base}\` is OKFFS_PROTECTED_BRANCH — okffs opened this PR but will NOT merge or tag. Review it, then merge and tag yourself.`
    : `\n\nReview and merge when ready — okffs does not merge or tag.`;

  const lines = [`Promotion PR #${pr.number} ${action}: ${pr.html_url}`];
  if (notes.length > 0) lines.push("", ...notes);
  return text(lines.join("\n") + handBack);
}
