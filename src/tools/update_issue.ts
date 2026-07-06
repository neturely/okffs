import { z } from "zod";
import { updateIssue } from "../github.js";

export const name = "update_issue";

export const description =
  "Mutate the core fields of an EXISTING GitHub issue — title, assignees, labels, milestone, and/or body. " +
  "create_issue only sets these at creation time; this is how you change them afterward (e.g. rename an issue, " +
  "add or change an assignee) without dropping to raw `gh issue edit`. Authenticates with okffs's configured token " +
  "(GITHUB_TOKEN, or the gh CLI fallback when it's unset) and applies okffs conventions. Pass only the fields you " +
  "want to change — omitted fields are left untouched. NOTE: labels and assignees REPLACE the whole set (they do " +
  "not merge with the current values), so pass the complete desired list; an empty array [] clears them, and " +
  "milestone: null clears the milestone. For board Priority/Effort use set_issue_fields, and for the board Status " +
  "column use update_project_status — those are not issue fields.";

export const inputSchema = z.object({
  issue_number: z.number().int().positive().describe("The issue number to update"),
  title: z.string().optional().describe("New issue title"),
  body: z.string().optional().describe("New issue body. Replaces the existing body — pass the full content, not a fragment."),
  assignees: z.array(z.string()).optional().describe("GitHub usernames to assign. REPLACES the current assignees (not merged); [] clears them."),
  labels: z.array(z.string()).optional().describe("Labels to apply. REPLACES the current labels (not merged); [] clears them."),
  milestone: z.number().int().positive().nullable().optional().describe("Milestone number to assign, or null to clear the milestone."),
});

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

export async function handler(input: z.infer<typeof inputSchema>) {
  const { issue_number, ...fields } = input;

  // Require at least one field to change — mirrors set_issue_fields' guard so a
  // no-op call gives an actionable message instead of a silent PATCH.
  const provided = (["title", "body", "assignees", "labels", "milestone"] as const).filter(
    (k) => fields[k] !== undefined
  );
  if (provided.length === 0) {
    return text(
      "Nothing to update — pass at least one of: title, body, assignees, labels, milestone. " +
        "(For board Priority/Effort use set_issue_fields; for the Status column use update_project_status.)"
    );
  }

  let updated: Awaited<ReturnType<typeof updateIssue>>;
  try {
    updated = await updateIssue(issue_number, fields);
  } catch (err) {
    return text(`[okffs] Failed to update issue #${issue_number}: ${err instanceof Error ? err.message : String(err)}`);
  }

  const lines = provided.map((k) => {
    const v = fields[k];
    const shown = Array.isArray(v)
      ? (v.length ? v.join(", ") : "(cleared)")
      : v === null ? "(cleared)" : String(v);
    return `  ${k} → ${shown}`;
  });

  return text(`Issue #${issue_number} updated:\n${lines.join("\n")}\n${updated.html_url}`);
}
