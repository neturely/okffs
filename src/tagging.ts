// Post-merge release tagging (#310). Pure — no imports — so the "should this
// merged promotion be tagged, and with what?" decision is unit-testable.
//
// okffs never merges the protected branch itself (that is the user's gate, or
// #311's explicit opt-in), so the tag can only land AFTER the promotion PR is
// merged: a promote_branch re-run finds the latest merged head→base PR, probes
// each app's version at the merge commit and at its first parent, and tags
// exactly the apps whose version changed in that promotion. The checks below
// are correctness stops, not consent prompts — OKFFS_TAG_RELEASE=true is the
// consent, and a moved tip or a mismatched tag must never be tagged blindly.

export interface AppVersionProbe {
  /** App name (null = single-site). */
  name: string | null;
  /** "v" or "{app}-". */
  tagPrefix: string;
  /** Version at the merge commit, or null when the app has no version file there. */
  versionAtMerge: string | null;
  /** Version at the merge commit's first parent (the tip before the merge), or null. */
  versionAtParent: string | null;
}

export interface TagContext {
  mergeCommitSha: string;
  protectedTipSha: string;
  /** Existing tags (name → sha) for the candidate tag names. */
  existingTags: Map<string, string>;
}

export type TagDecision =
  | { action: "tag"; tag: string; sha: string; app: string | null }
  | { action: "already"; tag: string; app: string | null }
  | { action: "skip"; tag: string | null; app: string | null; reason: string; silent: boolean };

/** Parse a version out of a package.json text or a VERSION file text. */
export function versionFromFiles(files: { packageJson?: string | null; versionFile?: string | null }): string | null {
  // A package.json, once present, is the source of truth — a malformed one
  // yields no version rather than silently falling back to VERSION, matching
  // readVersionSource (which errors) so tagging can't diverge from prepare_release.
  if (files.packageJson) {
    try {
      const v = JSON.parse(files.packageJson).version;
      return typeof v === "string" && /^\d+\.\d+\.\d+/.test(v) ? v : null;
    } catch {
      return null;
    }
  }
  if (files.versionFile) {
    const v = files.versionFile.trim();
    if (/^\d+\.\d+\.\d+$/.test(v)) return v;
  }
  return null;
}

export function decideTags(probes: AppVersionProbe[], ctx: TagContext): TagDecision[] {
  return probes.map((p) => {
    const label = p.name ?? "release";
    if (!p.versionAtMerge) {
      return { action: "skip", tag: null, app: p.name, reason: `${label}: no version file at the merge commit.`, silent: true };
    }
    const tag = `${p.tagPrefix}${p.versionAtMerge}`;
    if (p.versionAtParent === p.versionAtMerge) {
      return { action: "skip", tag, app: p.name, reason: `${label}: version ${p.versionAtMerge} unchanged by this promotion.`, silent: true };
    }
    const existing = ctx.existingTags.get(tag);
    if (existing === ctx.mergeCommitSha) {
      return { action: "already", tag, app: p.name };
    }
    if (existing) {
      return { action: "skip", tag, app: p.name, reason: `${tag} already exists on ${existing.slice(0, 7)}, not on the merge commit ${ctx.mergeCommitSha.slice(0, 7)} — leaving it alone; move it by hand if that is intended.`, silent: false };
    }
    if (ctx.protectedTipSha !== ctx.mergeCommitSha) {
      return { action: "skip", tag, app: p.name, reason: `${tag} not created — the target branch tip (${ctx.protectedTipSha.slice(0, 7)}) has moved past the promotion's merge commit (${ctx.mergeCommitSha.slice(0, 7)}). Tag ${ctx.mergeCommitSha.slice(0, 7)} by hand if that is what you want.`, silent: false };
    }
    return { action: "tag", tag, sha: ctx.mergeCommitSha, app: p.name };
  });
}

/** Human report for the promote_branch notes — null when there is nothing worth saying. */
export function renderTagReport(prNumber: number, decisions: TagDecision[], failures: Array<{ tag: string; error: string }> = []): string | null {
  const lines: string[] = [];
  for (const d of decisions) {
    if (d.action === "tag") {
      const failed = failures.find((f) => f.tag === d.tag);
      lines.push(failed ? `⚠️ Could not create tag ${d.tag}: ${failed.error}` : `🏷️ Tagged ${d.tag} at ${d.sha.slice(0, 7)} (promotion PR #${prNumber} merged)${d.app ? ` — make sure your release workflow triggers on \`${d.tag.split("-")[0]}-*\` tags, not only \`v*\`` : " — CI publishes on the tag"}.`);
    } else if (d.action === "already") {
      lines.push(`🏷️ ${d.tag} already points at PR #${prNumber}'s merge commit — nothing to do.`);
    } else if (!d.silent) {
      lines.push(`⚠️ ${d.reason}`);
    }
  }
  return lines.length > 0 ? lines.join("\n") : null;
}
