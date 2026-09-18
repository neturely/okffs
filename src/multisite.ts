// Multisite glue (#309): the active app for this session, per-issue app
// resolution (label + branch identifier), and the migration/consistency
// warnings surfaced at startup. The decision logic is pure over its inputs so
// it is unit-testable; the fs/config-facing wrappers are thin.

import fs from "fs";
import path from "path";
import { config } from "./config.js";
import { resolveApp, isValidAppName, type AppDescriptor } from "./apps.js";
import { findGitRoot } from "./env_load.js";

/** The app this session runs as (OKFFS_APP), or the single-site descriptor. */
export function activeApp(): AppDescriptor {
  return resolveApp({ name: config.app });
}

export interface IssueAppInput {
  /** Per-call `app` override, if any. */
  override?: string | null;
  /** Session app (OKFFS_APP). */
  sessionApp: string | null;
  /** Registry (OKFFS_APPS). */
  apps: string[];
  /** Explicit OKFFS_IDENTIFIER (wins over the app-derived default). */
  explicitIdentifier: string | null;
}

export interface IssueApp {
  app: string | null;
  /** Label to add for the app (null when no app applies). */
  label: string | null;
  /** Branch identifier to use (explicit OKFFS_IDENTIFIER, else the app). */
  identifier: string | null;
  error: string | null;
}

/**
 * Which app an issue belongs to: the per-call override, else the session app.
 * An override is validated (shape, and membership when a registry exists) so a
 * typo can't mint a stray label. Pure.
 */
export function resolveIssueApp(input: IssueAppInput): IssueApp {
  const none: IssueApp = { app: null, label: null, identifier: input.explicitIdentifier, error: null };
  const override = input.override?.trim().toLowerCase() || null;
  if (override) {
    if (!isValidAppName(override)) {
      return { ...none, error: `[okffs] app "${input.override}" is not a valid app name (lowercase letters, digits, hyphens).` };
    }
    if (input.apps.length > 0 && !input.apps.includes(override)) {
      return { ...none, error: `[okffs] app "${override}" is not in OKFFS_APPS (${input.apps.join(", ")}) — add it to the registry in the root .env, or fix the name.` };
    }
  }
  const app = override ?? input.sessionApp;
  if (!app) return none;
  return { app, label: app, identifier: input.explicitIdentifier ?? app, error: null };
}

/** Config-backed wrapper for the tools. */
export function issueAppFor(override?: string | null): IssueApp {
  return resolveIssueApp({
    override,
    sessionApp: config.app,
    apps: config.apps,
    explicitIdentifier: config.identifierExplicit ? config.identifier : null,
  });
}

/**
 * Which registered app an issue's labels name, or null. Accepts GitHub's label
 * objects or plain strings. Pure.
 */
export function appFromLabels(labels: unknown, apps: string[]): string | null {
  if (!Array.isArray(labels) || apps.length === 0) return null;
  const names = labels
    .map((l) => (typeof l === "string" ? l : l && typeof l === "object" && typeof (l as { name?: unknown }).name === "string" ? (l as { name: string }).name : null))
    .filter((n): n is string => Boolean(n))
    .map((n) => n.toLowerCase());
  return apps.find((a) => names.includes(a)) ?? null;
}

export interface MultisiteState {
  app: string | null;
  apps: string[];
  /** The session runs inside an app directory (cwd is below the git root). */
  inAppDir: boolean;
  /** Pending *.md fragments under the git root's .changes/unreleased/. */
  rootFragmentCount: number;
}

/**
 * Migration/consistency warnings. Only ever non-empty when OKFFS_APP or
 * OKFFS_APPS is set — single-site users never see these. Pure.
 */
export function multisiteWarnings(s: MultisiteState): string[] {
  const out: string[] = [];
  if (!s.app && s.apps.length === 0) return out;
  if (s.app && s.apps.length === 0) {
    out.push(`OKFFS_APP=${s.app} is set but OKFFS_APPS (the registry, in the git-root .env) is unset — set OKFFS_APPS=${s.app}[,…] so promote_branch and the migration checks know every app. (Note: OKFFS_APP names this site; OKFFS_APPS lists all of them.)`);
  }
  if (s.app && s.apps.length > 0 && !s.apps.includes(s.app)) {
    out.push(`OKFFS_APP=${s.app} is not listed in OKFFS_APPS=${s.apps.join(",")} — add it to the registry in the git-root .env, or fix the typo. (Note: OKFFS_APP names this site; OKFFS_APPS lists all of them.)`);
  }
  if (s.apps.length > 0 && s.inAppDir && s.rootFragmentCount > 0) {
    out.push(`Migration: ${s.rootFragmentCount} pending changelog fragment(s) under the repo root .changes/unreleased/ — no app release assembles them. Move each into the right app's .changes/unreleased/ (or release from the root once) so they are not orphaned.`);
  }
  if (s.apps.length > 0 && !s.app && !s.inAppDir) {
    out.push(`OKFFS_APPS=${s.apps.join(",")} is set but this root session has no OKFFS_APP — issues created here get no app label and a release from here uses the plain v-tag and root CHANGELOG. Run okffs from inside an app directory (with its own .env), or set OKFFS_APP in the root .env if the root is itself an app.`);
  }
  return out;
}

function countRootFragments(gitRoot: string): number {
  try {
    return fs.readdirSync(path.join(gitRoot, ".changes", "unreleased")).filter((f) => f.endsWith(".md")).length;
  } catch {
    return 0;
  }
}

/** Collect the session's multisite state from config + fs. Never throws. */
export function collectMultisiteWarnings(cwd: string = process.cwd()): string[] {
  try {
    const gitRoot = findGitRoot(cwd);
    const inAppDir = gitRoot !== null && path.resolve(gitRoot) !== path.resolve(cwd);
    const rootFragmentCount = gitRoot ? countRootFragments(gitRoot) : 0;
    return multisiteWarnings({ app: config.app, apps: config.apps, inAppDir, rootFragmentCount });
  } catch {
    return [];
  }
}
