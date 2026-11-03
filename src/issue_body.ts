/**
 * Canonical issue-body param resolution (#282). `body` is the canonical name
 * (matching GitHub's own REST/GraphQL field and update_issue). The `description`
 * alias shipped in 0.11.0 as a one-release deprecation and was removed in #297.
 * Pure — no imports — so it is unit-testable.
 */
export type IssueBodyResolution =
  | { ok: true; body: string }
  | { ok: false; error: string };

export function resolveIssueBody(
  args: { body?: string },
  context: string
): IssueBodyResolution {
  if (args.body !== undefined) return { ok: true, body: args.body };
  return {
    ok: false,
    error: `[okffs] ${context}: an issue body is required — pass it as \`body\`. (The old \`description\` alias was removed in 0.12.0.)`,
  };
}

export interface IssueRelationships {
  parent: number[];
  blockedBy: number[];
  blocking: number[];
}

// Parse the "## Relationships" section written by link_issues, e.g.
//   - Blocked by #3
//   - Blocking #7
//   - Parent: #1
// (Moved here from github.ts in #259 so it's unit-testable.)
export function parseRelationships(body: string | null): IssueRelationships {
  const result: IssueRelationships = { parent: [], blockedBy: [], blocking: [] };
  if (!body) return result;

  const idx = body.indexOf("## Relationships");
  if (idx === -1) return result;

  let section = body.slice(idx + "## Relationships".length);
  const nextHeading = section.search(/\n## /);
  if (nextHeading !== -1) section = section.slice(0, nextHeading);

  for (const line of section.split("\n")) {
    const m = line.match(/^\s*-\s*(Blocked by|Blocking|Parent:?)\s*#(\d+)/i);
    if (!m) continue;
    const num = parseInt(m[2], 10);
    const label = m[1].toLowerCase();
    if (label.startsWith("blocked")) result.blockedBy.push(num);
    else if (label.startsWith("blocking")) result.blocking.push(num);
    else if (label.startsWith("parent")) result.parent.push(num);
  }
  return result;
}

// ── okffs-owned issue-body metadata (#295) ──────────────────────────────────
// okffs writes two blocks into issue bodies that callers never author and must
// not lose on a body rewrite: the "**Branch:** `{name}`" line (create_issue &
// friends) and the "## Relationships" section (link_issues). Pure — no imports
// — so extract/merge are unit-testable without touching github.ts.

// Anchored to a line start so a body that merely *quotes* the pattern mid-line
// (e.g. issue #295 itself quoting "**Branch:** `{branch}`" in prose) is not
// mistaken for the real metadata line.
const BRANCH_LINE_RE = /^\*\*Branch:\*\*[ \t]+`([^`\n]+)`[ \t]*$/m;

export function extractBranchFromBody(body: string | null): string | null {
  if (!body) return null;
  const match = body.match(BRANCH_LINE_RE);
  return match ? match[1] : null;
}

export interface IssueBodyMetadata {
  branchLine: string | null; // the full "**Branch:** `{name}`" line
  relationshipsSection: string | null; // the full "## Relationships" section, heading included
}

export function extractIssueMetadata(body: string | null): IssueBodyMetadata {
  const result: IssueBodyMetadata = { branchLine: null, relationshipsSection: null };
  if (!body) return result;

  const branchMatch = body.match(BRANCH_LINE_RE);
  if (branchMatch) result.branchLine = branchMatch[0].trimEnd();

  const relMatch = body.match(/^## Relationships[ \t]*$/m);
  if (relMatch && relMatch.index !== undefined) {
    let section = body.slice(relMatch.index);
    // The section runs until the next "## " heading (or a **Branch:** line,
    // which create_issue may have appended after it) — or the end of the body.
    const end = section.slice("## Relationships".length).search(/\n## |\n\*\*Branch:\*\*[ \t]+`/);
    if (end !== -1) section = section.slice(0, "## Relationships".length + end);
    result.relationshipsSection = section.trimEnd();
  }

  return result;
}

// Re-append okffs-owned metadata blocks that the new body dropped. A block the
// new body already carries (even modified — e.g. a caller-supplied Branch line
// pointing elsewhere) is left alone, so no duplicates. Returns the merged body
// plus human-readable labels of what was re-appended.
export function mergeIssueMetadata(
  newBody: string,
  metadata: IssueBodyMetadata
): { body: string; preserved: string[] } {
  let body = newBody;
  const preserved: string[] = [];

  if (metadata.branchLine && !BRANCH_LINE_RE.test(body)) {
    body = `${body.trimEnd()}\n\n${metadata.branchLine}`;
    preserved.push("**Branch:** line");
  }
  if (metadata.relationshipsSection && !/^## Relationships[ \t]*$/m.test(body)) {
    body = `${body.trimEnd()}\n\n${metadata.relationshipsSection}`;
    preserved.push("## Relationships");
  }

  return { body, preserved };
}

/**
 * The branch to use for an issue whose body has no **Branch:** line (#173,
 * #304): an explicit branch wins; otherwise the checked-out branch, but only
 * when it follows okffs's `{issue}-…` naming — an arbitrary branch is never
 * trusted. Pure.
 */
export function inferIssueBranch(issueNumber: number, current: string | null, explicit?: string): string | null {
  if (explicit) return explicit;
  return current && current.startsWith(`${issueNumber}-`) ? current : null;
}

/** Append the **Branch:** line to an issue body (trailing whitespace trimmed only). Pure. */
export function appendBranchLine(body: string | null, branch: string): string {
  const base = (body ?? "").trimEnd();
  return base ? `${base}\n\n**Branch:** \`${branch}\`` : `**Branch:** \`${branch}\``;
}
