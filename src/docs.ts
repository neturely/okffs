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

  // Update the compare links at the bottom.
  const repoUrl = `https://github.com/${owner}/${repo}`;
  const unreleasedLink = `[Unreleased]: ${repoUrl}/compare/v${version}...HEAD`;
  const versionLink = `[${version}]: ${repoUrl}/compare/v${prevVersion}...v${version}`;
  const versionRefExists = new RegExp(`^\\[${version.replace(/\./g, "\\.")}\\]:`, "m").test(result);

  if (/^\[Unreleased\]:/m.test(result)) {
    result = result.replace(/^\[Unreleased\]:.*$/m, unreleasedLink);
    // Add the new version ref after [Unreleased], unless it's already there
    // (avoids a duplicate if prepare_release is re-run for the same version).
    if (!versionRefExists) {
      result = result.replace(/^(\[Unreleased\]:.*\n)/m, `$1${versionLink}\n`);
    }
  } else {
    // No compare links yet (new/manually-edited changelog) — append a block.
    result = result.replace(/\s*$/, "") + `\n\n${unreleasedLink}\n`;
    if (!versionRefExists) result += `${versionLink}\n`;
  }
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

// --- Changelog fragments (#105) --------------------------------------------
// Writing directly into the shared CHANGELOG.md on every issue branch makes
// parallel branches deterministically conflict (add/add when the file is new,
// same-hunk when it exists). Instead, each PR drops a uniquely-named fragment
// under .changes/unreleased/ — those never collide — and prepare_release
// assembles them into CHANGELOG.md at release time (changesets/towncrier style).

const FRAGMENT_DIR = path.join(".changes", "unreleased");

// Kebab-case the first few words of a title/summary for a stable fragment name.
function slugify(text: string, maxWords = 6): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .split("-")
    .filter(Boolean)
    .slice(0, maxWords)
    .join("-");
}

// Build a per-issue fragment: a uniquely-named file whose first line carries the
// change type in a machine-readable comment, followed by the changelog bullet.
function buildFragment(ctx: DocsContext): { relPath: string; content: string } {
  const type = getChangeType(ctx);
  const entry = buildChangelogEntry(ctx);
  const source = ctx.issueTitle || ctx.summary || ctx.trigger;
  const slug = slugify(source) || "entry";
  // Prefix with the issue number when present — that alone guarantees a distinct
  // filename per issue, which is what eliminates the cross-branch conflict.
  const baseName = ctx.issueNumber ? `${ctx.issueNumber}-${slug}` : slug;
  const relPath = path.join(FRAGMENT_DIR, `${baseName}.md`);
  const content = `<!-- okffs:type=${type} -->\n${entry}\n`;
  return { relPath, content };
}

export interface FragmentFold {
  changelog: string;
  consumed: string[]; // repo-relative paths of the fragments folded in
  count: number;
}

// Fold every .changes/unreleased/*.md fragment into the changelog's [Unreleased]
// section (grouped under the right ### heading), returning the new changelog text
// and the fragment paths that were consumed (so the caller can `git rm` them).
// A no-op when the directory is absent or empty — keeps prepare_release working
// on repos that never used fragments.
export function foldFragmentsIntoChangelog(changelog: string, base: string): FragmentFold {
  const dir = path.join(base, FRAGMENT_DIR);
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
  } catch {
    return { changelog, consumed: [], count: 0 };
  }

  let result = changelog;
  const consumed: string[] = [];
  for (const f of files) {
    let raw: string;
    try {
      raw = fs.readFileSync(path.join(dir, f), "utf8");
    } catch {
      continue;
    }
    const typeMatch = raw.match(/okffs:type=(\w+)/);
    const type = typeMatch ? typeMatch[1] : "Changed";
    const entry = raw
      .split("\n")
      .filter((l) => l.trim() && !/okffs:type=/.test(l))
      .join("\n")
      .trim();
    if (!entry) continue;
    result = insertChangelogEntry(result, type, entry);
    consumed.push(path.join(FRAGMENT_DIR, f));
  }
  return { changelog: result, consumed, count: consumed.length };
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

  // Changelog — write a per-issue fragment instead of editing the shared
  // CHANGELOG.md, so parallel branches never conflict (#105). prepare_release
  // assembles the fragments into CHANGELOG.md at release time. The CHANGELOG.md
  // exclude key still suppresses the entry entirely, for parity with before.
  if (!isExcluded("CHANGELOG.md")) {
    const frag = buildFragment(ctx);
    updates.push({ path: path.join(base, frag.relPath), content: frag.content, created: true });
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
        // Fragments live under .changes/unreleased/, which may not exist yet.
        fs.mkdirSync(path.dirname(u.path), { recursive: true });
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
