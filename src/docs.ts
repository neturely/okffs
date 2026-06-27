import fs from "fs";
import path from "path";
import { config } from "./config.js";

// Scoped to: CLAUDE.md, CHANGELOG.md, SECURITY.md, CONTRIBUTING.md
// CHANGELOG.md is created if missing. Others are only updated if they exist.
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
  const ref = ctx.issueNumber ? ` ([#${ctx.issueNumber}](https://github.com/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/issues/${ctx.issueNumber}))` : "";
  const title = ctx.issueTitle ?? ctx.trigger;

  const cleanSummary = ctx.summary
    .replace(/\*\*Branch:\*\*\s*`[^`]+`/g, "")
    .replace(/## Relationships[\s\S]*/g, "")
    .replace(/^(Closed:|Fixed:|Added:|Changed:)\s*/i, "")
    .replace(/\s+/g, " ") // collapse newlines/runs of whitespace into a single line
    .trim();

  const truncated = truncateAtWord(cleanSummary, 200);
  const summaryPart = truncated && truncated !== title ? ` — ${truncated}` : "";
  return `- ${title}${ref}${summaryPart}`;
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

function shouldUpdateContributing(ctx: DocsContext): boolean {
  const lower = (ctx.issueTitle ?? "") + ctx.summary;
  return /convention|contributing|workflow/i.test(lower);
}

function shouldUpdateClaude(ctx: DocsContext): boolean {
  const lower = (ctx.issueTitle ?? "") + ctx.summary;
  return /convention|workflow|tool|config|setup|architecture/i.test(lower);
}

function appendToSection(content: string, heading: string, entry: string): string {
  if (content.includes(heading)) {
    return content.replace(heading, heading + entry);
  }
  return content.trimEnd() + "\n\n" + heading + entry;
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

  // CLAUDE.md — only for convention/workflow/tool/config changes
  if (shouldUpdateClaude(ctx) && !isExcluded("CLAUDE.md")) {
    const claudePath = path.join(base, "CLAUDE.md");
    const claude = readFile(claudePath);
    if (claude !== null) {
      const line = `\n- ${isoDate()}${ctx.issueNumber ? ` ([#${ctx.issueNumber}](https://github.com/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/issues/${ctx.issueNumber}))` : ""}: ${ctx.summary.slice(0, 200)}`;
      updates.push({
        path: claudePath,
        content: appendToSection(claude, "## Recent Changes", line),
        created: false,
      });
    }
  }

  // SECURITY.md — only for security-related triggers
  if (shouldUpdateSecurity(ctx) && !isExcluded("SECURITY.md")) {
    const secPath = path.join(base, "SECURITY.md");
    const sec = readFile(secPath);
    if (sec !== null) {
      const line = `\n- ${isoDate()}${ctx.issueNumber ? ` (#${ctx.issueNumber})` : ""}: ${ctx.summary}`;
      updates.push({ path: secPath, content: sec.trimEnd() + line, created: false });
    }
  }

  // CONTRIBUTING.md — only when conventions changed
  if (shouldUpdateContributing(ctx) && !isExcluded("CONTRIBUTING.md")) {
    const contribPath = path.join(base, "CONTRIBUTING.md");
    const contrib = readFile(contribPath);
    if (contrib !== null) {
      const line = `\n- ${isoDate()}: ${ctx.summary}`;
      updates.push({
        path: contribPath,
        content: appendToSection(contrib, "## Changelog", line),
        created: false,
      });
    }
  }

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
