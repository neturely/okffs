import { z } from "zod";
import { createIssue, updateIssueBody, getDefaultBranch, getRef, createBranch, slugify } from "../github.js";
import { config } from "../config.js";

export const name = "create_issues_from_list";

export const description =
  "Create multiple GitHub issues and matching branches from a list of tasks. Before calling this tool, infer appropriate labels for each task from its title and description using GitHub's default labels: bug, documentation, duplicate, enhancement, good first issue, help wanted, invalid, question, wontfix. Pass inferred labels per task in the labels field unless the user has specified their own. Confirms before creating.";

const taskSchema = z.object({
  title: z.string().describe("Issue title"),
  description: z.string().describe("Issue body / description"),
  assignees: z.array(z.string()).optional().describe("GitHub usernames to assign"),
  labels: z.array(z.string()).optional().describe("Labels to apply to this issue"),
  milestone: z.number().int().optional().describe("Milestone number to assign"),
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

    const issue = await createIssue(task.title, task.description, resolvedAssignees, resolvedLabels, task.milestone);
    const branchName = `${issue.number}-${slugify(task.title)}`;
    await createBranch(branchName, ref.object.sha);
    const updatedBody = `${task.description}\n\n**Branch:** \`${branchName}\``;
    await updateIssueBody(issue.number, updatedBody);

    results.push(`#${issue.number} — ${task.title}\n  Branch: \`${branchName}\`\n  ${issue.html_url}`);
  }

  return {
    content: [{ type: "text" as const, text: `Created ${results.length} issue(s):\n\n${results.join("\n\n")}` }],
  };
}
