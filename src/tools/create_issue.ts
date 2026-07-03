import { z } from "zod";
import { createIssue, updateIssueBody, getDefaultBranch, getRef, createBranch, buildBranchName, createDraftPullRequest } from "../github.js";
import { config } from "../config.js";
import { git, currentBranch } from "../git.js";
import { addIssueToProject, getProjectMetadata, setProjectFieldValue, getOrgIssueField, setIssueFieldSingleSelect, type ProjectMetadata } from "../projects.js";

// Set a board single-select field (Priority, Effort, …) to `value`. Handles both
// shapes: a project-native single-select (set on the project item), and a GitHub
// org-level Issue Field (project field reports no options → set on the issue via
// setIssueFieldValue, gated on OKFFS_CLASSIC_PAT — #91). Non-fatal: warns and
// returns null on any miss. Returns the applied value on success.
async function applyBoardSingleSelect(
  label: string,
  value: string,
  itemId: string,
  issueNodeId: string,
  meta: ProjectMetadata
): Promise<string | null> {
  const native = meta.singleSelectByName.get(label.toLowerCase());
  if (!native) {
    console.warn(`[okffs] ${label} "${value}" not set: the board has no ${label} field.`);
    return null;
  }
  // Project-native single-select with resolvable options.
  if (native.options.size > 0) {
    const optionId = native.options.get(value);
    if (optionId) {
      await setProjectFieldValue(itemId, native.fieldId, optionId);
      return value;
    }
    console.warn(`[okffs] ${label} "${value}" not set — no matching option. Board ${label} options: ${[...native.options.keys()].join(", ")}.`);
    return null;
  }
  // No options via the project API → it's a GitHub org-level Issue Field.
  if (!config.classicPat) {
    console.warn(
      `[okffs] ${label} "${value}" not set: the board's ${label} is an org-level Issue Field, ` +
        `which okffs can only set with a classic PAT (\`admin:org\`) and OKFFS_CLASSIC_PAT=true (security tradeoff — see docs). ` +
        `Set it manually in the board UI for now.`
    );
    return null;
  }
  try {
    const orgField = await getOrgIssueField(label);
    if (!orgField) {
      console.warn(`[okffs] ${label} "${value}" not set: no org-level ${label} Issue Field found.`);
      return null;
    }
    const orgOptionId = orgField.options.get(value);
    if (!orgOptionId) {
      console.warn(`[okffs] ${label} "${value}" not set — no matching org Issue Field option. Options: ${[...orgField.options.keys()].join(", ")}.`);
      return null;
    }
    await setIssueFieldSingleSelect(issueNodeId, orgField.fieldId, orgOptionId);
    return value;
  } catch (err) {
    // Permission (fine-grained PAT FORBIDDEN) / preview-API errors — never fatal.
    console.warn(`[okffs] ${label} not set via org Issue Field:`, err instanceof Error ? err.message : err);
    return null;
  }
}

export const name = "create_issue";

export const description =
  "Create a GitHub issue and automatically create a matching branch. Before calling this tool, infer appropriate labels from the issue title and description using GitHub's default labels: bug, documentation, duplicate, enhancement, good first issue, help wanted, invalid, question, wontfix. Pass the inferred labels in the labels parameter unless the user has specified their own. If the user mentions that this issue is blocked by, blocking, or a child of another issue, call link_issues after creating this issue to set the relationship. Returns the issue URL, issue number, and branch name.";

export const inputSchema = z.object({
  title: z.string().describe("Issue title"),
  description: z.string().describe("Issue body / description"),
  assignees: z.array(z.string()).optional().describe("GitHub usernames to assign"),
  labels: z.array(z.string()).optional().describe("Labels to apply e.g. bug, feature"),
  milestone: z.number().int().optional().describe("Milestone number to assign"),
  priority: z.string().optional().describe(
    "Optional Project board Priority (e.g. Urgent, High, Medium, Low) — matched against the board's Priority options (project-native field, or a GitHub org Issue Field when OKFFS_CLASSIC_PAT is set). Only applied when OKFFS_PROJECT_AUTO_ADD=true and a Priority field exists. If omitted, OKFFS_DEFAULT_PRIORITY is used when set."
  ),
  effort: z.string().optional().describe(
    "Optional Project board Effort (e.g. High, Medium, Low) — matched against the board's Effort options (project-native field, or a GitHub org Issue Field when OKFFS_CLASSIC_PAT is set). Only applied when OKFFS_PROJECT_AUTO_ADD=true and an Effort field exists. If omitted, OKFFS_DEFAULT_EFFORT is used when set."
  ),
});

export async function handler(input: z.infer<typeof inputSchema>) {
  const resolvedAssignees = input.assignees ?? config.defaultAssignees;
  const resolvedLabels = [
    ...new Set([...(input.labels ?? []), ...config.defaultLabels])
  ];
  // Fall back to OKFFS_DEFAULT_PRIORITY / OKFFS_DEFAULT_EFFORT when not given.
  const resolvedPriority = input.priority ?? config.defaultPriority;
  const resolvedEffort = input.effort ?? config.defaultEffort;

  const issue = await createIssue(input.title, input.description, resolvedAssignees, resolvedLabels, input.milestone);

  const branchName = buildBranchName(issue.number, input.title);

  const defaultBranch = await getDefaultBranch();
  const ref = await getRef(defaultBranch);
  await createBranch(branchName, ref.object.sha);

  const updatedBody = `${input.description}\n\n**Branch:** \`${branchName}\``;
  await updateIssueBody(issue.number, updatedBody);

  // Add the issue to the configured Project board (fallback for users without
  // native board automation). Non-fatal, mirroring the autoPR block below: any
  // failure warns with an [okffs] prefix and never blocks issue creation.
  let addedToBoard = false;
  let priorityApplied: string | null = null;
  let effortApplied: string | null = null;
  let boardError: string | null = null;
  let boardItemId: string | null = null;
  if (config.projectAutoAdd && config.projectEnabled) {
    try {
      const itemId = await addIssueToProject(issue.node_id);
      boardItemId = itemId;
      addedToBoard = true;
      // Priority and Effort are set the same way — project-native single-select,
      // or a GitHub org-level Issue Field when OKFFS_CLASSIC_PAT is on (#91).
      if (resolvedPriority || resolvedEffort) {
        const meta = await getProjectMetadata();
        if (resolvedPriority) {
          priorityApplied = await applyBoardSingleSelect("Priority", resolvedPriority, itemId, issue.node_id, meta);
        }
        if (resolvedEffort) {
          effortApplied = await applyBoardSingleSelect("Effort", resolvedEffort, itemId, issue.node_id, meta);
        }
      }
    } catch (err) {
      boardError = err instanceof Error ? err.message : String(err);
      console.warn("[okffs] Failed to add issue to project board:", boardError);
    }
  }

  let draftPRUrl: string | null = null;
  if (config.autoPR) {
    // Push an empty init commit so the branch diverges from base, allowing
    // GitHub to accept a draft PR immediately. Only needed for the auto-PR flow.
    const previousBranch = currentBranch();
    try {
      git(["fetch", "origin"]);
      git(["checkout", branchName]);
      git(["commit", "--allow-empty", "-m", `chore: init branch for #${issue.number}`]);
      git(["push", "origin", branchName]);
    } catch (err) {
      console.warn("[okffs] Failed to push init commit:", err instanceof Error ? err.message : err);
    } finally {
      // Always restore the caller's original branch, even if a step above failed.
      if (previousBranch && previousBranch !== branchName) {
        try {
          git(["checkout", previousBranch]);
        } catch (err) {
          console.warn("[okffs] Failed to restore branch:", err instanceof Error ? err.message : err);
        }
      }
    }

    try {
      const pr = await createDraftPullRequest(
        `WIP: #${issue.number} - ${input.title}`,
        `Closes #${issue.number}`,
        branchName,
        defaultBranch
      );
      draftPRUrl = pr.html_url;
    } catch (err) {
      console.warn("[okffs] Failed to create draft PR:", err instanceof Error ? err.message : err);
    }
  }

  // Pin the board Status to the configured initial column (e.g. Backlog). This
  // runs LAST — after the draft PR is created — on purpose: the PR's `Closes #N`
  // link fires GitHub's "PR linked to issue" workflow, which flips a scaffolded
  // issue to "In Progress". Setting our intended status here lets it win that
  // race so freshly-created issues land where okffs means them to (#103).
  // Non-fatal, like the rest of the board handling.
  let initialStatusApplied: string | null = null;
  if (config.projectInitialStatus && boardItemId) {
    try {
      const meta = await getProjectMetadata();
      const optionId = meta.statusFieldId
        ? meta.statusOptions.get(config.projectInitialStatus)
        : undefined;
      if (meta.statusFieldId && optionId) {
        await setProjectFieldValue(boardItemId, meta.statusFieldId, optionId);
        initialStatusApplied = config.projectInitialStatus;
      } else if (!meta.statusFieldId) {
        console.warn(`[okffs] OKFFS_PROJECT_INITIAL_STATUS set but the board has no Status field.`);
      } else {
        const opts = [...meta.statusOptions.keys()].join(", ");
        console.warn(
          `[okffs] OKFFS_PROJECT_INITIAL_STATUS "${config.projectInitialStatus}" doesn't match a board Status option. Options: ${opts}.`
        );
      }
    } catch (err) {
      console.warn("[okffs] Failed to set initial board status:", err instanceof Error ? err.message : err);
    }
  }

  const lines = [
    `Issue #${issue.number} created: ${issue.html_url}`,
    `Branch: \`${branchName}\``,
  ];

  if (draftPRUrl) {
    lines.push(`Draft PR: ${draftPRUrl}`);
  }

  if (resolvedAssignees.length > 0) {
    const source = input.assignees ? "" : " (default)";
    lines.push(`Assignees: ${resolvedAssignees.join(", ")}${source}`);
  }

  if (resolvedLabels.length > 0) {
    const source = input.labels ? "" : " (default)";
    lines.push(`Labels: ${resolvedLabels.join(", ")}${source}`);
  }

  if (addedToBoard) {
    const bits = [
      priorityApplied ? `priority: ${priorityApplied}` : null,
      effortApplied ? `effort: ${effortApplied}` : null,
      initialStatusApplied ? `status: ${initialStatusApplied}` : null,
    ].filter(Boolean);
    lines.push(
      `Board: added to the project${bits.length ? ` (${bits.join(", ")})` : ""}`
    );
  } else if (boardError) {
    // Auto-add was enabled but failed. Surface it here (not just the server log)
    // so it isn't invisible — the issue was still created successfully, which
    // otherwise makes an empty board look like it worked. See #101.
    lines.push(
      `Board: NOT added — auto-add is on but failed. The issue itself was created fine.`,
      `  ${boardError}`
    );
  }

  lines.push(
    ``,
    `To start work:`,
    `  git fetch origin`,
    `  git checkout ${branchName}`,
  );

  // Conversational nudge: prompt the host LLM to offer moving the issue into
  // the "In Progress" column via update_project_status once work begins.
  if (addedToBoard) {
    const where = initialStatusApplied ? `"${initialStatusApplied}"` : "its default column";
    lines.push(
      ``,
      `This issue is on the board in ${where}. Want me to move it to "In Progress" and start? ` +
      `(I can call update_project_status for #${issue.number}.)`
    );
  }

  if (config.promptForMetadata && !input.assignees && !input.labels) {
    lines.push(
      ``,
      `Tip: You can include assignees and labels next time:`,
      `  assignees: ["your-github-username"]`,
      `  labels: ["feature", "bug"]`,
      `Or set OKFFS_PROMPT_METADATA=false in .env to hide this tip.`
    );
  }

  return {
    content: [{ type: "text" as const, text: lines.join("\n") }],
  };
}
