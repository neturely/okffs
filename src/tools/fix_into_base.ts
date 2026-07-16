import { z } from "zod";
import {
  getDefaultBranch,
  getBranchCommits,
  createPullRequest,
  getOpenPullRequestForBranch,
  updatePullRequest,
} from "../github.js";
import { git, currentBranch } from "../git.js";
import { config } from "../config.js";
import { addIssueToProject, getProjectMetadata, setProjectFieldValue } from "../projects.js";
import { handler as mergePullRequest } from "./merge_pull_request.js";

export const name = "fix_into_base";

export const description =
  "Open (and, when opted in, merge) an ISSUE-LESS fix PR into the base branch (e.g. develop) — the mirror of promote_branch, which does the base→protected promotion. " +
  "Use this for a small fix that doesn't warrant its own issue (e.g. review-comment cleanups) instead of dropping to raw `gh pr create` + `gh pr merge`: it is deliberately issue-less (no issue lookup, no Closes #N, no **Branch:** line required), authenticates with okffs's token, and — when the board is enabled — adds the PR to the Projects v2 board. " +
  "head defaults to the current branch; base defaults to OKFFS_BASE_BRANCH (or the repo default). It NEVER targets OKFFS_PROTECTED_BRANCH — that stays promote_branch + a manual, user-driven merge. " +
  "Opening the PR is always safe and unconditional. The merge is then attempted under the SAME gates and opt-in as merge_pull_request: it only merges when OKFFS_AUTO_MERGE_BASE=true, OKFFS_PROTECTED_BRANCH is set, and the PR is green (all checks pass), conflict-free, not blocked/behind, and has every review thread resolved — using OKFFS_BASE_MERGE_METHOD. If merge is off or a gate isn't met, the PR is left open with an actionable reason (re-run once it's green, or merge with merge_pull_request({ pr_number })).";

export const inputSchema = z.object({
  head: z
    .string()
    .optional()
    .describe("Branch to open the fix PR FROM (the PR head). Defaults to the current branch."),
  base: z
    .string()
    .optional()
    .describe("Branch to open the fix PR INTO (the PR base). Defaults to OKFFS_BASE_BRANCH, else the repo default. Never OKFFS_PROTECTED_BRANCH."),
  summary: z
    .string()
    .optional()
    .describe("Optional summary for the PR body. When omitted, the body lists the commits being landed."),
});

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

export async function handler(input: z.infer<typeof inputSchema>) {
  // head defaults to the checked-out branch — this tool lands the work you're on.
  const head = input.head ?? currentBranch() ?? undefined;
  if (!head) {
    return text("Could not determine the head branch to land — pass an explicit `head`.");
  }

  // base defaults to the base tier (OKFFS_BASE_BRANCH or the repo default).
  const base = input.base ?? (await getDefaultBranch());

  if (head === base) {
    return text(`Nothing to land — head and base are both \`${base}\`. Check out the fix branch first, or pass a distinct \`head\`.`);
  }

  // This tool is base-tier only. Promoting into the protected branch is
  // promote_branch's job (open) + a manual merge — never here.
  if (config.protectedBranch && base === config.protectedBranch) {
    return text(
      `[okffs] Refusing: \`${base}\` is OKFFS_PROTECTED_BRANCH. fix_into_base only lands into the base tier — use promote_branch to open a PR into the protected branch, then merge it yourself.`
    );
  }

  // Push the head so GitHub has the branch, then confirm it diverges from base.
  try {
    git(["push", "origin", head]);
  } catch (err) {
    return text(`[okffs] Could not push \`${head}\` to origin: ${err instanceof Error ? err.message : String(err)}`);
  }

  const commits = await getBranchCommits(head, base);
  if (commits.length === 0) {
    return text(`Nothing to land — \`${head}\` has no commits ahead of \`${base}\`. Commit your fix first — this is an issue-less flow, so use raw git (\`git add -A && git commit\`); commit_and_update won't work here because it requires an issue number.`);
  }

  const title = `Fix into ${base}: ${head}`;
  const changes = commits.map((c) => `- ${c.commit.message.split("\n")[0]}`).join("\n");
  const body = [
    input.summary ?? `Issue-less fix PR from \`${head}\` into \`${base}\`. No \`Closes #N\` — this is a standalone fix, not an issue.`,
    ``,
    `## Landing (${commits.length} commit${commits.length === 1 ? "" : "s"})`,
    changes,
  ].join("\n");

  // Reuse an already-open PR for this head→base rather than erroring (GitHub
  // permits only one open PR per head→base pair).
  const existing = await getOpenPullRequestForBranch(head, base);
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

  const notes: string[] = [];

  // Best-effort board placement — mirror promote_branch: a PR node id boards the
  // PR itself as a first-class card. Never blocks the PR/merge.
  if (config.projectEnabled) {
    try {
      const itemId = await addIssueToProject(pr.node_id);
      notes.push("Added the PR to the project board.");
      if (config.promotionStatus) {
        const meta = await getProjectMetadata();
        const optionId = meta.statusFieldId ? meta.statusOptions.get(config.promotionStatus) : undefined;
        if (meta.statusFieldId && optionId) {
          await setProjectFieldValue(itemId, meta.statusFieldId, optionId);
          notes.push(`Moved the card to "${config.promotionStatus}".`);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[okffs] Failed to add fix PR #${pr.number} to the board:`, msg);
      notes.push(`⚠️ Could not add the PR to the board: ${msg}`);
    }
  }

  const lines = [`Fix PR #${pr.number} ${action}: ${pr.html_url}`];
  if (notes.length > 0) lines.push(...notes);

  // Merge step: reuse merge_pull_request's gating verbatim via its pr_number
  // mode. It self-gates on OKFFS_AUTO_MERGE_BASE and every green check, so when
  // merge is off or the PR isn't green it declines with an actionable reason and
  // the PR stays open (re-run once green, or call merge_pull_request directly).
  const mergeResult = await mergePullRequest({ pr_number: pr.number });
  const mergeText = mergeResult.content.map((c) => c.text).join("\n");
  lines.push("", `— Merge attempt —`, mergeText);

  return text(lines.join("\n"));
}
