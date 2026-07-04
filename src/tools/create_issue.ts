import { z } from "zod";
import { createIssue, updateIssueBody, getDefaultBranch, getRef, createBranch, buildBranchName, createDraftPullRequest } from "../github.js";
import { config } from "../config.js";
import { git, currentBranch } from "../git.js";
import { addIssueToProject, getProjectMetadata, setProjectFieldValue, getOrgIssueField, setIssueFieldSingleSelect, type ProjectMetadata } from "../projects.js";

// Outcome of a board field write: either the value was applied, or it was
// skipped for a reason. The reason is threaded back to the tool response (not
// just console.warn'd to the server's stderr, which the host/user never sees —
// see #146) so an enabled-but-skipped field is never silent.
type BoardFieldOutcome = { applied: string } | { skipped: string };

// Set a board single-select field (Priority, Effort, …) to `value`. Handles both
// shapes: a project-native single-select (set on the project item), and a GitHub
// org-level Issue Field (project field reports no options → set on the issue via
// setIssueFieldSingleSelect, gated on OKFFS_CLASSIC_PAT — #91). Non-fatal: returns
// a { skipped: reason } on any miss and { applied } on success. Also warns to
// stderr for server logs, but the returned reason is what the caller surfaces.
async function applyBoardSingleSelect(
  label: string,
  value: string,
  itemId: string,
  issueNodeId: string,
  meta: ProjectMetadata
): Promise<BoardFieldOutcome> {
  const skip = (reason: string): BoardFieldOutcome => {
    console.warn(`[okffs] ${label} "${value}" not set: ${reason}`);
    return { skipped: reason };
  };

  const native = meta.singleSelectByName.get(label.toLowerCase());
  if (!native) {
    return skip(`the board has no ${label} field.`);
  }
  // Project-native single-select with resolvable options.
  if (native.options.size > 0) {
    const optionId = native.options.get(value);
    if (optionId) {
      await setProjectFieldValue(itemId, native.fieldId, optionId);
      return { applied: value };
    }
    return skip(`no matching option. Board ${label} options: ${[...native.options.keys()].join(", ")}.`);
  }
  // No options via the project API → it's a GitHub org-level Issue Field.
  if (!config.classicPat) {
    return skip(
      `the board's ${label} is an org-level Issue Field, which okffs can only set with a classic ` +
        `PAT (\`admin:org\`) and OKFFS_CLASSIC_PAT=true (security tradeoff — see docs). Set it in the board UI for now.`
    );
  }
  try {
    const orgField = await getOrgIssueField(label);
    if (!orgField) {
      return skip(`no org-level ${label} Issue Field found.`);
    }
    const orgOptionId = orgField.options.get(value);
    if (!orgOptionId) {
      return skip(`no matching org Issue Field option. Options: ${[...orgField.options.keys()].join(", ")}.`);
    }
    await setIssueFieldSingleSelect(issueNodeId, orgField.fieldId, orgOptionId);
    return { applied: value };
  } catch (err) {
    // Permission (fine-grained PAT FORBIDDEN) / preview-API errors — never fatal.
    return skip(`org Issue Field write failed — ${err instanceof Error ? err.message : String(err)}`);
  }
}

export const name = "create_issue";

// Priority/Effort inference guidance is woven into the tool description so Claude
// uses its own judgement to triage the issue it's creating (like it already does
// for labels), falling back to OKFFS_DEFAULT_* only when it can't tell. Toggle per
// field with OKFFS_INFER_PRIORITY / OKFFS_INFER_EFFORT (default on).
function inferenceGuidance(): string {
  const bits: string[] = [];
  if (config.inferPriority) {
    bits.push(
      "infer a `priority` for the issue from its urgency and impact (typical scale: Urgent, High, Medium, Low)"
    );
  }
  if (config.inferEffort) {
    bits.push(
      "infer an `effort` from the expected amount of work (typical scale: High, Medium, Low)"
    );
  }
  if (bits.length === 0) return "";
  return (
    ` Also ${bits.join(" and ")}, passing the value(s) in the matching parameter. ` +
    "okffs matches these against the board's actual options and falls back to OKFFS_DEFAULT_PRIORITY / OKFFS_DEFAULT_EFFORT when you omit them — so if you genuinely can't judge, omit the field rather than guessing."
  );
}

export const description =
  "Create a GitHub issue and automatically create a matching branch. Before calling this tool, infer appropriate labels from the issue title and description using GitHub's default labels: bug, documentation, duplicate, enhancement, good first issue, help wanted, invalid, question, wontfix. Pass the inferred labels in the labels parameter unless the user has specified their own." +
  inferenceGuidance() +
  " If the user mentions that this issue is blocked by, blocking, or a child of another issue, call link_issues after creating this issue to set the relationship. Returns the issue URL, issue number, and branch name.";

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
  let priorityOutcome: BoardFieldOutcome | null = null;
  let effortOutcome: BoardFieldOutcome | null = null;
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
          priorityOutcome = await applyBoardSingleSelect("Priority", resolvedPriority, itemId, issue.node_id, meta);
        }
        if (resolvedEffort) {
          effortOutcome = await applyBoardSingleSelect("Effort", resolvedEffort, itemId, issue.node_id, meta);
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
  let initialStatusSkipped: string | null = null;
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
        initialStatusSkipped = "the board has no Status field.";
      } else {
        initialStatusSkipped = `no matching Status option. Board Status options: ${[...meta.statusOptions.keys()].join(", ")}.`;
      }
    } catch (err) {
      initialStatusSkipped = `Status write failed — ${err instanceof Error ? err.message : String(err)}`;
    }
    if (initialStatusSkipped) {
      console.warn(`[okffs] initial status "${config.projectInitialStatus}" not set: ${initialStatusSkipped}`);
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
      priorityOutcome && "applied" in priorityOutcome ? `priority: ${priorityOutcome.applied}` : null,
      effortOutcome && "applied" in effortOutcome ? `effort: ${effortOutcome.applied}` : null,
      initialStatusApplied ? `status: ${initialStatusApplied}` : null,
    ].filter(Boolean);
    lines.push(
      `Board: added to the project${bits.length ? ` (${bits.join(", ")})` : ""}`
    );
    // Surface any requested-but-not-applied field so an enabled board step is
    // never silently dropped (the issue is still created fine) — see #146.
    const skips = [
      priorityOutcome && "skipped" in priorityOutcome ? `Priority "${resolvedPriority}" not set — ${priorityOutcome.skipped}` : null,
      effortOutcome && "skipped" in effortOutcome ? `Effort "${resolvedEffort}" not set — ${effortOutcome.skipped}` : null,
      initialStatusSkipped ? `Initial status "${config.projectInitialStatus}" not set — ${initialStatusSkipped}` : null,
    ].filter(Boolean);
    for (const s of skips) lines.push(`  ⚠ ${s}`);
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
