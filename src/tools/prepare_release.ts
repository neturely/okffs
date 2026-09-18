import { z } from "zod";
import fs from "fs";
import path from "path";
import { createPullRequest, getDefaultBranch } from "../github.js";
import { getUnreleasedSection, rollChangelogForRelease, foldFragmentsIntoChangelog } from "../docs.js";
import { bumpVersion } from "../version.js";
import { readVersionSource, writeVersionBump } from "../version_source.js";
import { resolveApp, tagName, releaseBranchName } from "../apps.js";
import { git, currentBranch } from "../git.js";
import { config } from "../config.js";

export const name = "prepare_release";

export const description =
  "Prepare a release: bump the version (package.json + package-lock.json when present, else a plain VERSION file — created on the first release if neither exists), roll the CHANGELOG ([Unreleased] → a dated version section with a fresh empty [Unreleased] and updated compare links), commit on a release branch, and open a PR. It does NOT tag or publish — tagging (which triggers the CI npm publish) stays a manual step after merge. Provide an explicit `version` or a `bump` level; if neither is given, a level is inferred from the [Unreleased] entries (### Added → minor, otherwise patch) and surfaced for confirmation. Two-step: call once to preview, re-call with confirmed: true to apply.";

export const inputSchema = z.object({
  version: z.string().optional().describe("Explicit target version, e.g. 0.1.7 (takes precedence over bump)"),
  bump: z.enum(["patch", "minor", "major"]).optional().describe("Semver bump level if version is not given"),
  confirmed: z.boolean().optional().describe("Must be true to apply (otherwise previews)"),
});

// bumpVersion lives in version.ts; the version source (package.json / VERSION)
// in version_source.ts; paths, tag and branch names come from the app
// descriptor in apps.ts (#307) — all pure/fs-only and unit-tested.

export async function handler(input: z.infer<typeof inputSchema>) {
  // #309 wires OKFFS_APP here; until then this is always the single-site descriptor.
  const app = resolveApp();
  const base = path.resolve(process.cwd(), app.root);
  const clPath = path.join(base, app.changelogPath);
  const clName = app.changelogPath;

  let source;
  try {
    source = readVersionSource(base);
  } catch (err) {
    return { content: [{ type: "text" as const, text: `Cannot resolve the current version: ${err instanceof Error ? err.message : String(err)}` }] };
  }
  const currentVersion = source.version;
  const versionNote = source.note ? `\n⚠ ${source.note}` : "";

  if (!fs.existsSync(clPath)) {
    return { content: [{ type: "text" as const, text: `${clName} not found under ${app.root} — nothing to release.` }] };
  }
  const changelogRaw = fs.readFileSync(clPath, "utf8");
  // Fold any per-issue fragments (#105) into [Unreleased] before the emptiness
  // and bump-level checks, so entries that live in the fragments dir count.
  const previewFold = foldFragmentsIntoChangelog(changelogRaw, base, app.fragmentsDir);
  const changelog = previewFold.changelog;
  const unreleased = getUnreleasedSection(changelog);
  if (unreleased === null) {
    return { content: [{ type: "text" as const, text: `${clName} has no ## [Unreleased] section — nothing to release.` }] };
  }
  if (!/^[-*] /m.test(unreleased)) {
    return { content: [{ type: "text" as const, text: `The ## [Unreleased] section has no entries (and no ${app.fragmentsDir} fragments) — nothing to release.` }] };
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

  const branch = releaseBranchName(app, targetVersion);
  const tag = tagName(app, targetVersion);
  const versionFiles = source.files.join(" + ");

  if (!input.confirmed) {
    return {
      content: [{
        type: "text" as const,
        text:
          `Release preview${app.name ? ` (app: ${app.name})` : ""}\n` +
          `  current: ${currentVersion}  (${source.kind === "none" ? "no version file yet" : source.kind})\n` +
          `  target:  ${targetVersion}  (${how})\n` +
          `  branch:  ${branch}\n` +
          `  tag:     ${tag} (after merge, by you)${versionNote}\n\n` +
          `Will: bump ${versionFiles}, roll ${clName} into "## [${targetVersion}]", ` +
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
  let bumpedFiles: string[] = [];
  try {
    git(["fetch", "origin"]);
    git(["checkout", "-B", branch, `origin/${baseBranch}`]);

    // Re-read on the base branch so edits apply to the correct content.
    const baseSource = readVersionSource(base);
    const clRaw = fs.readFileSync(clPath, "utf8");
    const fromVersion = baseSource.version;

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

    // Assemble fragments from the base branch's working tree, then roll. The
    // fragments were committed on their issue branches and merged into base, so
    // they're present here; we delete them in the same release commit (#105).
    // Compute the changelog before any write so a failure can't leave a partial
    // bump on disk (writeVersionBump validates all of its files up front too).
    const applyFold = foldFragmentsIntoChangelog(clRaw, base, app.fragmentsDir);
    const newCl = rollChangelogForRelease(applyFold.changelog, targetVersion, fromVersion, date, app.tagPrefix);

    bumpedFiles = writeVersionBump(base, baseSource, fromVersion, targetVersion);
    fs.writeFileSync(clPath, newCl);

    fragmentsAssembled = applyFold.consumed.length;
    // git runs from cwd; stage by cwd-relative paths so an app root works too.
    const rel = (p: string) => path.relative(process.cwd(), path.join(base, p));
    if (applyFold.consumed.length > 0) {
      git(["rm", "--quiet", "--", ...applyFold.consumed.map(rel)]);
    }
    git(["add", "--", ...bumpedFiles.map(rel), rel(app.changelogPath)]);
    git(["commit", "-m", app.name ? `release: ${app.name} ${targetVersion}` : `release: ${targetVersion}`]);
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

  const bumpedList = bumpedFiles.map((f) => `\`${f}\``).join(" and ");
  const prBody = [
    `## Release ${app.name ? `${app.name} ` : ""}${targetVersion}`,
    ``,
    `- Bumped ${bumpedList} to ${targetVersion}.${source.kind === "none" ? " (Created VERSION — no package.json in this app.)" : ""}`,
    `- Rolled the ${clName} \`[Unreleased]\` section into \`## [${targetVersion}]\` and refreshed the compare links.`,
    ...(fragmentsAssembled > 0
      ? [`- Assembled and removed ${fragmentsAssembled} changelog fragment(s) from \`${app.fragmentsDir}/\`.`]
      : []),
    ``,
    `After merging, tag \`${tag}\` and push it — CI publishes on the tag. This PR does not tag or publish.`,
  ].join("\n");

  let pr: { number: number; html_url: string };
  try {
    pr = await createPullRequest(`Release ${app.name ? `${app.name} ` : ""}${targetVersion}`, prBody, branch, baseBranch);
  } catch (err) {
    // The release branch is already pushed; only PR creation failed.
    return {
      content: [{
        type: "text" as const,
        text:
          `Release branch \`${branch}\` was prepared and pushed (version ${targetVersion}, ${clName} rolled), ` +
          `but opening the PR failed: ${err instanceof Error ? err.message : String(err)}\n\n` +
          `Open a PR from \`${branch}\` into \`${baseBranch}\` manually (e.g. \`gh pr create --base ${baseBranch} --head ${branch}\`). ` +
          `After it merges, tag \`${tag}\` and push it to trigger the CI publish.`,
      }],
    };
  }

  // When a protected branch is configured, spell out that promoting the release
  // into it (and the tag that triggers the publish) are manual, user-gated steps
  // — an agent must not drive them autonomously (#152).
  // This release PR targets the base branch (OKFFS_BASE_BRANCH), which is often
  // NOT the protected branch — so phrase the note conditionally rather than
  // asserting the release merges into the protected branch.
  const protectedNote = config.protectedBranch
    ? `\n\n⛔ OKFFS_PROTECTED_BRANCH is \`${config.protectedBranch}\`. If you plan to promote this ` +
      `release into \`${config.protectedBranch}\` and tag \`${tag}\` (which triggers the npm ` +
      `publish), those are USER-GATED steps — hand back to the user for the check and sign-off; ` +
      `do not proceed autonomously.`
    : "";

  return {
    content: [{
      type: "text" as const,
      text:
        `Prepared release ${targetVersion} (from ${currentVersion}).${versionNote}\n` +
        `Branch: ${branch}\nPR: ${pr.html_url}\n\n` +
        `Next: review & merge the PR, then tag \`${tag}\` and push it — CI publishes to npm. ` +
        `prepare_release does not tag or publish.` +
        protectedNote,
    }],
  };
}
