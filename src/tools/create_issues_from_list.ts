import { z } from "zod";
import { createIssue, updateIssueBody, getDefaultBranch, getRef, createBranch, buildBranchName } from "../github.js";
import { config } from "../config.js";
import { issueAppFor } from "../multisite.js";
import { isEpicType, epicNoBranchNote } from "../epic.js";
import {
  boardAutoAddEnabled,
  addIssueToBoard,
  applyInitialStatus,
  renderBoardLines,
  type BoardAddResult,
  type InitialStatusResult,
  type BoardFieldOutcome,
} from "../board.js";
import { applyIssueType } from "../issue_types.js";
import { resolveIssueBody } from "../issue_body.js";

export const name = "create_issues_from_list";

export const description =
  "Create multiple GitHub issues and matching branches from a list of tasks. Before calling this tool, infer appropriate labels for each task from its title and description using GitHub's default labels: bug, documentation, duplicate, enhancement, good first issue, help wanted, invalid, question, wontfix. Pass inferred labels per task in the labels field unless the user has specified their own. When the Project board is enabled (OKFFS_PROJECT_AUTO_ADD=true), each issue is added to the board like create_issue does — infer a per-task priority/effort where you can, falling back to OKFFS_DEFAULT_PRIORITY/EFFORT. Also infer a per-task native GitHub Issue Type (Task/Bug/Feature/…) where the org defines them, falling back to OKFFS_DEFAULT_TYPE. Confirms before creating.";

const taskSchema = z.object({
  title: z.string().describe("Issue title"),
  // `body` is the canonical name (#282); the `description` alias was removed
  // in #297, and `body` is required in the schema so a missing one fails
  // validation up front (PR #300 review).
  body: z.string().describe("Issue body"),
  assignees: z.array(z.string()).optional().describe("GitHub usernames to assign"),
  labels: z.array(z.string()).optional().describe("Labels to apply to this issue"),
  app: z.string().optional().describe("Optional multisite app this issue belongs to (one of OKFFS_APPS, e.g. finance) — adds the app label and uses the app as the branch identifier unless OKFFS_IDENTIFIER is set explicitly. Defaults to the session's OKFFS_APP; single-site repos never need it."),
  milestone: z.number().int().optional().describe("Milestone number to assign"),
  priority: z.string().optional().describe(
    "Optional Project board Priority (e.g. Urgent, High, Medium, Low). Only applied when OKFFS_PROJECT_AUTO_ADD=true; falls back to OKFFS_DEFAULT_PRIORITY when omitted."
  ),
  effort: z.string().optional().describe(
    "Optional Project board Effort (e.g. High, Medium, Low). Only applied when OKFFS_PROJECT_AUTO_ADD=true; falls back to OKFFS_DEFAULT_EFFORT when omitted."
  ),
  type: z.string().optional().describe(
    "Optional native GitHub Issue Type (e.g. Task, Bug, Feature, Epic, Story) — matched against the org's enabled Issue Types. Skipped cleanly when unavailable; falls back to OKFFS_DEFAULT_TYPE when omitted."
  ),
});

export const inputSchema = z.object({
  tasks: z.array(taskSchema).min(1).describe("List of issues to create"),
  confirmed: z.boolean().optional().describe("Must be true to proceed with creation"),
});

export async function handler(input: z.infer<typeof inputSchema>) {
  // Resolve each task's body up front (#282) so a bad task errors at preview
  // time, before anything is created.
  const bodyErrors: string[] = [];
  const taskBodies: string[] = [];
  input.tasks.forEach((t, i) => {
    const res = resolveIssueBody(t, `create_issues_from_list task ${i + 1}`);
    if (!res.ok) {
      bodyErrors.push(res.error);
      taskBodies.push("");
    } else {
      taskBodies.push(res.body);
    }
  });
  if (bodyErrors.length > 0) {
    return { content: [{ type: "text" as const, text: bodyErrors.join("\n") }] };
  }

  if (!input.confirmed) {
    const preview = input.tasks
      .map((t, i) => `${i + 1}. ${t.title}${t.labels?.length ? ` [${t.labels.join(", ")}]` : ""}`)
      .join("\n");
    return {
      content: [{
        type: "text" as const,
        text: `About to create ${input.tasks.length} issue(s):\n\n${preview}\n\nRe-call create_issues_from_list with confirmed: true to proceed.`,
      }],
    };
  }

  const defaultBranch = await getDefaultBranch();
  const ref = await getRef(defaultBranch);
  const results: string[] = [];

  // Multisite (#309): validate every per-task `app` before creating anything.
  for (const [i, t] of input.tasks.entries()) {
    const check = issueAppFor(t.app);
    if (check.error) return { content: [{ type: "text" as const, text: `Task ${i + 1} ("${t.title}"): ${check.error}` }] };
  }

  for (const [taskIndex, task] of input.tasks.entries()) {
    const taskBody = taskBodies[taskIndex];
    const resolvedAssignees = task.assignees ?? config.defaultAssignees;
    const taskApp = issueAppFor(task.app); // validated up front, before any creation
    const resolvedLabels = [
      ...new Set([...(task.labels ?? []), ...config.defaultLabels, ...(taskApp.label ? [taskApp.label] : [])])
    ];
    const resolvedPriority = task.priority ?? config.defaultPriority;
    const resolvedEffort = task.effort ?? config.defaultEffort;
    const resolvedType = task.type ?? config.defaultType;

    const issue = await createIssue(task.title, taskBody, resolvedAssignees, resolvedLabels, task.milestone);
    // Epics get no branch / **Branch:** line (#323).
    const branchName: string | null = isEpicType(resolvedType) ? null : buildBranchName(issue.number, task.title, taskApp.identifier);
    if (branchName) {
      await createBranch(branchName, ref.object.sha);
      await updateIssueBody(issue.number, `${taskBody}\n\n**Branch:** \`${branchName}\``);
    }

    // Native Issue Type — non-fatal per task, surfaced in the entry below.
    let typeOutcome: BoardFieldOutcome | null = null;
    if (resolvedType) {
      typeOutcome = await applyIssueType(issue.number, resolvedType);
    }

    // Board placement, mirroring create_issue. Non-fatal per task and surfaced in
    // the response — never silent (#144, #146). No draft PR here, so the initial
    // status has no linked-PR race to win and can be applied right away.
    let boardAdd: BoardAddResult | null = null;
    let boardError: string | null = null;
    let initialStatus: InitialStatusResult | null = null;
    if (boardAutoAddEnabled()) {
      try {
        boardAdd = await addIssueToBoard(issue.node_id, { priority: resolvedPriority, effort: resolvedEffort });
        initialStatus = await applyInitialStatus(boardAdd.itemId);
      } catch (err) {
        boardError = err instanceof Error ? err.message : String(err);
        console.warn(`[okffs] Failed to add #${issue.number} to project board:`, boardError);
      }
    }

    const entryLines = [
      `#${issue.number} — ${task.title}`,
      branchName ? `  Branch: \`${branchName}\`` : `  Branch: ${epicNoBranchNote()}`,
      `  ${issue.html_url}`,
    ];
    entryLines.push(
      ...renderBoardLines({
        addedToBoard: Boolean(boardAdd),
        boardError,
        requestedPriority: resolvedPriority,
        priority: boardAdd?.priority ?? null,
        requestedEffort: resolvedEffort,
        effort: boardAdd?.effort ?? null,
        requestedStatus: config.projectInitialStatus,
        initialStatus,
        indent: "  ",
      })
    );
    if (typeOutcome) {
      entryLines.push(
        "applied" in typeOutcome
          ? `  Type: ${typeOutcome.applied}`
          : `  ⚠ Type "${resolvedType}" not set — ${typeOutcome.skipped}`
      );
    }
    results.push(entryLines.join("\n"));
  }

  return {
    content: [{
      type: "text" as const,
      text:
        `Created ${results.length} issue(s):\n\n${results.join("\n\n")}`,
    }],
  };
}
