import { z } from "zod";
import { getIssue } from "../github.js";
import { config } from "../config.js";
import { addIssueToBoard, type BoardFieldOutcome } from "../board.js";
import { applyIssueType } from "../issue_types.js";

export const name = "set_issue_fields";

export const description =
  "Set enumerated fields on an EXISTING issue: the GitHub Projects v2 board Priority and/or Effort, and/or the native GitHub Issue Type (Task/Bug/Feature/…). " +
  "Use this to set these on issues that already exist — create_issue only sets them at creation time. " +
  "Priority/Effort handle both project-native single-select fields and org-level Issue Fields (the latter needs OKFFS_CLASSIC_PAT + a classic admin:org PAT) and require OKFFS_PROJECT_ENABLED. " +
  "Type is a native GitHub Issue Type (org-level; skipped cleanly on user repos / when unavailable) and works independently of the board. " +
  "To move an issue's Status column, use update_project_status; to edit title/assignees/labels/milestone/body, use update_issue.";

export const inputSchema = z.object({
  issue_number: z.number().int().positive().describe("The issue number to set fields on"),
  priority: z.string().optional().describe("Board Priority to set (e.g. Urgent, High, Medium, Low) — matched against the board's Priority options. Requires OKFFS_PROJECT_ENABLED."),
  effort: z.string().optional().describe("Board Effort to set (e.g. High, Medium, Low) — matched against the board's Effort options. Requires OKFFS_PROJECT_ENABLED."),
  type: z.string().optional().describe("Native GitHub Issue Type to set (e.g. Task, Bug, Feature, Epic, Story) — matched against the org's enabled Issue Types. Independent of the board."),
});

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

const renderOutcome = (label: string, requested: string, outcome: BoardFieldOutcome): string =>
  "applied" in outcome
    ? `${label} → ${outcome.applied}`
    : `⚠ ${label} "${requested}" not set — ${outcome.skipped}`;

export async function handler(input: z.infer<typeof inputSchema>) {
  if (!input.priority && !input.effort && !input.type) {
    return text("Nothing to set — pass a priority, effort, and/or type. (Status column → update_project_status; title/assignees/labels/milestone/body → update_issue.)");
  }

  const lines: string[] = [];

  // Board fields (Priority/Effort) — gated on the Projects integration.
  if (input.priority || input.effort) {
    if (!config.projectEnabled) {
      lines.push("⚠ Priority/Effort not set — OKFFS_PROJECT_ENABLED is not set, so board field updates are disabled.");
    } else {
      const issue = await getIssue(input.issue_number);
      try {
        // addIssueToBoard adds the issue to the board (idempotent) and sets
        // Priority/Effort via the shared, org-Issue-Field-aware path — identical
        // handling and surfacing to create_issue.
        const result = await addIssueToBoard(issue.node_id, { priority: input.priority, effort: input.effort });
        if (result.priority) lines.push(renderOutcome("Priority", input.priority!, result.priority));
        if (result.effort) lines.push(renderOutcome("Effort", input.effort!, result.effort));
      } catch (err) {
        lines.push(`⚠ Failed to update board fields: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // Native Issue Type — org-level, independent of the board. Non-fatal.
  if (input.type) {
    const outcome = await applyIssueType(input.issue_number, input.type);
    lines.push(renderOutcome("Type", input.type, outcome));
  }

  return text(`Issue #${input.issue_number} fields:\n${lines.map((l) => `  ${l}`).join("\n")}`);
}
