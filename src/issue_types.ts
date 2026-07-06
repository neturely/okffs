// Native GitHub Issue Types (Task/Bug/Feature/Epic/Story) support, mirroring the
// board Priority/Effort machinery in board.ts: read the org's available type
// names (memoized, injected into create_issue's inference guidance), and set a
// type on an issue with validated, NON-FATAL handling — any miss (user-owned
// repo with no org types, missing token scope, unknown name) is returned as
// { skipped } and surfaced in the tool response, never blocking issue creation.
//
// Issue Types are ORG-LEVEL: /orgs/{org}/issue-types 404s on a user-owned repo
// and needs an org-capable token. That org-vs-user capability split is the same
// one tracked in #199 — handled here inline (fetch, catch, memoize null) so this
// feature degrades cleanly wherever types aren't available.

import { getOrgIssueTypes, setIssueType } from "./github.js";
import { config } from "./config.js";
import type { BoardFieldOutcome } from "./board.js";

// Memoize the enabled type names across the process. `undefined` = not yet
// fetched; a settled entry of `{ value: string[] | null }` caches BOTH the
// success list and the "unavailable" (null) result, so a user-owned repo pays
// the 404 at most once.
let cached: { value: string[] | null } | undefined;

// Whether okffs should attempt Issue Type inference/setting at all. Independent
// of the Projects board — types are native GitHub, not a board field.
export function issueTypesEnabled(): boolean {
  return config.inferType || Boolean(config.defaultType);
}

// The org's enabled Issue Type names, or null when unavailable (user repo, no
// org types defined, or the token can't read them). Cheap after the first call.
export async function getIssueTypeNames(): Promise<string[] | null> {
  if (cached) return cached.value;
  try {
    const types = await getOrgIssueTypes();
    const names = types.filter((t) => t.is_enabled).map((t) => t.name);
    cached = { value: names.length ? names : null };
  } catch {
    // 404 (user repo / no types) or a permission error — treat as unavailable.
    cached = { value: null };
  }
  return cached.value;
}

// Set an Issue Type on an issue by name. Validates against the org's enabled
// types (case-insensitive, mapping to the canonical name GitHub expects) and
// returns { applied } / { skipped } like the board field writes — never throws.
export async function applyIssueType(issueNumber: number, type: string): Promise<BoardFieldOutcome> {
  const skip = (reason: string): BoardFieldOutcome => {
    console.warn(`[okffs] Issue Type "${type}" not set on #${issueNumber}: ${reason}`);
    return { skipped: reason };
  };

  const names = await getIssueTypeNames();
  if (!names) {
    return skip(
      "no org-level Issue Types available — the repo is user-owned, the org has none defined, " +
        "or the token can't read /orgs/{org}/issue-types. Define types under Org → Settings → Planning → Issue Types."
    );
  }
  const canonical = names.find((n) => n.toLowerCase() === type.toLowerCase());
  if (!canonical) {
    return skip(`no matching type. Available Issue Types: ${names.join(", ")}.`);
  }
  try {
    await setIssueType(issueNumber, canonical);
    return { applied: canonical };
  } catch (err) {
    return skip(`write failed — ${err instanceof Error ? err.message : String(err)}`);
  }
}
