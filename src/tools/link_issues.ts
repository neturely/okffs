import { z } from "zod";
import { getIssue, updateIssueBody, owner, repo } from "../github.js";

export const name = "link_issues";

export const description =
  "Link two GitHub issues with a relationship by editing the issue body. Supports blocked_by (this issue is blocked by another), blocking (this issue is blocking another), and parent (set a parent issue). Relationships are stored in a '## Relationships' section in the issue body.";

export const inputSchema = z.object({
  issue_number: z.number().int().positive().describe("The issue to set the relationship on"),
  related_issue_number: z.number().int().positive().describe("The related issue"),
  relationship: z.enum(["blocked_by", "blocking", "parent"]).describe(
    "blocked_by: this issue is blocked by the related issue. blocking: this issue is blocking the related issue. parent: the related issue becomes the parent of this issue."
  ),
});

const RELATIONSHIP_LABELS: Record<string, string> = {
  blocked_by: "Blocked by",
  blocking: "Blocking",
  parent: "Parent:",
};

export async function handler(input: z.infer<typeof inputSchema>) {
  const issue = await getIssue(input.issue_number);
  const label = RELATIONSHIP_LABELS[input.relationship];
  const newLine = `- ${label} #${input.related_issue_number}`;

  const currentBody = issue.body ?? "";
  let newBody: string;

  if (currentBody.includes("## Relationships")) {
    newBody = currentBody.trimEnd() + "\n" + newLine;
  } else {
    newBody = currentBody.trimEnd() + "\n\n## Relationships\n" + newLine;
  }

  await updateIssueBody(input.issue_number, newBody);

  const humanRelationship = `${label} #${input.related_issue_number}`.toLowerCase();

  return {
    content: [
      {
        type: "text" as const,
        text: [
          `✅ Relationship added to issue #${input.issue_number}`,
          `   Issue #${input.issue_number} is ${humanRelationship}`,
          `   https://github.com/${owner}/${repo}/issues/${input.issue_number}`,
        ].join("\n"),
      },
    ],
  };
}
