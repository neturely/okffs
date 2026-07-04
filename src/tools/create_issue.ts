import { z } from "zod";
import { createIssue, updateIssueBody, getDefaultBranch, getRef, createBranch, buildBranchName, createDraftPullRequest } from "../github.js";
import { config } from "../config.js";
import { git, currentBranch } from "../git.js";
import {
  boardAutoAddEnabled,
  addIssueToBoard,
  applyInitialStatus,
  renderBoardLines,
  type BoardAddResult,
  type InitialStatusResult,
} from "../board.js";

export const name = "create_issue";

// Priority/Effort inference guidance is woven into the tool description so Claude
// uses its own judgement to triage the issue it's creating (like it already does
// for labels), falling back to OKFFS_DEFAULT_* only when it can't tell. Toggle per
// field with OKFFS_INFER_PRIORITY / OKFFS_INFER_EFFORT (default on).
function inferenceGuidance(): string {
  const bits: string[] = [];
  if (config.inferPriority) {
    bits.push(
      "infer a `priority` for the issue from its urgency and impact (typical scale: Urgent, High, Medium, Low)"
    );
  }
  if (config.inferEffort) {
    bits.push(
      "infer an `effort` from the expected amount of work (typical scale: High, Medium, Low)"
    );
  }
  if (bits.length === 0) return "";
  return (
    ` Also ${bits.join(" and ")}, passing the value(s) in the matching parameter. ` +
    "okffs matches these against the board's actual options and falls back to OKFFS_DEFAULT_PRIORITY / OKFFS_DEFAULT_EFFORT when you omit them — so if you genuinely can't judge, omit the field rather than guessing."
  );
}

export const description =
  "Create a GitHub issue and automatically create a matching branch. Before calling this tool, infer appropriate labels from the issue title and description using GitHub's default labels: bug, documentation, duplicate, enhancement, good first issue, help wanted, invalid, question, wontfix. Pass the inferred labels in the labels parameter unless the user has specified their own." +
  inferenceGuidance() +
  " If the user mentions that this issue is blocked by, blocking, or a child of another issue, call link_issues after creating this issue to set the relationship. Returns the issue URL, issue number, and branch name.";

export const inputSchema = z.object({
  title: z.string().describe("Issue title"),
  description: z.string().describe("Issue body / description"),
  assignees: z.array(z.string()).optional().describe("GitHub usernames to assign"),
  labels: z.array(z.string()).optional().describe("Labels to apply e.g. bug, feature"),
  milestone: z.number().int().optional().describe("Milestone number to assign"),
  priority: z.string().optional().describe(
    "Optional Project board Priority (e.g. Urgent, High, Medium, Low) — matched against the board's Priority options (project-native field, or a GitHub org Issue Field when OKFFS_CLASSIC_PAT is set). Only applied when OKFFS_PROJECT_AUTO_ADD=true and a Priority field exists. If omitted, OKFFS_DEFAULT_PRIORITY is used when set."
  ),
  effort: z.string().optional().describe(
    "Optional Project board Effort (e.g. High, Medium, Low) — matched against the board's Effort options (project-native field, or a GitHub org Issue Field when OKFFS_CLASSIC_PAT is set). Only applied when OKFFS_PROJECT_AUTO_ADD=true and an Effort field exists. If omitted, OKFFS_DEFAULT_EFFORT is used when set."
  ),
});

export async function handler(input: z.infer<typeof inputSchema>) {
  const resolvedAssignees = input.assignees ?? config.defaultAssignees;
  const resolvedLabels = [
    ...new Set([...(input.labels ?? []), ...config.defaultLabels])
  ];
  // Fall back to OKFFS_DEFAULT_PRIORITY / OKFFS_DEFAULT_EFFORT when not given.
  const resolvedPriority = input.priority ?? config.defaultPriority;
  const resolvedEffort = input.effort ?? config.defaultEffort;

  const issue = await createIssue(input.title, input.description, resolvedAssignees, resolvedLabels, input.milestone);

  const branchName = buildBranchName(issue.number, input.title);

  const defaultBranch = await getDefaultBranch();
  const ref = await getRef(defaultBranch);
  await createBranch(branchName, ref.object.sha);

  const updatedBody = `${input.description}\n\n**Branch:** \`${branchName}\``;
  await updateIssueBody(issue.number, updatedBody);

  // Add the issue to the configured Project board (fallback for users without
  // native board automation) and set Priority/Effort. Non-fatal, mirroring the
  // autoPR block below: any failure warns with an [okffs] prefix, is surfaced in
  // the response, and never blocks issue creation. Initial Status is applied
  // later (after the draft PR) — see the applyInitialStatus call below.
  let boardAdd: BoardAddResult | null = null;
  let boardError: string | null = null;
  if (boardAutoAddEnabled()) {
    try {
      boardAdd = await addIssueToBoard(issue.node_id, { priority: resolvedPriority, effort: resolvedEffort });
    } catch (err) {
      boardError = err instanceof Error ? err.message : String(err);
      console.warn("[okffs] Failed to add issue to project board:", boardError);
    }
  }

  let draftPRUrl: string | null = null;
  if (config.autoPR) {
    // Push an empty init commit so the branch diverges from base, allowing
    // GitHub to accept a draft PR immediately. Only needed for the auto-PR flow.
    const previousBranch = currentBranch();
    try {
      git(["fetch", "origin"]);
      git(["checkout", branchName]);
      git(["commit", "--allow-empty", "-m", `chore: init branch for #${issue.number}`]);
      git(["push", "origin", branchName]);
    } catch (err) {
      console.warn("[okffs] Failed to push init commit:", err instanceof Error ? err.message : err);
    } finally {
      // Always restore the caller's original branch, even if a step above failed.
      if (previousBranch && previousBranch !== branchName) {
        try {
          git(["checkout", previousBranch]);
        } catch (err) {
          console.warn("[okffs] Failed to restore branch:", err instanceof Error ? err.message : err);
        }
      }
    }

    try {
      const pr = await createDraftPullRequest(
        `WIP: #${issue.number} - ${input.title}`,
        `Closes #${issue.number}`,
        branchName,
        defaultBranch
      );
      draftPRUrl = pr.html_url;
    } catch (err) {
      console.warn("[okffs] Failed to create draft PR:", err instanceof Error ? err.message : err);
    }
  }

  // Pin the board Status to the configured initial column (e.g. Backlog). This
  // runs LAST — after the draft PR is created — on purpose: the PR's `Closes #N`
  // link fires GitHub's "PR linked to issue" workflow, which flips a scaffolded
  // issue to "In Progress". Setting our intended status here lets it win that
  // race so freshly-created issues land where okffs means them to (#103).
  // Non-fatal, like the rest of the board handling.
  let initialStatus: InitialStatusResult | null = null;
  if (boardAdd) {
    initialStatus = await applyInitialStatus(boardAdd.itemId);
  }

  const lines = [
    `Issue #${issue.number} created: ${issue.html_url}`,
    `Branch: \`${branchName}\``,
  ];

  if (draftPRUrl) {
    lines.push(`Draft PR: ${draftPRUrl}`);
  }

  if (resolvedAssignees.length > 0) {
    const source = input.assignees ? "" : " (default)";
    lines.push(`Assignees: ${resolvedAssignees.join(", ")}${source}`);
  }

  if (resolvedLabels.length > 0) {
    const source = input.labels ? "" : " (default)";
    lines.push(`Labels: ${resolvedLabels.join(", ")}${source}`);
  }

  const addedToBoard = Boolean(boardAdd);
  lines.push(
    ...renderBoardLines({
      addedToBoard,
      boardError,
      requestedPriority: resolvedPriority,
      priority: boardAdd?.priority ?? null,
      requestedEffort: resolvedEffort,
      effort: boardAdd?.effort ?? null,
      requestedStatus: config.projectInitialStatus,
      initialStatus,
    })
  );

  lines.push(
    ``,
    `To start work:`,
    `  git fetch origin`,
    `  git checkout ${branchName}`,
  );

  // Conversational nudge: prompt the host LLM to offer moving the issue into
  // the "In Progress" column via update_project_status once work begins.
  if (addedToBoard) {
    const where = initialStatus?.applied ? `"${initialStatus.applied}"` : "its default column";
    lines.push(
      ``,
      `This issue is on the board in ${where}. Want me to move it to "In Progress" and start? ` +
      `(I can call update_project_status for #${issue.number}.)`
    );
  }

  if (config.promptForMetadata && !input.assignees && !input.labels) {
    lines.push(
      ``,
      `Tip: You can include assignees and labels next time:`,
      `  assignees: ["your-github-username"]`,
      `  labels: ["feature", "bug"]`,
      `Or set OKFFS_PROMPT_METADATA=false in .env to hide this tip.`
    );
  }

  return {
    content: [{ type: "text" as const, text: lines.join("\n") }],
  };
}
