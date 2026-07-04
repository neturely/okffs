import { z } from "zod";
import { getIssue } from "../github.js";
import { config } from "../config.js";
import { addIssueToBoard } from "../board.js";

export const name = "set_issue_fields";

export const description =
  "Set a GitHub Projects v2 board Priority and/or Effort on an EXISTING issue (adds it to the board first if needed). " +
  "Use this to set priority/effort on issues that already exist — create_issue only sets them at creation time. " +
  "Handles both project-native single-select fields and org-level Issue Fields (the latter needs OKFFS_CLASSIC_PAT + a classic admin:org PAT). " +
  "To move an issue's Status column, use update_project_status instead. Requires OKFFS_PROJECT_ENABLED.";

export const inputSchema = z.object({
  issue_number: z.number().int().positive().describe("The issue number to set fields on"),
  priority: z.string().optional().describe("Board Priority to set (e.g. Urgent, High, Medium, Low) — matched against the board's Priority options"),
  effort: z.string().optional().describe("Board Effort to set (e.g. High, Medium, Low) — matched against the board's Effort options"),
});

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

export async function handler(input: z.infer<typeof inputSchema>) {
  if (!config.projectEnabled) {
    return text("OKFFS_PROJECT_ENABLED is not set — board field updates are disabled.");
  }
  if (!input.priority && !input.effort) {
    return text("Nothing to set — pass a priority and/or an effort. (For the Status column, use update_project_status.)");
  }

  const issue = await getIssue(input.issue_number);

  let result: Awaited<ReturnType<typeof addIssueToBoard>>;
  try {
    // addIssueToBoard adds the issue to the board (idempotent — returns the
    // existing item if already present) and sets Priority/Effort via the shared,
    // org-Issue-Field-aware path. Reused so existing issues get identical handling
    // and surfacing to create_issue.
    result = await addIssueToBoard(issue.node_id, { priority: input.priority, effort: input.effort });
  } catch (err) {
    return text(`[okffs] Failed to update board fields on #${input.issue_number}: ${err instanceof Error ? err.message : String(err)}`);
  }

  const lines: string[] = [];
  if (result.priority) {
    lines.push(
      "applied" in result.priority
        ? `Priority → ${result.priority.applied}`
        : `⚠ Priority "${input.priority}" not set — ${result.priority.skipped}`
    );
  }
  if (result.effort) {
    lines.push(
      "applied" in result.effort
        ? `Effort → ${result.effort.applied}`
        : `⚠ Effort "${input.effort}" not set — ${result.effort.skipped}`
    );
  }

  return text(`Issue #${input.issue_number} board fields:\n${lines.map((l) => `  ${l}`).join("\n")}`);
}
