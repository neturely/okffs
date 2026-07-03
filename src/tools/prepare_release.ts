import { z } from "zod";
import fs from "fs";
import path from "path";
import { createPullRequest, getDefaultBranch } from "../github.js";
import { getUnreleasedSection, rollChangelogForRelease, foldFragmentsIntoChangelog } from "../docs.js";
import { git, currentBranch } from "../git.js";

export const name = "prepare_release";

export const description =
  "Prepare a release: bump the version in package.json and package-lock.json, roll the CHANGELOG ([Unreleased] → a dated version section with a fresh empty [Unreleased] and updated compare links), commit on a release branch, and open a PR. It does NOT tag or publish — tagging vX.Y.Z (which triggers the CI npm publish) stays a manual step after merge. Provide an explicit `version` or a `bump` level; if neither is given, a level is inferred from the [Unreleased] entries (### Added → minor, otherwise patch) and surfaced for confirmation. Two-step: call once to preview, re-call with confirmed: true to apply.";

export const inputSchema = z.object({
  version: z.string().optional().describe("Explicit target version, e.g. 0.1.7 (takes precedence over bump)"),
  bump: z.enum(["patch", "minor", "major"]).optional().describe("Semver bump level if version is not given"),
  confirmed: z.boolean().optional().describe("Must be true to apply (otherwise previews)"),
});

function bumpVersion(v: string, type: "patch" | "minor" | "major"): string {
  const m = v.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) throw new Error(`Cannot parse current version "${v}".`);
  const [maj, min, pat] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (type === "major") return `${maj + 1}.0.0`;
  if (type === "minor") return `${maj}.${min + 1}.0`;
  return `${maj}.${min}.${pat + 1}`;
}

// Replace the first `count` occurrences of an exact substring. Throws if fewer
// than `count` occurrences exist — a partial version bump must never proceed.
function replaceExactly(content: string, search: string, replace: string, count: number, label: string): string {
  const found = content.split(search).length - 1;
  if (found < count) {
    throw new Error(`Expected at least ${count} occurrence(s) of \`${search}\` in ${label} but found ${found}. Aborting to avoid an inconsistent version bump.`);
  }
  let out = content;
  let from = 0;
  for (let i = 0; i < count; i++) {
    const at = out.indexOf(search, from);
    out = out.slice(0, at) + replace + out.slice(at + search.length);
    from = at + replace.length;
  }
  return out;
}

export async function handler(input: z.infer<typeof inputSchema>) {
  const base = process.cwd();
  const pkg = JSON.parse(fs.readFileSync(path.join(base, "package.json"), "utf8"));
  const currentVersion: string = pkg.version;

  const changelogRaw = fs.readFileSync(path.join(base, "CHANGELOG.md"), "utf8");
  // Fold any per-issue fragments (#105) into [Unreleased] before the emptiness
  // and bump-level checks, so entries that live in .changes/unreleased/ count.
  const previewFold = foldFragmentsIntoChangelog(changelogRaw, base);
  const changelog = previewFold.changelog;
  const unreleased = getUnreleasedSection(changelog);
  if (unreleased === null) {
    return { content: [{ type: "text" as const, text: "CHANGELOG.md has no ## [Unreleased] section — nothing to release." }] };
  }
  if (!/^[-*] /m.test(unreleased)) {
    return { content: [{ type: "text" as const, text: "The ## [Unreleased] section has no entries (and no .changes/unreleased fragments) — nothing to release." }] };
  }

  // Resolve the target version.
  let targetVersion: string;
  let how: string;
  if (input.version) {
    if (!/^\d+\.\d+\.\d+$/.test(input.version)) {
      return { content: [{ type: "text" as const, text: `Invalid version "${input.version}" — expected X.Y.Z.` }] };
    }
    targetVersion = input.version;
    how = "explicit version";
  } else {
    const level = input.bump ?? (/###\s+Added/.test(unreleased) ? "minor" : "patch");
    targetVersion = bumpVersion(currentVersion, level);
    how = input.bump ? `${level} bump` : `inferred ${level} bump (### Added present → minor, else patch)`;
  }

  const branch = `release/${targetVersion}`;

  if (!input.confirmed) {
    return {
      content: [{
        type: "text" as const,
        text:
          `Release preview\n` +
          `  current: ${currentVersion}\n` +
          `  target:  ${targetVersion}  (${how})\n` +
          `  branch:  ${branch}\n\n` +
          `Will: bump package.json + package-lock.json, roll the CHANGELOG into "## [${targetVersion}]", ` +
          (previewFold.count > 0 ? `assemble ${previewFold.count} changelog fragment(s) and delete them, ` : ``) +
          `commit on ${branch}, and open a PR. It will NOT tag or publish.\n\n` +
          `[Unreleased] entries to be released${previewFold.count > 0 ? " (fragments included)" : ""}:\n${unreleased}\n\n` +
          `Re-call prepare_release with confirmed: true to apply.`,
      }],
    };
  }

  const baseBranch = await getDefaultBranch();
  const previousBranch = currentBranch();
  let prepared = false;
  let fragmentsAssembled = 0;
  try {
    git(["fetch", "origin"]);
    git(["checkout", "-B", branch, `origin/${baseBranch}`]);

    // Re-read on the base branch so edits apply to the correct content.
    const pkgPath = path.join(base, "package.json");
    const lockPath = path.join(base, "package-lock.json");
    const clPath = path.join(base, "CHANGELOG.md");

    const pkgRaw = fs.readFileSync(pkgPath, "utf8");
    const lockRaw = fs.readFileSync(lockPath, "utf8");
    const clRaw = fs.readFileSync(clPath, "utf8");
    const fromVersion: string = JSON.parse(pkgRaw).version;

    // The preview computed targetVersion from the working tree's version. If the
    // base branch is actually at a different version and no explicit version was
    // given, the inferred target would be wrong — abort rather than bump blindly.
    if (!input.version && fromVersion !== currentVersion) {
      throw new Error(
        `Base branch ${baseBranch} is at version ${fromVersion}, but the preview was based on ${currentVersion}. ` +
        `Re-run with an explicit \`version\` to proceed.`
      );
    }

    const date = new Date().toISOString().slice(0, 10);

    // Compute all new contents up front (with validation) so a failure can't
    // leave a partial bump written to disk. Targeted version-field edits avoid
    // reformatting; package-lock has two self-version fields (root + packages[""]).
    const newPkg = replaceExactly(pkgRaw, `"version": "${fromVersion}"`, `"version": "${targetVersion}"`, 1, "package.json");
    const newLock = replaceExactly(lockRaw, `"version": "${fromVersion}"`, `"version": "${targetVersion}"`, 2, "package-lock.json");
    // Assemble fragments from the base branch's working tree, then roll. The
    // fragments were committed on their issue branches and merged into base, so
    // they're present here; we delete them in the same release commit (#105).
    const applyFold = foldFragmentsIntoChangelog(clRaw, base);
    const newCl = rollChangelogForRelease(applyFold.changelog, targetVersion, fromVersion, date);

    fs.writeFileSync(pkgPath, newPkg);
    fs.writeFileSync(lockPath, newLock);
    fs.writeFileSync(clPath, newCl);

    fragmentsAssembled = applyFold.consumed.length;
    if (applyFold.consumed.length > 0) {
      git(["rm", "--quiet", "--", ...applyFold.consumed]);
    }
    git(["add", "package.json", "package-lock.json", "CHANGELOG.md"]);
    git(["commit", "-m", `release: ${targetVersion}`]);
    git(["push", "-u", "origin", branch]);
    prepared = true;
  } catch (err) {
    return {
      content: [{ type: "text" as const, text: `Release prep failed: ${err instanceof Error ? err.message : String(err)}` }],
    };
  } finally {
    if (previousBranch && previousBranch !== branch) {
      try {
        git(["checkout", previousBranch]);
      } catch (err) {
        console.warn(`[okffs] Failed to restore branch ${previousBranch}:`, err instanceof Error ? err.message : err);
      }
    }
  }

  if (!prepared) {
    return { content: [{ type: "text" as const, text: "Release prep did not complete." }] };
  }

  const prBody = [
    `## Release ${targetVersion}`,
    ``,
    `- Bumped \`package.json\` and \`package-lock.json\` to ${targetVersion}.`,
    `- Rolled the CHANGELOG \`[Unreleased]\` section into \`## [${targetVersion}]\` and refreshed the compare links.`,
    ...(fragmentsAssembled > 0
      ? [`- Assembled and removed ${fragmentsAssembled} changelog fragment(s) from \`.changes/unreleased/\`.`]
      : []),
    ``,
    `After merging, tag \`v${targetVersion}\` and push it — CI (\`publish.yml\`) publishes to npm on the tag. This PR does not tag or publish.`,
  ].join("\n");

  let pr: { number: number; html_url: string };
  try {
    pr = await createPullRequest(`Release ${targetVersion}`, prBody, branch, baseBranch);
  } catch (err) {
    // The release branch is already pushed; only PR creation failed.
    return {
      content: [{
        type: "text" as const,
        text:
          `Release branch \`${branch}\` was prepared and pushed (version ${targetVersion}, CHANGELOG rolled), ` +
          `but opening the PR failed: ${err instanceof Error ? err.message : String(err)}\n\n` +
          `Open a PR from \`${branch}\` into \`${baseBranch}\` manually (e.g. \`gh pr create --base ${baseBranch} --head ${branch}\`). ` +
          `After it merges, tag \`v${targetVersion}\` and push it to trigger the CI publish.`,
      }],
    };
  }

  return {
    content: [{
      type: "text" as const,
      text:
        `Prepared release ${targetVersion} (from ${currentVersion}).\n` +
        `Branch: ${branch}\nPR: ${pr.html_url}\n\n` +
        `Next: review & merge the PR, then tag \`v${targetVersion}\` and push it — CI publishes to npm. ` +
        `prepare_release does not tag or publish.`,
    }],
  };
}
