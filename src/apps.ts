// App descriptor seam (#307) — the single place that knows where an app's
// release artefacts live and how its tags/branches are named.
//
// Multisite (#306): several apps in one repo (e.g. finance/, health/) share one
// issue tracker, board, branches and token, but get independent version,
// changelog, fragments, tags and release lines. Every release-related tool
// reads paths and names from an AppDescriptor instead of hardcoding them.
//
// Single-site is the degenerate case: with no app name the descriptor
// reproduces the pre-multisite layout byte for byte ("." root, "v" tag
// prefix, CHANGELOG.md, .changes/unreleased, release/X.Y.Z), so existing users
// see no behaviour change. Pure — no imports — so unit-testable; wiring the
// descriptor to OKFFS_APP / OKFFS_APPS lands in #309.

export interface AppDescriptor {
  /** App name, or null for the single-site (flat repo) case. */
  name: string | null;
  /** App root, relative to the working directory. "." for single-site. */
  root: string;
  /** Tag prefix: "v" for single-site → v1.2.0; "{name}-" for an app → finance-1.2.0. */
  tagPrefix: string;
  /** Changelog path relative to `root`. */
  changelogPath: string;
  /** Fragment directory relative to `root` (#105). */
  fragmentsDir: string;
  /** Label applied to the app's issues, or null for single-site. */
  label: string | null;
}

export const SINGLE_SITE: Readonly<AppDescriptor> = Object.freeze({
  name: null,
  root: ".",
  tagPrefix: "v",
  changelogPath: "CHANGELOG.md",
  fragmentsDir: ".changes/unreleased",
  label: null,
});

const APP_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

/** Validate an app name: lowercase kebab, safe in tags, branches, labels and paths. */
export function isValidAppName(name: string): boolean {
  return APP_NAME_RE.test(name);
}

/**
 * Build an app's descriptor. `root` defaults to "." because a multisite session
 * normally runs from inside the app directory (its own .env); pass an explicit
 * root (e.g. "finance") when driving an app from the repo root.
 */
export function appDescriptor(name: string, root = "."): AppDescriptor {
  if (!isValidAppName(name)) {
    throw new Error(`Invalid app name "${name}" — use lowercase letters, digits and hyphens (e.g. finance).`);
  }
  return { name, root, tagPrefix: `${name}-`, changelogPath: "CHANGELOG.md", fragmentsDir: ".changes/unreleased", label: name };
}

/**
 * Resolve the active app. With no name this is the single-site descriptor —
 * the only path today's tools take until #309 wires OKFFS_APP/OKFFS_APPS.
 */
export function resolveApp(opts: { name?: string | null; root?: string } = {}): AppDescriptor {
  if (!opts.name) return SINGLE_SITE;
  return appDescriptor(opts.name, opts.root ?? ".");
}

/** Release tag for a version: v1.2.0 (single-site) or finance-1.2.0 (app). */
export function tagName(app: AppDescriptor, version: string): string {
  return `${app.tagPrefix}${version}`;
}

/** Release branch for a version: release/1.2.0 (single-site) or release/finance-1.2.0 (app). */
export function releaseBranchName(app: AppDescriptor, version: string): string {
  return app.name ? `release/${app.name}-${version}` : `release/${version}`;
}
