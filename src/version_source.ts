// Version-source resolution (#307): where an app's version lives and how to bump it.
//
// Order per app root: package.json (with package-lock.json when present), else a
// plain VERSION file ("X.Y.Z\n"). Neither present → "none": the caller reports
// the fallback and the first release creates VERSION. fs-only (no GitHub
// imports) so it is testable against a temp directory.

import fs from "fs";
import path from "path";
import { replaceExactly } from "./version.js";

export type VersionSourceKind = "package.json" | "VERSION" | "none";

export interface VersionSource {
  kind: VersionSourceKind;
  /** Current version; "0.0.0" when kind is "none". */
  version: string;
  /** Files (relative to root) a bump will write. */
  files: string[];
  /** Human note for the caller — set for the VERSION fallback and the "none" case. */
  note: string | null;
}

const VERSION_FILE = "VERSION";
const PKG = "package.json";
const LOCK = "package-lock.json";

function exists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

/** Detect the version source under `rootAbs`. Throws only on a malformed source. */
export function readVersionSource(rootAbs: string): VersionSource {
  const pkgPath = path.join(rootAbs, PKG);
  if (exists(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    const version = typeof pkg.version === "string" ? pkg.version : null;
    if (!version) throw new Error(`${PKG} has no "version" field.`);
    const files = exists(path.join(rootAbs, LOCK)) ? [PKG, LOCK] : [PKG];
    return { kind: "package.json", version, files, note: null };
  }
  const vPath = path.join(rootAbs, VERSION_FILE);
  if (exists(vPath)) {
    const version = fs.readFileSync(vPath, "utf8").trim();
    if (!/^\d+\.\d+\.\d+$/.test(version)) {
      throw new Error(`${VERSION_FILE} must contain a plain X.Y.Z version (found "${version}").`);
    }
    return { kind: "VERSION", version, files: [VERSION_FILE], note: `No ${PKG} — versioning via the ${VERSION_FILE} file.` };
  }
  return {
    kind: "none",
    version: "0.0.0",
    files: [VERSION_FILE],
    note: `No ${PKG} or ${VERSION_FILE} found — a ${VERSION_FILE} file will be created on release (from 0.0.0).`,
  };
}

/**
 * Write the bumped version into the source's files. Computes every new content
 * before writing so a validation failure can't leave a partial bump on disk.
 * Returns the files written (relative to root) for staging.
 */
export function writeVersionBump(rootAbs: string, source: VersionSource, from: string, to: string): string[] {
  const writes: Array<[string, string]> = [];
  if (source.kind === "package.json") {
    const pkgPath = path.join(rootAbs, PKG);
    // Targeted version-field edits avoid reformatting; package-lock has two
    // self-version fields (root + packages[""]).
    writes.push([pkgPath, replaceExactly(fs.readFileSync(pkgPath, "utf8"), `"version": "${from}"`, `"version": "${to}"`, 1, PKG)]);
    if (source.files.includes(LOCK)) {
      const lockPath = path.join(rootAbs, LOCK);
      writes.push([lockPath, replaceExactly(fs.readFileSync(lockPath, "utf8"), `"version": "${from}"`, `"version": "${to}"`, 2, LOCK)]);
    }
  } else {
    writes.push([path.join(rootAbs, VERSION_FILE), `${to}\n`]);
  }
  for (const [p, content] of writes) fs.writeFileSync(p, content);
  return writes.map(([p]) => path.relative(rootAbs, p));
}
