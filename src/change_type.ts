// Changelog fragment heading (### Added / Fixed / …) for an issue. The issue's
// own classification wins over title keywords: a Bug-type or `bug`-labelled
// issue is Fixed, a Feature-type or `enhancement`/`feature`-labelled one is
// Added, a `security` label is Security. Only when none of those apply does the
// title-keyword heuristic decide. Pure.

export interface ChangeTypeInput {
  /** Native GitHub Issue Type name (Bug, Feature, Task, …), when known. */
  issueType?: string | null;
  /** Issue labels — GitHub label objects or plain names. */
  labels?: Array<{ name: string } | string> | null;
  /** Issue title (or the trigger text when there is no issue). */
  title: string;
}

function labelNames(labels: ChangeTypeInput["labels"]): Set<string> {
  return new Set((labels ?? []).map((l) => (typeof l === "string" ? l : l.name).toLowerCase()));
}

/** Title-keyword fallback — the pre-#359 behaviour. Pure. */
export function changeTypeFromTitle(title: string): string {
  const lower = title.toLowerCase();
  if (/fix|bug|error|crash|broken/.test(lower)) return "Fixed";
  if (/add|new|create|implement|feature/.test(lower)) return "Added";
  if (/remove|delete|deprecat/.test(lower)) return "Removed";
  if (/security|vulnerability|cve/.test(lower)) return "Security";
  return "Changed";
}

export function changeTypeFor(input: ChangeTypeInput): string {
  const labels = labelNames(input.labels);
  const type = (input.issueType ?? "").toLowerCase();
  if (labels.has("security")) return "Security";
  if (type === "bug" || labels.has("bug")) return "Fixed";
  if (type === "feature" || labels.has("enhancement") || labels.has("feature")) return "Added";
  return changeTypeFromTitle(input.title);
}
