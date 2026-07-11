// The post-write sanity test. Non-fatal by contract: it reports pass/warn/fail
// per check but never blocks or reverts the .env that was just written — the
// wizard prints the results and exits 0 regardless.

import {
  resolveToken,
  resolveOwnerRepo,
  getUser,
  getRepo,
  getBranch,
  getProjectV2,
} from "./probe.js";

export type CheckStatus = "pass" | "warn" | "fail" | "skip";

export interface CheckResult {
  label: string;
  status: CheckStatus;
  detail: string;
}

export interface SanityOutcome {
  results: CheckResult[];
  resolved: { owner?: string; repo?: string; tokenSource: "env" | "gh" | "none" };
}

export async function runSanity(values: Record<string, string>): Promise<SanityOutcome> {
  const results: CheckResult[] = [];

  const { token, source } = resolveToken(values.GITHUB_TOKEN);
  const { owner, repo } = resolveOwnerRepo(values.GITHUB_OWNER, values.GITHUB_REPO);
  const resolved = { owner, repo, tokenSource: source };

  // 1. Token resolves + is valid.
  if (!token) {
    results.push({
      label: "Token",
      status: "fail",
      detail: "No token: GITHUB_TOKEN unset and `gh auth token` returned nothing. Set a PAT or run `gh auth login`.",
    });
    return { results, resolved }; // nothing else is checkable without a token
  }
  const user = await getUser(token);
  if (user.ok && user.data) {
    results.push({ label: "Token", status: "pass", detail: `authenticated as ${user.data.login} (via ${source === "env" ? "GITHUB_TOKEN" : "gh CLI"})` });
  } else {
    results.push({ label: "Token", status: "fail", detail: `GET /user failed (${user.status}). The token may be invalid or expired.` });
    return { results, resolved };
  }

  // 2. Repo access.
  if (!owner || !repo) {
    results.push({ label: "Repository", status: "fail", detail: "Could not resolve owner/repo. Set GITHUB_OWNER/GITHUB_REPO or run inside a repo with a GitHub origin remote." });
  } else {
    const repoRes = await getRepo(token, owner, repo);
    if (repoRes.ok && repoRes.data) {
      const def = repoRes.data.default_branch;
      results.push({ label: "Repository", status: "pass", detail: `${owner}/${repo} reachable (default branch: ${def})` });

      // 2b. Compare configured branches against the repo default — warn, never fail.
      const base = values.OKFFS_BASE_BRANCH;
      if (base && base !== def) {
        results.push({
          label: "Base branch",
          status: "warn",
          detail: `OKFFS_BASE_BRANCH="${base}" is not the repo default ("${def}"). Supported (Closes #N won't auto-close on merge into a non-default base — use close_issue).`,
        });
      }

      // 3. Configured branches exist.
      for (const [key, label] of [["OKFFS_BASE_BRANCH", "Base branch"], ["OKFFS_PROTECTED_BRANCH", "Protected branch"]] as const) {
        const branch = values[key];
        if (!branch) continue;
        const br = await getBranch(token, owner, repo, branch);
        if (br.ok) {
          results.push({ label, status: "pass", detail: `"${branch}" exists` });
        } else if (br.status === 404) {
          results.push({ label, status: "warn", detail: `${key}="${branch}" not found on the remote — create it, or fix the value.` });
        } else {
          results.push({ label, status: "warn", detail: `Could not verify ${key}="${branch}" (${br.status}).` });
        }
      }
    } else {
      results.push({ label: "Repository", status: "fail", detail: `GET /repos/${owner}/${repo} failed (${repoRes.status}). Check the name and the token's repo access.` });
    }
  }

  // 4. Projects v2 id resolves (only when enabled).
  if (values.OKFFS_PROJECT_ENABLED === "true") {
    const pid = values.OKFFS_PROJECT_ID;
    if (!pid) {
      results.push({ label: "Projects v2", status: "warn", detail: "OKFFS_PROJECT_ENABLED=true but OKFFS_PROJECT_ID is unset — Projects features stay inert." });
    } else {
      const proj = await getProjectV2(token, pid);
      if (proj.ok && proj.data) {
        results.push({ label: "Projects v2", status: "pass", detail: `board "${proj.data.title}" resolved` });
      } else {
        results.push({ label: "Projects v2", status: "warn", detail: `Could not resolve OKFFS_PROJECT_ID via GraphQL (${proj.error ?? proj.status}). Check the node ID and the token's Projects scope.` });
      }
    }
  }

  // 5. Classic PAT scope check.
  if (values.OKFFS_CLASSIC_PAT === "true") {
    // Re-fetch /user for the scopes header (getUser above didn't surface it here).
    const scoped = await getUser(token);
    const scopes = scoped.scopes;
    if (scopes === null) {
      results.push({ label: "Classic PAT", status: "warn", detail: "OKFFS_CLASSIC_PAT=true but no X-OAuth-Scopes header — this looks like a fine-grained PAT, not a classic admin:org token." });
    } else if (scopes.split(",").map((s) => s.trim()).includes("admin:org")) {
      results.push({ label: "Classic PAT", status: "pass", detail: "token carries the admin:org scope" });
    } else {
      results.push({ label: "Classic PAT", status: "warn", detail: `OKFFS_CLASSIC_PAT=true but the token scopes (${scopes || "none"}) do not include admin:org.` });
    }
  }

  return { results, resolved };
}
