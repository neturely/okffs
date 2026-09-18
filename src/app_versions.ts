// Per-app version probing at arbitrary refs (#310/#312). Which repo-relative
// roots hold each app's version file, and what version each app is at a given
// commit — read through the contents API so no checkout is needed. Shared by
// the post-merge tagging (merge commit vs its parent) and the promotion
// release summary (head tip vs base tip).

import path from "path";
import { config } from "./config.js";
import { resolveApp } from "./apps.js";
import { findGitRoot } from "./env_load.js";
import { getFileContentAtRef } from "./github.js";
import { versionFromFiles } from "./tagging.js";

export interface AppRoots {
  name: string | null;
  tagPrefix: string;
  /** Repo-relative roots to try, in order ("" = repo root). */
  roots: string[];
}

// Registry apps live at `{app}/` by convention; the session's own app
// (OKFFS_APP) is wherever this session runs from (its .env), which also covers
// a root that is itself an app. Single-site (no registry, no app) probes the
// repo root with the "v" prefix.
export function appRootsToProbe(cwd: string = process.cwd()): AppRoots[] {
  const gitRoot = findGitRoot(cwd);
  const here = gitRoot ? path.relative(gitRoot, cwd).split(path.sep).join("/") : "";
  const names = config.apps.length > 0 ? config.apps : config.app ? [config.app] : [];
  if (names.length === 0) return [{ name: null, tagPrefix: "v", roots: [""] }];
  const apps: AppRoots[] = names.map((name) => {
    const roots = [name];
    if (name === config.app && here !== name) roots.unshift(here); // session app: its actual dir first
    return { name, tagPrefix: resolveApp({ name }).tagPrefix, roots: [...new Set(roots)] };
  });
  // A registry without a root OKFFS_APP means the root may still release the
  // flat way (v-tags, root version file) — probe it too so that release is
  // summarised and tagged rather than silently skipped.
  if (!config.app) apps.push({ name: null, tagPrefix: "v", roots: [""] });
  return apps;
}

/** The first version found across `roots` at `ref` (package.json, else VERSION), or null. */
export async function versionAt(roots: string[], ref: string): Promise<string | null> {
  for (const root of roots) {
    const prefix = root ? `${root}/` : "";
    const [packageJson, versionFile] = await Promise.all([
      getFileContentAtRef(`${prefix}package.json`, ref),
      getFileContentAtRef(`${prefix}VERSION`, ref),
    ]);
    const v = versionFromFiles({ packageJson, versionFile });
    if (v) return v;
  }
  return null;
}

export interface AppVersionPair {
  name: string | null;
  tagPrefix: string;
  versionAtA: string | null;
  versionAtB: string | null;
}

/** Every app's version at two refs (B may be null → all versionAtB null). */
export async function probeAppVersions(refA: string, refB: string | null): Promise<AppVersionPair[]> {
  const out: AppVersionPair[] = [];
  for (const app of appRootsToProbe()) {
    const [versionAtA, versionAtB] = await Promise.all([
      versionAt(app.roots, refA),
      refB ? versionAt(app.roots, refB) : Promise.resolve(null),
    ]);
    out.push({ name: app.name, tagPrefix: app.tagPrefix, versionAtA, versionAtB });
  }
  return out;
}
