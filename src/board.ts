// Shared GitHub Projects v2 board placement for issue-creating tools
// (create_issue, create_issues_from_list, plan). Centralises: adding an issue to
// the board, setting Priority/Effort (project-native single-select OR org-level
// Issue Field — #91), applying the initial Status, and rendering the outcome.
//
// Every skip/failure is returned as data and surfaced in the tool response, never
// only console.warn'd to stderr (which the host/user never sees) — #146. The add
// itself throwing is the one fatal-to-board case; callers catch it into
// `boardError`. Field writes are always non-fatal.

import { config } from "./config.js";
import {
  addIssueToProject,
  getProjectMetadata,
  setProjectFieldValue,
  getOrgIssueField,
  setIssueFieldSingleSelect,
  type ProjectMetadata,
} from "./projects.js";

// Outcome of a single board field write: applied, or skipped with a reason.
export type BoardFieldOutcome = { applied: string } | { skipped: string };

export interface BoardAddResult {
  itemId: string;
  priority: BoardFieldOutcome | null; // null when no priority was requested
  effort: BoardFieldOutcome | null;
}

export interface InitialStatusResult {
  applied: string | null;
  skipped: string | null;
}

// Whether create_* tools should attempt board auto-add at all.
export function boardAutoAddEnabled(): boolean {
  return Boolean(config.projectAutoAdd && config.projectEnabled);
}

// Set a board single-select field (Priority, Effort, …) to `value`. Handles both
// shapes: a project-native single-select (set on the project item), and a GitHub
// org-level Issue Field (project field reports no options → set on the issue via
// setIssueFieldSingleSelect, gated on OKFFS_CLASSIC_PAT — #91). Returns
// { skipped: reason } on any miss and { applied } on success; also warns to
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

// Add an issue to the configured board and set Priority/Effort. Throws if the add
// itself fails (caller catches into boardError). Field writes never throw. Does
// NOT set the initial Status — that must run after any draft PR (see
// applyInitialStatus) so it wins GitHub's linked-PR "In Progress" promotion (#103).
export async function addIssueToBoard(
  issueNodeId: string,
  opts: { priority?: string | null; effort?: string | null }
): Promise<BoardAddResult> {
  const itemId = await addIssueToProject(issueNodeId);
  let priority: BoardFieldOutcome | null = null;
  let effort: BoardFieldOutcome | null = null;
  if (opts.priority || opts.effort) {
    const meta = await getProjectMetadata();
    if (opts.priority) {
      priority = await applyBoardSingleSelect("Priority", opts.priority, itemId, issueNodeId, meta);
    }
    if (opts.effort) {
      effort = await applyBoardSingleSelect("Effort", opts.effort, itemId, issueNodeId, meta);
    }
  }
  return { itemId, priority, effort };
}

// Pin the board Status to OKFFS_PROJECT_INITIAL_STATUS for a freshly-added item.
// No-op (returns nulls) when the env var is unset. Non-fatal: any miss is returned
// as `skipped` and warned to stderr. Call AFTER the draft PR so it wins the race
// with GitHub's linked-PR automation (#103).
export async function applyInitialStatus(itemId: string): Promise<InitialStatusResult> {
  if (!config.projectInitialStatus) return { applied: null, skipped: null };
  const wanted = config.projectInitialStatus;
  try {
    const meta = await getProjectMetadata();
    const optionId = meta.statusFieldId ? meta.statusOptions.get(wanted) : undefined;
    if (meta.statusFieldId && optionId) {
      await setProjectFieldValue(itemId, meta.statusFieldId, optionId);
      return { applied: wanted, skipped: null };
    }
    const skipped = !meta.statusFieldId
      ? "the board has no Status field."
      : `no matching Status option. Board Status options: ${[...meta.statusOptions.keys()].join(", ")}.`;
    console.warn(`[okffs] initial status "${wanted}" not set: ${skipped}`);
    return { applied: null, skipped };
  } catch (err) {
    const skipped = `Status write failed — ${err instanceof Error ? err.message : String(err)}`;
    console.warn(`[okffs] initial status "${wanted}" not set: ${skipped}`);
    return { applied: null, skipped };
  }
}

// Render board outcome lines for a tool response — shared by all three creators so
// applied fields and every skip read identically. `indent` prefixes each line
// (batch tools nest board lines under their per-issue entry).
export function renderBoardLines(args: {
  addedToBoard: boolean;
  boardError: string | null;
  requestedPriority?: string | null;
  priority: BoardFieldOutcome | null;
  requestedEffort?: string | null;
  effort: BoardFieldOutcome | null;
  requestedStatus?: string | null;
  initialStatus: InitialStatusResult | null;
  indent?: string;
}): string[] {
  const ind = args.indent ?? "";
  const lines: string[] = [];

  if (args.addedToBoard) {
    const bits = [
      args.priority && "applied" in args.priority ? `priority: ${args.priority.applied}` : null,
      args.effort && "applied" in args.effort ? `effort: ${args.effort.applied}` : null,
      args.initialStatus?.applied ? `status: ${args.initialStatus.applied}` : null,
    ].filter(Boolean);
    lines.push(`${ind}Board: added to the project${bits.length ? ` (${bits.join(", ")})` : ""}`);

    // Surface any requested-but-not-applied field so an enabled board step is
    // never silently dropped (the issue is still created fine) — see #146.
    const skips = [
      args.priority && "skipped" in args.priority ? `Priority "${args.requestedPriority}" not set — ${args.priority.skipped}` : null,
      args.effort && "skipped" in args.effort ? `Effort "${args.requestedEffort}" not set — ${args.effort.skipped}` : null,
      args.initialStatus?.skipped ? `Initial status "${args.requestedStatus}" not set — ${args.initialStatus.skipped}` : null,
    ].filter(Boolean);
    for (const s of skips) lines.push(`${ind}  ⚠ ${s}`);
  } else if (args.boardError) {
    // Auto-add was enabled but the add itself failed. Surface it (not just the
    // server log) so an empty board doesn't look like success — see #101.
    lines.push(
      `${ind}Board: NOT added — auto-add is on but failed. The issue itself was created fine.`,
      `${ind}  ${args.boardError}`
    );
  }

  return lines;
}
