import { z } from "zod";
import { createIssue, updateIssueBody, getDefaultBranch, getRef, createBranch, buildBranchName } from "../github.js";
import { config } from "../config.js";
import {
  boardAutoAddEnabled,
  addIssueToBoard,
  applyInitialStatus,
  renderBoardLines,
  type BoardAddResult,
  type InitialStatusResult,
} from "../board.js";

export const name = "create_issues_from_list";

export const description =
  "Create multiple GitHub issues and matching branches from a list of tasks. Before calling this tool, infer appropriate labels for each task from its title and description using GitHub's default labels: bug, documentation, duplicate, enhancement, good first issue, help wanted, invalid, question, wontfix. Pass inferred labels per task in the labels field unless the user has specified their own. When the Project board is enabled (OKFFS_PROJECT_AUTO_ADD=true), each issue is added to the board like create_issue does — infer a per-task priority/effort where you can, falling back to OKFFS_DEFAULT_PRIORITY/EFFORT. Confirms before creating.";

const taskSchema = z.object({
  title: z.string().describe("Issue title"),
  description: z.string().describe("Issue body / description"),
  assignees: z.array(z.string()).optional().describe("GitHub usernames to assign"),
  labels: z.array(z.string()).optional().describe("Labels to apply to this issue"),
  milestone: z.number().int().optional().describe("Milestone number to assign"),
  priority: z.string().optional().describe(
    "Optional Project board Priority (e.g. Urgent, High, Medium, Low). Only applied when OKFFS_PROJECT_AUTO_ADD=true; falls back to OKFFS_DEFAULT_PRIORITY when omitted."
  ),
  effort: z.string().optional().describe(
    "Optional Project board Effort (e.g. High, Medium, Low). Only applied when OKFFS_PROJECT_AUTO_ADD=true; falls back to OKFFS_DEFAULT_EFFORT when omitted."
  ),
});

export const inputSchema = z.object({
  tasks: z.array(taskSchema).min(1).describe("List of issues to create"),
  confirmed: z.boolean().optional().describe("Must be true to proceed with creation"),
});

export async function handler(input: z.infer<typeof inputSchema>) {
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

  for (const task of input.tasks) {
    const resolvedAssignees = task.assignees ?? config.defaultAssignees;
    const resolvedLabels = [
      ...new Set([...(task.labels ?? []), ...config.defaultLabels])
    ];
    const resolvedPriority = task.priority ?? config.defaultPriority;
    const resolvedEffort = task.effort ?? config.defaultEffort;

    const issue = await createIssue(task.title, task.description, resolvedAssignees, resolvedLabels, task.milestone);
    const branchName = buildBranchName(issue.number, task.title);
    await createBranch(branchName, ref.object.sha);
    const updatedBody = `${task.description}\n\n**Branch:** \`${branchName}\``;
    await updateIssueBody(issue.number, updatedBody);

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
      `  Branch: \`${branchName}\``,
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
    results.push(entryLines.join("\n"));
  }

  return {
    content: [{ type: "text" as const, text: `Created ${results.length} issue(s):\n\n${results.join("\n\n")}` }],
  };
}
