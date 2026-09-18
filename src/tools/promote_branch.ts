import { z } from "zod";
import {
  getRepoDefaultBranch,
  getBranchCommits,
  createPullRequest,
  getOpenPullRequestForBranch,
  updatePullRequest,
  requestReviewers,
  getPullRequestReview,
  getLatestMergedPullRequestForBranch,
  getCommitParentSha,
  getTagSha,
  createTag,
  getFileContentAtRef,
  getRef,
  getPullRequest,
  mergePullRequest,
  type PullRequestDetail,
} from "../github.js";
import { verifyMergeable, prLabel } from "../pr_gates.js";
import { decideTags, renderTagReport, type AppVersionProbe } from "../tagging.js";
import { probeAppVersions } from "../app_versions.js";
import { summarizeReleases, renderReleaseSection, renderReleaseNote } from "../release_summary.js";
import { config } from "../config.js";
import { addIssueToProject, getProjectMetadata, setProjectFieldValue } from "../projects.js";
import { summarizeReviewThreads, renderReviewGateWarning } from "../review_gate.js";

export const name = "promote_branch";

export const description =
  "Open the release/promotion pull request from one long-lived branch into another — e.g. develop → main. " +
  "Use this instead of raw `gh pr create` or create_pull_request for a base→protected promotion: it is deliberately " +
  "ISSUE-LESS (no issue lookup, no Closes #N), authenticates with okffs's token, and adds the PR itself to the " +
  "Projects v2 board so the gate is visible. By default it promotes OKFFS_BASE_BRANCH (head, e.g. develop) into " +
  "OKFFS_PROTECTED_BRANCH — or the repo default branch if no protected branch is set — but head/base can be overridden. " +
  "No confirmation is needed: opening a PR is safe and reversible. okffs opens the PR and hands back — it NEVER merges " +
  "or tags; that stays with the user. If a promotion PR is already open for the head branch it is updated and returned " +
  "rather than erroring (GitHub allows only one open PR per head→base pair). When OKFFS_PROMOTION_AUTO_REVIEW is true, " +
  "OKFFS_PROMOTION_REVIEWERS (e.g. Copilot) are requested — only on a newly-created gate PR, never on re-runs, to avoid " +
  "repeat (possibly billable) reviews; when OKFFS_PROMOTION_STATUS is set, the board card lands in that column. " +
  "A re-run on an existing gate PR also reports its unresolved review threads (e.g. Copilot feedback that landed after " +
  "the review was requested) and points at the address_pr_review loop — so re-running promote_branch is the way to " +
  "check the release gate before handing the merge to the user. With OKFFS_TAG_RELEASE=true, a re-run AFTER the gate PR " +
  "has been merged tags the release(s) it carried (v1.2.0, or finance-1.2.0 per app whose version changed) on the merge commit. " +
  "With OKFFS_AUTO_MERGE_PROTECTED=true, a re-run on an EXISTING gate PR merges it into the protected branch (OKFFS_PROTECTED_MERGE_METHOD) " +
  "once every gate passes — open, non-draft, no conflicts, all checks green, no pending requested review, every thread resolved — and, " +
  "with OKFFS_TAG_RELEASE too, tags in the same call: the fully handled promotion. Never on the call that creates the PR.";

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
  // head defaults to the integration branch (OKFFS_BASE_BRANCH). We read
  // config.baseBranch directly rather than getDefaultBranch(), because that
  // helper falls back to the repo default branch — which is the promotion
  // *target*, not a source. If neither an explicit head nor OKFFS_BASE_BRANCH
  // is set, require the caller to pass one.
  const head = input.head ?? config.baseBranch;
  if (!head) {
    return text(
      "No head branch to promote — set OKFFS_BASE_BRANCH (e.g. develop) or pass an explicit `head`."
    );
  }

  // base defaults to the protected branch (the release/publish branch), else the
  // repo's real default branch. Fetch the repo default up front — also used below
  // to decide whether closing keywords in the PR body could fire.
  const repoDefault = await getRepoDefaultBranch();
  const base = input.base ?? config.protectedBranch ?? repoDefault;

  if (head === base) {
    return text(
      `Nothing to promote — head and base are both \`${base}\`. Set OKFFS_BASE_BRANCH and OKFFS_PROTECTED_BRANCH to different branches, or pass distinct head/base.`
    );
  }

  // Report whether the target is the protected branch — informational only. Opening
  // the PR is never gated (the merge/tag are the user-gated steps).
  const targetsProtected = config.protectedBranch && base === config.protectedBranch;

  // Post-merge tagging (#310): before looking at what is left to promote, tag
  // the release(s) carried by the LAST merged head→base PR when opted in. Runs
  // on every call so the natural "re-run promote_branch after merging" step is
  // enough; idempotent (an existing tag at the merge commit is a quiet no-op).
  // Both opt-ins are scoped to the CONFIGURED protected branch: an explicit
  // non-protected base (or no protected branch at all) never tags or merges.
  const tagNote = config.tagRelease && targetsProtected ? await tagMergedPromotion(head, base) : null;

  const commits = await getBranchCommits(head, base);
  if (commits.length === 0) {
    return text(`Nothing to promote — \`${head}\` has no commits ahead of \`${base}\`.` + (tagNote ? `\n\n${tagNote}` : ""));
  }

  const title = `Promote ${head} → ${base}`;

  // GitHub closing keywords (Close/Closes/Closed/Fix/Fixes/Fixed/Resolve/Resolves/
  // Resolved #N) in a PR body only auto-close when the PR merges into the repo's
  // DEFAULT branch. The list below echoes commit subjects verbatim, and okffs's own
  // commit titles contain `Close #N` — so if this promotion targets the default
  // branch, merging it could unintentionally close whatever issues those subjects
  // reference. When base is the default branch, defuse issue refs in the list
  // (wrap them in backticks so they're inert, non-closing text); otherwise leave
  // them verbatim (links intact, and the keywords are inert anyway). Keeps the
  // basic behaviour, guards the edge case (#188).
  const baseIsDefault = base === repoDefault;
  const subjectOf = (c: { commit: { message: string } }) => {
    const subject = c.commit.message.split("\n")[0];
    return baseIsDefault ? subject.replace(/#(\d+)/g, "`#$1`") : subject;
  };
  const changes = commits.map((c) => `- ${subjectOf(c)}`).join("\n");

  // Releases carried by this promotion (#312): apps whose version differs
  // between the head tip and the base tip — the same rule the post-merge
  // tagging applies, so the section names exactly the tags the merge yields.
  // Best-effort: a probe failure drops the section, never the PR.
  let releaseSection: string | null = null;
  let releaseNote: string | null = null;
  try {
    const [headRef, baseRef] = await Promise.all([getRef(head), getRef(base)]);
    const pairs = await probeAppVersions(headRef.object.sha, baseRef.object.sha);
    const entries = summarizeReleases(pairs.map((p) => ({ name: p.name, tagPrefix: p.tagPrefix, versionAtHead: p.versionAtA, versionAtBase: p.versionAtB })));
    releaseSection = renderReleaseSection(entries);
    releaseNote = renderReleaseNote(entries, config.tagRelease);
  } catch (err) {
    console.warn(`[okffs] Could not summarise releases for ${head} → ${base}:`, err instanceof Error ? err.message : err);
  }

  const body = [
    input.summary ?? `Promotion PR from \`${head}\` into \`${base}\`. No \`Closes #N\` — this is a branch promotion, not an issue.`,
    ``,
    ...(releaseSection ? [releaseSection, ``] : []),
    `## Promoting (${commits.length} commit${commits.length === 1 ? "" : "s"})`,
    changes,
  ].join("\n");

  // Reuse an already-open promotion PR for this head→base rather than erroring —
  // GitHub permits only one open PR per head→base pair. Match on base too: a
  // long-lived head like `develop` can have open PRs into several bases, so
  // head-only matching could reuse/overwrite the wrong PR.
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

  // Best-effort side effects — mirror the create_issue autoPR/board pattern: a
  // failure warns with an [okffs] prefix, is surfaced in the response, and never
  // fails the promotion.
  const notes: string[] = [];
  if (releaseNote) notes.push(releaseNote);

  // Auto-request reviewers only when explicitly opted in (OKFFS_PROMOTION_AUTO_REVIEW)
  // and only on a NEWLY-created gate PR — never on updates/re-runs — so a paid
  // reviewer (e.g. Copilot) isn't re-triggered and re-billed each time. On an update
  // we note that reviewers weren't re-requested and how to trigger one manually.
  if (config.promotionAutoReview && config.promotionReviewers.length > 0) {
    if (action === "created") {
      try {
        await requestReviewers(pr.number, config.promotionReviewers);
        notes.push(`Requested review from: ${config.promotionReviewers.join(", ")}.`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[okffs] Failed to request reviewers on PR #${pr.number}:`, msg);
        notes.push(`⚠️ Could not request reviewers (${config.promotionReviewers.join(", ")}): ${msg}`);
      }
    } else {
      notes.push(
        `Reviewers not re-requested on this update (auto-review requests on create only, to avoid repeat cost). ` +
        `Re-request manually if you want a fresh review.`
      );
    }
  }

  // On a re-run over an existing gate PR, surface any review feedback that has
  // landed since — the requested (possibly billable) review is useless if nobody
  // ever checks back for it (#302). Best-effort, like the other side effects; a
  // freshly-created PR can't have threads yet, so skip the extra call there.
  if (action === "updated") {
    try {
      const review = await getPullRequestReview(pr.number);
      const warning = renderReviewGateWarning(pr.number, summarizeReviewThreads(review.threads));
      if (warning) notes.push(warning);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[okffs] Failed to check review threads on PR #${pr.number}:`, msg);
      notes.push(`⚠️ Could not check the PR's review threads: ${msg}`);
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

  // Opt-in protected merge (#311): only on a re-run over an EXISTING gate PR —
  // never on the creating call, so a requested (e.g. Copilot) review has a
  // chance to land and the pending-review gate can see it. Every refusal is
  // reported, not prompted; the PR stays open for the next re-run.
  let mergedNow = false;
  if (action === "updated" && config.autoMergeProtected && targetsProtected) {
    const outcome = await mergeGatePullRequest(pr.number, base);
    notes.push(outcome.note);
    mergedNow = outcome.merged;
    if (mergedNow && config.tagRelease && targetsProtected) {
      const afterMergeTag = await tagMergedPromotion(head, base);
      if (afterMergeTag) notes.push(afterMergeTag);
    }
  }

  if (mergedNow) {
    const lines = [`Promotion PR #${pr.number} merged into \`${base}\`: ${pr.html_url}`];
    if (tagNote) notes.unshift(tagNote);
    lines.push("", ...notes);
    if (!config.tagRelease) lines.push("", `Tag the release yourself (OKFFS_TAG_RELEASE is off).`);
    return text(lines.join("\n"));
  }

  const mergeStep = config.autoMergeProtected && targetsProtected
    ? `Re-run promote_branch once the review has landed and been addressed — OKFFS_AUTO_MERGE_PROTECTED=true merges it when every gate passes${config.tagRelease ? " and OKFFS_TAG_RELEASE=true then tags" : ""}.`
    : null;
  const tagStep = config.tagRelease
    ? `After you merge, re-run promote_branch — OKFFS_TAG_RELEASE=true tags the release(s) it carried.`
    : `then merge and tag yourself.`;
  const handBack = mergeStep
    ? `\n\n🔒 \`${base}\`: ${mergeStep}`
    : targetsProtected
      ? `\n\n🔒 \`${base}\` is OKFFS_PROTECTED_BRANCH — okffs opened this PR but will NOT merge${config.tagRelease ? "" : " or tag"}. Review it, ${tagStep}`
      : `\n\nReview and merge when ready — okffs does not merge${config.tagRelease ? "" : " or tag"}.${config.tagRelease ? ` ${tagStep}` : ""}`;

  const lines = [`Promotion PR #${pr.number} ${action}: ${pr.html_url}`];
  if (tagNote) notes.unshift(tagNote);
  if (notes.length > 0) lines.push("", ...notes);
  return text(lines.join("\n") + handBack);
}


// Tag the release(s) carried by the latest merged head→base PR. Best-effort:
// any failure is reported in the note and never blocks the promotion itself.
async function tagMergedPromotion(head: string, base: string): Promise<string | null> {
  try {
    const merged = await getLatestMergedPullRequestForBranch(head, base);
    if (!merged || !merged.merge_commit_sha) return null;
    const mergeSha = merged.merge_commit_sha;
    const [parentSha, tip] = await Promise.all([getCommitParentSha(mergeSha), getRef(base)]);
    const probes: AppVersionProbe[] = (await probeAppVersions(mergeSha, parentSha)).map((p) => ({
      name: p.name,
      tagPrefix: p.tagPrefix,
      versionAtMerge: p.versionAtA,
      versionAtParent: p.versionAtB,
    }));
    const candidates = probes.filter((p) => p.versionAtMerge).map((p) => `${p.tagPrefix}${p.versionAtMerge}`);
    const existingTags = new Map<string, string>();
    for (const tag of candidates) {
      const sha = await getTagSha(tag);
      if (sha) existingTags.set(tag, sha);
    }
    const decisions = decideTags(probes, { mergeCommitSha: mergeSha, protectedTipSha: tip.object.sha, existingTags });
    const failures: Array<{ tag: string; error: string }> = [];
    for (const d of decisions) {
      if (d.action !== "tag") continue;
      try {
        await createTag(d.tag, d.sha);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[okffs] Failed to create tag ${d.tag}:`, msg);
        failures.push({ tag: d.tag, error: msg });
      }
    }
    return renderTagReport(merged.number, decisions, failures);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[okffs] Release tagging check failed:`, msg);
    return `⚠️ OKFFS_TAG_RELEASE: could not check/tag the last merged promotion: ${msg}`;
  }
}


// Poll until GitHub has computed `mergeable` (null right after a push).
async function getPullRequestWhenComputed(prNumber: number): Promise<PullRequestDetail> {
  let detail = await getPullRequest(prNumber);
  for (let i = 0; detail.mergeable === null && i < 5; i++) {
    await new Promise((r) => setTimeout(r, 800));
    detail = await getPullRequest(prNumber);
  }
  return detail;
}

// Merge the gate PR into the protected tier under the shared gates (#311).
async function mergeGatePullRequest(prNumber: number, base: string): Promise<{ merged: boolean; note: string }> {
  try {
    const pr = await getPullRequestWhenComputed(prNumber);
    const refusal = await verifyMergeable(pr, base);
    if (refusal) return { merged: false, note: `${refusal} (OKFFS_AUTO_MERGE_PROTECTED is on — re-run promote_branch once addressed.)` };
    const method = config.protectedMergeMethod;
    const result = await mergePullRequest(pr.number, method);
    if (!result.merged) {
      return { merged: false, note: `⚠️ GitHub did not merge ${prLabel(pr)}: ${result.message || "no reason given"} — nothing was tagged.` };
    }
    return { merged: true, note: `✅ Merged ${prLabel(pr)} into \`${base}\` via ${method} (OKFFS_AUTO_MERGE_PROTECTED=true; all gates passed).` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[okffs] Protected merge of PR #${prNumber} failed:`, msg);
    return { merged: false, note: `⚠️ Could not merge PR #${prNumber} into \`${base}\`: ${msg}` };
  }
}
