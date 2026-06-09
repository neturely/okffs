import fs from "fs";
import path from "path";

// Scoped to: README.md, CLAUDE.md, CHANGELOG.md, SECURITY.md, CONTRIBUTING.md
// CHANGELOG.md is created if missing. Others are only updated if they exist.
// Files are written locally to process.cwd(). Committing is the user's responsibility.
// Failures warn only — never throw.

const SCOPED_FILES = ["README.md", "CLAUDE.md", "CHANGELOG.md", "SECURITY.md", "CONTRIBUTING.md"];

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

function buildChangelogEntry(ctx: DocsContext): string {
  const ref = ctx.issueNumber ? ` ([#${ctx.issueNumber}](../../issues/${ctx.issueNumber}))` : "";
  const title = ctx.issueTitle ?? ctx.trigger;

  const cleanSummary = ctx.summary
    .replace(/\*\*Branch:\*\*\s*`[^`]+`/g, "")
    .replace(/## Relationships[\s\S]*/g, "")
    .replace(/^(Closed:|Fixed:|Added:|Changed:)\s*/i, "")
    .trim();

  const truncated = cleanSummary.length > 100 ? cleanSummary.slice(0, 97) + "..." : cleanSummary;
  const summaryPart = truncated && truncated !== title ? ` — ${truncated}` : "";
  return `- ${title}${ref}${summaryPart}`;
}

function shouldUpdateReadme(_ctx: DocsContext): boolean {
  return false;
}

function shouldUpdateSecurity(ctx: DocsContext): boolean {
  const lower = (ctx.issueTitle ?? "") + ctx.summary;
  return /security|vulnerability|cve/i.test(lower);
}

function shouldUpdateContributing(ctx: DocsContext): boolean {
  const lower = (ctx.issueTitle ?? "") + ctx.summary;
  return /convention|contributing|workflow/i.test(lower);
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

  // CHANGELOG.md — always append an entry under ## [Unreleased] or at the end
  const changelogPath = path.join(base, "CHANGELOG.md");
  const changelog = readFile(changelogPath);
  const type = getChangeType(ctx);
  const entry = buildChangelogEntry(ctx);
  if (changelog !== null) {
    const unreleasedMarker = "## [Unreleased]";
    const typeHeading = `### ${type}`;
    let newContent: string;
    if (changelog.includes(unreleasedMarker)) {
      if (changelog.includes(typeHeading)) {
        newContent = changelog.replace(typeHeading, typeHeading + "\n" + entry + "\n");
      } else {
        // Find the end of the [Unreleased] block and append the new type heading there
        // instead of inserting right after the marker, to avoid gaps between type sections
        const unreleasedEnd = changelog.indexOf("\n## ", changelog.indexOf(unreleasedMarker) + 1);
        if (unreleasedEnd !== -1) {
          newContent = changelog.slice(0, unreleasedEnd) + "\n" + typeHeading + "\n" + entry + "\n" + changelog.slice(unreleasedEnd);
        } else {
          newContent = changelog.trimEnd() + "\n" + typeHeading + "\n" + entry.trimEnd() + "\n";
        }
      }
    } else {
      newContent = changelog.trimEnd() + "\n\n" + typeHeading + "\n" + entry;
    }
    updates.push({ path: changelogPath, content: newContent, created: false });
  } else {
    updates.push({
      path: changelogPath,
      content: `# Changelog\n\nAll notable changes to this project will be documented in this file.\nSee [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).\n\n## [Unreleased]\n### ${type}\n${entry}`,
      created: true,
    });
  }

  // README.md — only for user-facing triggers, append to ## Recent Changes if present
  if (shouldUpdateReadme(ctx)) {
    const readmePath = path.join(base, "README.md");
    const readme = readFile(readmePath);
    if (readme !== null) {
      const line = `- ${isoDate()}${ctx.issueNumber ? ` — closes #${ctx.issueNumber}` : ""}: ${ctx.summary}`;
      updates.push({
        path: readmePath,
        content: appendToSection(readme, "## Recent Changes", "\n" + line),
        created: false,
      });
    }
  }

  // SECURITY.md — only for security-related triggers
  if (shouldUpdateSecurity(ctx)) {
    const secPath = path.join(base, "SECURITY.md");
    const sec = readFile(secPath);
    if (sec !== null) {
      const line = `\n- ${isoDate()}${ctx.issueNumber ? ` (#${ctx.issueNumber})` : ""}: ${ctx.summary}`;
      updates.push({ path: secPath, content: sec.trimEnd() + line, created: false });
    }
  }

  // CONTRIBUTING.md — only when conventions changed
  if (shouldUpdateContributing(ctx)) {
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

export async function updateProjectDocs(ctx: DocsContext): Promise<string | null> {
  try {
    const base = process.cwd();
    const updates = determineUpdates(ctx, base);
    if (updates.length === 0) return null;

    const results: string[] = [];
    for (const u of updates) {
      try {
        fs.writeFileSync(u.path, u.content, "utf8");
        const name = path.basename(u.path);
        results.push(u.created ? `created ${name}` : `updated ${name}`);
      } catch (err) {
        console.warn(`[okffs] docs: failed to write ${u.path}:`, err);
      }
    }

    return results.length > 0 ? results.join(", ") : null;
  } catch (err) {
    console.warn("[okffs] docs: unexpected error:", err);
    return null;
  }
}
