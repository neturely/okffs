// The startup info banner: package version, resolved owner/repo, branch tiers,
// and which optional features are active. Factored out (plain string, no prompt
// library) so a future `okffs status` command can reuse it standalone.

import { readFileSync } from "node:fs";

export function packageVersion(): string {
  try {
    // dist/cli/banner.js → ../../package.json is the package root in both the
    // published layout and local dist build.
    return JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version;
  } catch {
    return "unknown";
  }
}

function isTrue(v: string | undefined): boolean {
  return v === "true";
}

// Booleans that default ON (OKFFS_*_METADATA/INFER) are "off" only at "false".
function isOff(v: string | undefined): boolean {
  return v === "false";
}

export interface BannerInfo {
  version: string;
  owner?: string;
  repo?: string;
  tokenSource: "env" | "gh" | "none";
  baseBranch: string;
  protectedBranch: string;
  features: string[];
}

export function buildBannerInfo(
  values: Record<string, string>,
  resolved: { owner?: string; repo?: string; tokenSource: "env" | "gh" | "none" }
): BannerInfo {
  const features: string[] = [];
  if (isTrue(values.OKFFS_PROJECT_ENABLED)) features.push("Projects v2 board");
  if (isTrue(values.OKFFS_AUTO_PR)) features.push("auto draft-PR on new issue");
  if (isTrue(values.OKFFS_AUTO_MERGE_BASE)) features.push("auto-merge into base");
  if (isTrue(values.OKFFS_UPDATE_DOCS)) features.push("auto doc updates");
  if (isTrue(values.OKFFS_RESOLVE_THREADS)) features.push("auto-resolve review threads");
  if (isTrue(values.OKFFS_UPDATE_GUIDANCE)) features.push("guidance sync");
  if (isTrue(values.OKFFS_CLASSIC_PAT)) features.push("classic PAT (org Issue Fields)");
  if (isTrue(values.OKFFS_PROMOTION_AUTO_REVIEW)) features.push("auto-request promotion reviewers");
  if (isOff(values.OKFFS_INFER_PRIORITY) || isOff(values.OKFFS_INFER_EFFORT) || isOff(values.OKFFS_INFER_TYPE)) {
    features.push("some inference disabled");
  }

  return {
    version: packageVersion(),
    owner: resolved.owner,
    repo: resolved.repo,
    tokenSource: resolved.tokenSource,
    baseBranch: values.OKFFS_BASE_BRANCH || "(repo default)",
    protectedBranch: values.OKFFS_PROTECTED_BRANCH || "(none)",
    features,
  };
}

export function renderBanner(info: BannerInfo): string {
  const tokenLabel = info.tokenSource === "env" ? "GITHUB_TOKEN" : info.tokenSource === "gh" ? "gh CLI" : "none";
  const lines = [
    `okffs v${info.version}`,
    `repo:      ${info.owner && info.repo ? `${info.owner}/${info.repo}` : "(unresolved)"}`,
    `token:     ${tokenLabel}`,
    `base:      ${info.baseBranch}`,
    `protected: ${info.protectedBranch}`,
    `features:  ${info.features.length ? info.features.join(", ") : "defaults only"}`,
  ];
  return lines.join("\n");
}
