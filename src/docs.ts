import fs from "fs";
import path from "path";
import { config } from "./config.js";
import { owner, repo } from "./github.js";

// Scoped to: CHANGELOG.md (always) and SECURITY.md (security-related changes only).
// Entries are title-based one-liners — concise and complete, so nothing needs
// manual curation. CHANGELOG.md is created if missing; SECURITY.md is only
// updated if it exists. CLAUDE.md and CONTRIBUTING.md are intentionally not
// auto-updated (they previously got noisy, truncated changelog-style appends).
// Files are written locally to process.cwd(). Committing is the user's responsibility.
// Failures warn only — never throw.

export interface DocsContext {
  trigger: string;
  issueNumber?: number;
  issueTitle?: string;
  summary: string;
  branchName?: string;
}

interface FileUpdate {
  path: string;
  content: string;
  created: boolean;
}

function isoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function getChangeType(ctx: DocsContext): string {
  const lower = (ctx.issueTitle ?? ctx.trigger).toLowerCase();
  if (/fix|bug|error|crash|broken/.test(lower)) return "Fixed";
  if (/add|new|create|implement|feature/.test(lower)) return "Added";
  if (/remove|delete|deprecat/.test(lower)) return "Removed";
  if (/security|vulnerability|cve/.test(lower)) return "Security";
  return "Changed";
}

// Truncate at a word boundary (never mid-word) so summaries don't get cut into
// a half-word followed by an ellipsis.
function truncateAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  return (lastSpace > 0 ? slice.slice(0, lastSpace) : slice).trimEnd() + "…";
}

function buildChangelogEntry(ctx: DocsContext): string {
  const ref = ctx.issueNumber ? ` ([#${ctx.issueNumber}](https://github.com/${owner}/${repo}/issues/${ctx.issueNumber}))` : "";
  // Title-based entry: titles are already concise and complete, so the entry is
  // readable with nothing to curate. We deliberately do NOT append a truncated
  // excerpt of the (often long) summary — that produced incomplete-looking,
  // ellipsis-ended entries that needed manual cleanup on every PR. truncateAtWord
  // remains only as a safety net for an unusually long title.
  // Prefer the issue title; fall back to the summary (non-issue triggers like
  // delete_branch pass a meaningful summary but no title) before the bare trigger.
  const source = ctx.issueTitle || ctx.summary || ctx.trigger;
  const title = truncateAtWord(source.replace(/\s+/g, " ").trim(), 120);
  return `- ${title}${ref}`;
}

// Return the body of the ## [Unreleased] section (everything between that
// heading and the next "## [" version heading), or null if there's no marker.
export function getUnreleasedSection(changelog: string): string | null {
  const marker = "## [Unreleased]";
  const idx = changelog.indexOf(marker);
  if (idx === -1) return null;
  const after = idx + marker.length;
  const nextRel = changelog.slice(after).search(/\n## \[/);
  return (nextRel === -1 ? changelog.slice(after) : changelog.slice(after, after + nextRel)).trim();
}

// Roll the CHANGELOG for a release: move the [Unreleased] entries under a new
// "## [version] - date" heading, leave a fresh empty [Unreleased], and update
// the compare links at the bottom. Returns the new changelog text.
export function rollChangelogForRelease(
  changelog: string,
  version: string,
  prevVersion: string,
  date: string
): string {
  const marker = "## [Unreleased]";
  const idx = changelog.indexOf(marker);
  if (idx === -1) throw new Error("CHANGELOG.md has no ## [Unreleased] section.");

  const after = idx + marker.length;
  const nextRel = changelog.slice(after).search(/\n## \[/);
  const bodyEnd = nextRel === -1 ? changelog.length : after + nextRel;
  const body = changelog.slice(after, bodyEnd).replace(/\s+$/, ""); // entries, trimmed
  const head = changelog.slice(0, after); // up to & including "## [Unreleased]"
  const tail = changelog.slice(bodyEnd); // "\n## [prev]…" onward (incl. links)

  let result = `${head}\n\n## [${version}] - ${date}${body}\n${tail}`;

  // Update the link refs at the bottom.
  const repoUrl = `https://github.com/${owner}/${repo}`;
  result = result.replace(
    /\[Unreleased\]:\s*\S+/,
    `[Unreleased]: ${repoUrl}/compare/v${version}...HEAD`
  );
  result = result.replace(
    /(\[Unreleased\]:[^\n]*\n)/,
    `$1[${version}]: ${repoUrl}/compare/v${prevVersion}...v${version}\n`
  );
  return result;
}

// Insert a changelog entry under the ## [Unreleased] section, scoping the search
// for the type heading (### Added, ### Fixed, …) to that section only. Without
// scoping, an existing "### Added" under the latest *released* version would
// match first and the entry would land in the wrong place.
function insertChangelogEntry(changelog: string, type: string, entry: string): string {
  const unreleasedMarker = "## [Unreleased]";
  const typeHeading = `### ${type}`;
  const markerIdx = changelog.indexOf(unreleasedMarker);

  // No [Unreleased] section yet — add one above the first released version
  // heading, or at the end of the file if there are none.
  if (markerIdx === -1) {
    const block = `${unreleasedMarker}\n${typeHeading}\n${entry}\n\n`;
    const firstVersionIdx = changelog.search(/\n## \[/);
    if (firstVersionIdx !== -1) {
      const at = firstVersionIdx + 1; // preserve the leading newline
      return changelog.slice(0, at) + block + changelog.slice(at);
    }
    return changelog.trimEnd() + "\n\n" + block.trimEnd() + "\n";
  }

  // Bounds of the [Unreleased] block: from the marker to the next "## " heading.
  const afterMarker = markerIdx + unreleasedMarker.length;
  const nextSectionRel = changelog.slice(afterMarker).search(/\n## /);
  const blockEnd = nextSectionRel === -1 ? changelog.length : afterMarker + nextSectionRel;

  const head = changelog.slice(0, afterMarker);
  let block = changelog.slice(afterMarker, blockEnd);
  const tail = changelog.slice(blockEnd);

  const typeIdxInBlock = block.indexOf(typeHeading);
  if (typeIdxInBlock !== -1) {
    // Insert right after the existing type heading within the Unreleased block.
    const insertAt = typeIdxInBlock + typeHeading.length;
    block = block.slice(0, insertAt) + "\n" + entry + block.slice(insertAt);
  } else {
    // Add the type heading and entry at the end of the Unreleased block.
    block = block.replace(/\s*$/, "") + `\n${typeHeading}\n${entry}\n`;
  }

  return head + block + tail;
}

function shouldUpdateSecurity(ctx: DocsContext): boolean {
  const lower = (ctx.issueTitle ?? "") + ctx.summary;
  return /security|vulnerability|cve/i.test(lower);
}

function readFile(filePath: string): string | null {
  try {
    return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null;
  } catch {
    return null;
  }
}

function determineUpdates(ctx: DocsContext, base: string): FileUpdate[] {
  const updates: FileUpdate[] = [];

  const isExcluded = (filename: string): boolean =>
    config.excludeDocs.some((f) => f.toLowerCase() === filename.toLowerCase());

  // CHANGELOG.md — always append an entry under ## [Unreleased] or at the end
  if (!isExcluded("CHANGELOG.md")) {
    const changelogPath = path.join(base, "CHANGELOG.md");
    const changelog = readFile(changelogPath);
    const type = getChangeType(ctx);
    const entry = buildChangelogEntry(ctx);
    if (changelog !== null) {
      updates.push({ path: changelogPath, content: insertChangelogEntry(changelog, type, entry), created: false });
    } else {
      updates.push({
        path: changelogPath,
        content: `# Changelog\n\nAll notable changes to this project will be documented in this file.\nSee [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).\n\n## [Unreleased]\n### ${type}\n${entry}`,
        created: true,
      });
    }
  }

  // SECURITY.md — only for security-related triggers. Title-based one-liner.
  if (shouldUpdateSecurity(ctx) && !isExcluded("SECURITY.md")) {
    const secPath = path.join(base, "SECURITY.md");
    const sec = readFile(secPath);
    if (sec !== null) {
      const source = ctx.issueTitle || ctx.summary || ctx.trigger;
      const title = truncateAtWord(source.replace(/\s+/g, " ").trim(), 120);
      const line = `\n- ${isoDate()}${ctx.issueNumber ? ` (#${ctx.issueNumber})` : ""}: ${title}`;
      updates.push({ path: secPath, content: sec.trimEnd() + line, created: false });
    }
  }

  // Note: CLAUDE.md and CONTRIBUTING.md are intentionally NOT auto-updated.
  // They previously got truncated "## Recent Changes"/"## Changelog" appends
  // that duplicated the CHANGELOG and required manual cleanup every PR. The
  // CHANGELOG is the single auto-doc target now (plus SECURITY.md when relevant).

  return updates;
}

// Returns the repo-relative paths of the files that were actually written, so
// callers can stage exactly those (rather than assuming only CHANGELOG.md
// changed). Paths are relative to base (process.cwd()) so they pass cleanly to
// `git add`, which runs from the same working directory.
export async function updateProjectDocs(ctx: DocsContext): Promise<string[]> {
  try {
    const base = process.cwd();
    const updates = determineUpdates(ctx, base);
    if (updates.length === 0) return [];

    const written: string[] = [];
    for (const u of updates) {
      try {
        fs.writeFileSync(u.path, u.content, "utf8");
        written.push(path.relative(base, u.path));
      } catch (err) {
        console.warn(`[okffs] docs: failed to write ${u.path}:`, err);
      }
    }

    return written;
  } catch (err) {
    console.warn("[okffs] docs: unexpected error:", err);
    return [];
  }
}
