import { z } from "zod";
import {
  createIssue,
  updateIssueBody,
  getDefaultBranch,
  getRef,
  createBranch,
  buildBranchName,
  createDraftPullRequest,
} from "../github.js";
import { config } from "../config.js";
import { git, currentBranch } from "../git.js";

export const name = "plan";

export const description =
  "Plan a piece of work and create all the resulting GitHub issues (with branches, and draft PRs when OKFFS_AUTO_PR=true) in one shot. Given a free-text description of the work, break it down yourself into a structured list of issues — each with a title, description, inferred labels, and any relationships between them — and pass that breakdown as the tasks array. Infer labels from GitHub's defaults: bug, documentation, duplicate, enhancement, good first issue, help wanted, invalid, question, wontfix. Express dependencies via per-task relationships, referencing other tasks by their 1-based position in the list. Two-step confirmation: call once to preview the plan, then re-call with confirmed: true to create everything.";

const relationshipSchema = z.object({
  type: z
    .enum(["blocked_by", "blocking", "parent"])
    .describe(
      "blocked_by: this task is blocked by the target. blocking: this task is blocking the target. parent: the target is the parent of this task."
    ),
  target: z
    .number()
    .int()
    .positive()
    .describe("1-based index of the related task within this same tasks list"),
});

const taskSchema = z.object({
  title: z.string().describe("Issue title"),
  description: z.string().describe("Issue body / description"),
  assignees: z.array(z.string()).optional().describe("GitHub usernames to assign"),
  labels: z.array(z.string()).optional().describe("Labels to apply to this issue"),
  milestone: z.number().int().optional().describe("Milestone number to assign"),
  relationships: z
    .array(relationshipSchema)
    .optional()
    .describe("Relationships to other tasks in this list, referenced by 1-based index"),
});

export const inputSchema = z.object({
  description: z
    .string()
    .describe("Free-text description of the work to plan and break down into issues"),
  tasks: z
    .array(taskSchema)
    .min(1)
    .describe("The issue breakdown you generated from the description"),
  confirmed: z.boolean().optional().describe("Must be true to proceed with creation"),
});

const RELATIONSHIP_LABELS: Record<string, string> = {
  blocked_by: "Blocked by",
  blocking: "Blocking",
  parent: "Parent:",
};

export async function handler(input: z.infer<typeof inputSchema>) {
  if (!input.confirmed) {
    const preview = input.tasks
      .map((t, i) => {
        const labels = t.labels?.length ? ` [${t.labels.join(", ")}]` : "";
        const rels =
          t.relationships?.length
            ? "\n" +
              t.relationships
                .map((r) => `     ↳ ${RELATIONSHIP_LABELS[r.type]} task ${r.target}`)
                .join("\n")
            : "";
        return `${i + 1}. ${t.title}${labels}${rels}`;
      })
      .join("\n");

    return {
      content: [
        {
          type: "text" as const,
          text:
            `Plan for: ${input.description}\n\n` +
            `About to create ${input.tasks.length} issue(s):\n\n${preview}\n\n` +
            `Re-call plan with confirmed: true to create them.`,
        },
      ],
    };
  }

  const defaultBranch = await getDefaultBranch();
  const ref = await getRef(defaultBranch);

  // First pass: create every issue and its branch so we have real issue numbers
  // before wiring up relationships (which reference tasks by list index).
  const created: Array<{
    number: number;
    html_url: string;
    branchName: string;
    body: string;
    relationships: z.infer<typeof relationshipSchema>[];
  }> = [];

  for (const task of input.tasks) {
    const resolvedAssignees = task.assignees ?? config.defaultAssignees;
    const resolvedLabels = [...new Set([...(task.labels ?? []), ...config.defaultLabels])];

    const issue = await createIssue(
      task.title,
      task.description,
      resolvedAssignees,
      resolvedLabels,
      task.milestone
    );
    const branchName = buildBranchName(issue.number, task.title);
    await createBranch(branchName, ref.object.sha);

    const body = `${task.description}\n\n**Branch:** \`${branchName}\``;
    await updateIssueBody(issue.number, body);

    created.push({
      number: issue.number,
      html_url: issue.html_url,
      branchName,
      body,
      relationships: task.relationships ?? [],
    });
  }

  // Second pass: resolve relationship targets (1-based task indices) to issue
  // numbers and append a Relationships section to the relevant issue bodies.
  for (let i = 0; i < created.length; i++) {
    const entry = created[i];
    const lines = entry.relationships
      .filter((r) => r.target >= 1 && r.target <= created.length && r.target !== i + 1)
      .map((r) => `- ${RELATIONSHIP_LABELS[r.type]} #${created[r.target - 1].number}`);

    if (lines.length === 0) continue;

    const newBody = `${entry.body}\n\n## Relationships\n${lines.join("\n")}`;
    await updateIssueBody(entry.number, newBody);
  }

  // Optionally open a draft PR per branch. Mirrors create_issue: push an empty
  // init commit so the branch diverges from base, then open the draft PR.
  const draftPRs: Record<number, string> = {};
  if (config.autoPR) {
    const previousBranch = currentBranch();
    try {
      git(["fetch", "origin"]);
      for (const entry of created) {
        try {
          git(["checkout", entry.branchName]);
          git(["commit", "--allow-empty", "-m", `chore: init branch for #${entry.number}`]);
          git(["push", "origin", entry.branchName]);
        } catch (err) {
          console.warn(
            `[okffs] Failed to push init commit for #${entry.number}:`,
            err instanceof Error ? err.message : err
          );
        }
      }
    } finally {
      if (previousBranch && !created.some((e) => e.branchName === previousBranch)) {
        try {
          git(["checkout", previousBranch]);
        } catch (err) {
          console.warn(
            "[okffs] Failed to restore branch:",
            err instanceof Error ? err.message : err
          );
        }
      }
    }

    for (const entry of created) {
      try {
        const pr = await createDraftPullRequest(
          `WIP: #${entry.number} - ${input.tasks[created.indexOf(entry)].title}`,
          `Closes #${entry.number}`,
          entry.branchName,
          defaultBranch
        );
        draftPRs[entry.number] = pr.html_url;
      } catch (err) {
        console.warn(
          `[okffs] Failed to create draft PR for #${entry.number}:`,
          err instanceof Error ? err.message : err
        );
      }
    }
  }

  const results = created.map((entry) => {
    const lines = [
      `#${entry.number} — ${input.tasks[created.indexOf(entry)].title}`,
      `  Branch: \`${entry.branchName}\``,
      `  ${entry.html_url}`,
    ];
    if (draftPRs[entry.number]) {
      lines.push(`  Draft PR: ${draftPRs[entry.number]}`);
    }
    return lines.join("\n");
  });

  return {
    content: [
      {
        type: "text" as const,
        text: `Created ${results.length} issue(s) from the plan:\n\n${results.join("\n\n")}`,
      },
    ],
  };
}
