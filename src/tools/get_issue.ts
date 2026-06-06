import { z } from "zod";
import { getIssue, extractBranchFromBody, owner, repo } from "../github.js";

export const name = "get_issue";

export const description =
  "Fetch full details of a GitHub issue by number — title, body, labels, assignees, branch, and status.";

export const inputSchema = z.object({
  issue_number: z.number().int().positive(),
});

export async function handler(input: z.infer<typeof inputSchema>) {
  const issue = await getIssue(input.issue_number) as {
    number: number;
    title: string;
    html_url: string;
    body: string | null;
    state: string;
    labels: Array<{ name: string }>;
    assignees: Array<{ login: string }>;
  };

  const branch = extractBranchFromBody(issue.body);
  const assignees = issue.assignees.map((a) => a.login).join(", ") || "none";
  const labels = issue.labels.map((l) => l.name).join(", ") || "none";

  const lines = [
    `#${issue.number} — ${issue.title}`,
    `Status: ${issue.state}`,
    ...(branch ? [`Branch: ${branch}`] : []),
    `Assignees: ${assignees}`,
    `Labels: ${labels}`,
    `URL: https://github.com/${owner}/${repo}/issues/${issue.number}`,
    ``,
    issue.body ?? "(no description)",
  ];

  return {
    content: [{ type: "text" as const, text: lines.join("\n") }],
  };
}
