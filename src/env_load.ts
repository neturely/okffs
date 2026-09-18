// .env inheritance (#308): load the git-root .env, then the working directory's
// .env on top, with the closer file winning.
//
// Multisite (#306): shared values (token, board id, branches, merge methods)
// live once at the repo root, and each site directory's .env overlays only what
// differs. Single-site is unchanged: when the working directory IS the git root
// there is exactly one file and it is loaded exactly once, as before.
//
// dotenv never overrides a key that is already set, so "closer wins" is
// achieved by loading the working directory's file FIRST and the root's second
// — and the real process environment (set by the MCP host / shell) still wins
// over both, exactly as it did with `dotenv/config`.

import fs from "fs";
import path from "path";
import dotenv from "dotenv";

/**
 * Walk up from `start` to the nearest directory containing a `.git` entry (a
 * directory, or the file a worktree/submodule carries). Never throws; returns
 * null when no repository encloses `start`.
 */
export function findGitRoot(start: string): string | null {
  let dir = path.resolve(start);
  for (;;) {
    try {
      if (fs.existsSync(path.join(dir, ".git"))) return dir;
    } catch {
      return null;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * The .env files to load, in load order: the working directory's first (so it
 * wins), then the git root's. Deduplicated, so the single-site case yields one
 * path. Pure over its inputs.
 */
export function envFilesFor(cwd: string, gitRoot: string | null): string[] {
  const here = path.resolve(cwd);
  const files = [path.join(here, ".env")];
  if (gitRoot) {
    const rootFile = path.join(path.resolve(gitRoot), ".env");
    if (rootFile !== files[0]) files.push(rootFile);
  }
  return files;
}

export interface LoadedEnv {
  /** Files that existed and were applied, in load order. */
  loaded: string[];
  /** The git root used for inheritance, or null (cwd only). */
  gitRoot: string | null;
}

/**
 * Populate `target` (default: process.env) from the resolved .env files. A
 * missing file is skipped silently — an unconfigured checkout must not fail
 * here (that's `okffs setup`'s job). Quiet: nothing is ever written to stdout,
 * which is the MCP transport. Values are never logged.
 */
export function loadEnv(cwd: string = process.cwd(), target: NodeJS.ProcessEnv = process.env): LoadedEnv {
  const gitRoot = findGitRoot(cwd);
  const loaded: string[] = [];
  for (const file of envFilesFor(cwd, gitRoot)) {
    let exists = false;
    try {
      exists = fs.existsSync(file);
    } catch {
      exists = false;
    }
    if (!exists) continue;
    const result = dotenv.config({ path: file, processEnv: target as dotenv.DotenvPopulateInput, quiet: true });
    if (!result.error) loaded.push(file);
  }
  return { loaded, gitRoot };
}
