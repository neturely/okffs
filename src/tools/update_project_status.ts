import { z } from "zod";
import { config } from "../config.js";
import { getProjectItemForIssue, getProjectMetadata, setProjectFieldValue } from "../projects.js";

export const name = "update_project_status";

export const description =
  "Move an issue between GitHub Project board columns: Backlog, Ready, In Progress, or Review. " +
  "Done is intentionally NOT settable here — it is owned by native GitHub board automation on PR merge / issue close. " +
  "Drive this conversationally during the dev workflow: after create_issue places an issue on the board, offer to move " +
  'it to "In Progress" when work starts, and to "Review" when a PR goes up. ' +
  "Requires OKFFS_PROJECT_ENABLED and the issue to already be on the board.";

const STATUSES = ["Backlog", "Ready", "In Progress", "Review"] as const;

export const inputSchema = z.object({
  issue: z.number().int().positive().describe("Issue number to move"),
  status: z
    .enum(STATUSES)
    .describe('Target column: "Backlog", "Ready", "In Progress", or "Review" (Done is owned by native automation)'),
});

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

export async function handler(input: z.infer<typeof inputSchema>) {
  if (!config.projectEnabled) {
    return text("OKFFS_PROJECT_ENABLED is not set — project status updates are disabled.");
  }

  const itemId = await getProjectItemForIssue(input.issue);
  if (!itemId) {
    return text(
      `Issue #${input.issue} is not on the project board. Add it first (create_issue with ` +
        "OKFFS_PROJECT_AUTO_ADD=true, or add it to the board manually)."
    );
  }

  const meta = await getProjectMetadata();
  if (!meta.statusFieldId) {
    return text("The board has no Status field — cannot update the column.");
  }

  const optionId = meta.statusOptions.get(input.status);
  if (!optionId) {
    const opts = [...meta.statusOptions.keys()].join(", ") || "none";
    return text(`The board has no "${input.status}" column. Available columns: ${opts}.`);
  }

  await setProjectFieldValue(itemId, meta.statusFieldId, optionId);
  return text(`Issue #${input.issue} moved to "${input.status}".`);
}
