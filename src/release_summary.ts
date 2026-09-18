// Promotion release summary (#312). Pure — no imports — so "which apps carry a
// release in this promotion, and which tags will that mean?" is unit-testable.
// The same rule as the post-merge tagging (#310): an app is released by the
// promotion when its version at the head tip differs from its version at the
// base tip — so the summary in the PR body names exactly the tags the merge
// will produce.

export interface ReleaseProbe {
  name: string | null;
  tagPrefix: string;
  versionAtHead: string | null;
  versionAtBase: string | null;
}

export interface ReleaseEntry {
  app: string | null;
  from: string | null;
  to: string;
  tag: string;
}

export function summarizeReleases(probes: ReleaseProbe[]): ReleaseEntry[] {
  return probes
    .filter((p): p is ReleaseProbe & { versionAtHead: string } => Boolean(p.versionAtHead) && p.versionAtHead !== p.versionAtBase)
    .map((p) => ({ app: p.name, from: p.versionAtBase, to: p.versionAtHead, tag: `${p.tagPrefix}${p.versionAtHead}` }));
}

const label = (e: ReleaseEntry) => (e.app ? `**${e.app}**` : "release");
const range = (e: ReleaseEntry) => (e.from ? `${e.from} → ${e.to}` : `${e.to} (first release)`);

/** Markdown section for the PR body, or null when the promotion carries no release. */
export function renderReleaseSection(entries: ReleaseEntry[]): string | null {
  if (entries.length === 0) return null;
  return [
    `## Releases in this promotion`,
    ...entries.map((e) => `- ${label(e)}: ${range(e)} — tag \`${e.tag}\` after merge`),
  ].join("\n");
}

/** One-line note for the tool response, or null. */
export function renderReleaseNote(entries: ReleaseEntry[], tagRelease: boolean): string | null {
  if (entries.length === 0) return null;
  const items = entries.map((e) => `${e.app ?? "release"} ${range(e)} (${e.tag})`).join("; ");
  const how = tagRelease ? `OKFFS_TAG_RELEASE will tag on the re-run after merge.` : `Tag after merge: ${entries.map((e) => `\`${e.tag}\``).join(", ")}.`;
  return `📦 Releases carried: ${items}. ${how}`;
}
