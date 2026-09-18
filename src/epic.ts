// Epic handling (#323). Pure — no imports — so the "does this issue get a
// branch?" decision is unit-testable.
//
// An Epic is a container for child issues and never carries code of its own,
// so it gets no branch, no **Branch:** line, no init commit and no draft PR:
// a draft PR with `Closes #N` would close the epic on merge while its children
// are still open. The decision is made on the REQUESTED type (what the caller
// or OKFFS_DEFAULT_TYPE asked for), so it holds even when the org has no native
// "Epic" type and the type write is skipped.

const EPIC = "epic";

/** Whether a requested/resolved Issue Type name means "Epic" (case-insensitive). */
export function isEpicType(type: string | null | undefined): boolean {
  return (type ?? "").trim().toLowerCase() === EPIC;
}

/** The type name off a REST issue object's `type` field ({ name } | string | null). */
export function issueTypeName(raw: unknown): string | null {
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object" && typeof (raw as { name?: unknown }).name === "string") return (raw as { name: string }).name;
  return null;
}

/** One-line note explaining why an epic has no branch/PR. */
export function epicNoBranchNote(): string {
  return "none — Epics carry no code; work lands on the child issues (no draft PR either, so merging can never close the epic early)";
}

/** Actionable message for a tool that needs a branch but was pointed at an epic. */
export function epicToolRefusal(tool: string, issueNumber: number): string {
  return `[okffs] #${issueNumber} is an Epic — it has no branch of its own, so ${tool} does not apply. Run it against one of the epic's child issues (see its ## Relationships / children in list_issues).`;
}
