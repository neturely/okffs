// GitHub Release entries for tags okffs creates (#337). Pure — no imports —
// so the notes extraction and naming are unit-testable.

/**
 * The body of the `## [version]` section of a Keep-a-Changelog file: from its
 * heading to the next `## [` heading or the link-reference block (`[x]: url`
 * lines), so a section that is last in the file doesn't slurp the footer.
 * Same rule as okffs's own publish.yml. Null when the section is absent.
 */
export function extractChangelogSection(changelog: string, version: string): string | null {
  const lines = changelog.split("\n");
  const start = lines.findIndex((l) => l.startsWith(`## [${version}]`));
  if (start === -1) return null;
  const out: string[] = [];
  for (const l of lines.slice(start + 1)) {
    if (l.startsWith("## [")) break;
    if (/^\[[^\]]+\]:\s*\S/.test(l)) break;
    out.push(l);
  }
  const body = out.join("\n").trim();
  return body.length > 0 ? body : null;
}

/** Release title: the tag for single-site (`v1.2.0`), `{app} {version}` for an app. */
export function releaseTitle(app: string | null, version: string, tag: string): string {
  return app ? `${app} ${version}` : tag;
}

/** Prerelease only for a suffixed version (`1.0.0-rc.1`) — 0.x is a normal release. */
export function isPrereleaseVersion(version: string): boolean {
  return version.includes("-");
}

/** Notes body, with a fallback when the changelog has no section for the version. */
export function releaseNotes(section: string | null, app: string | null, version: string): string {
  if (section) return section;
  const where = app ? `${app}/CHANGELOG.md` : "CHANGELOG.md";
  return `Release ${version}. (No \`## [${version}]\` section found in ${where} at the tagged commit.)`;
}
