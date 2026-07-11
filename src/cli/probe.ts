// Standalone GitHub access for the setup wizard's sanity test.
//
// IMPORTANT: this does NOT import ../github.js on purpose. That module resolves
// the token and owner/repo at import time and THROWS if either is missing —
// which is exactly the state the wizard runs in. So we re-implement the small
// slice of resolution + REST/GraphQL we need here, driven by the values the
// wizard just collected rather than by process.env at import time.

import { execFileSync } from "node:child_process";

const BASE = "https://api.github.com";

function tryExec(cmd: string, args: string[]): string | null {
  try {
    const out = execFileSync(cmd, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

/** Resolve a token from an explicit value, else the GitHub CLI. Mirrors github.ts. */
export function resolveToken(explicit?: string): { token: string | null; source: "env" | "gh" | "none" } {
  if (explicit && explicit.trim()) return { token: explicit.trim(), source: "env" };
  const gh = tryExec("gh", ["auth", "token"]);
  return gh ? { token: gh, source: "gh" } : { token: null, source: "none" };
}

function parseOwnerRepo(remoteUrl: string): { owner: string; repo: string } | null {
  const m = remoteUrl.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/);
  return m ? { owner: m[1], repo: m[2] } : null;
}

/** Resolve owner/repo from explicit values, else the origin remote. Mirrors github.ts. */
export function resolveOwnerRepo(explicitOwner?: string, explicitRepo?: string): { owner?: string; repo?: string } {
  let owner = explicitOwner || undefined;
  let repo = explicitRepo || undefined;
  if (!owner || !repo) {
    const remote = tryExec("git", ["remote", "get-url", "origin"]);
    const parsed = remote ? parseOwnerRepo(remote) : null;
    if (parsed) {
      owner = owner || parsed.owner;
      repo = repo || parsed.repo;
    }
  }
  return { owner, repo };
}

export interface ApiResponse<T> {
  ok: boolean;
  status: number;
  data: T | null;
  scopes: string | null; // X-OAuth-Scopes header (classic tokens only)
  error?: string;
}

async function rest<T>(token: string, path: string): Promise<ApiResponse<T>> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    const scopes = res.headers.get("x-oauth-scopes");
    let data: T | null = null;
    try {
      data = (await res.json()) as T;
    } catch {
      /* empty body */
    }
    return { ok: res.ok, status: res.status, data, scopes };
  } catch (err) {
    return { ok: false, status: 0, data: null, scopes: null, error: err instanceof Error ? err.message : String(err) };
  }
}

export function getUser(token: string): Promise<ApiResponse<{ login: string }>> {
  return rest(token, "/user");
}

export function getRepo(token: string, owner: string, repo: string): Promise<ApiResponse<{ default_branch: string; full_name: string }>> {
  return rest(token, `/repos/${owner}/${repo}`);
}

export function getBranch(token: string, owner: string, repo: string, branch: string): Promise<ApiResponse<{ name: string }>> {
  return rest(token, `/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`);
}

/** Resolve a Projects v2 node ID via GraphQL — confirms the id is real and readable. */
export async function getProjectV2(token: string, projectId: string): Promise<ApiResponse<{ title: string }>> {
  try {
    const res = await fetch(`${BASE}/graphql`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `query($id:ID!){ node(id:$id){ ... on ProjectV2 { title } } }`,
        variables: { id: projectId },
      }),
    });
    const json = (await res.json()) as { data?: { node?: { title: string } | null }; errors?: unknown };
    if (json.errors) {
      return { ok: false, status: res.status, data: null, scopes: null, error: JSON.stringify(json.errors) };
    }
    const node = json.data?.node ?? null;
    return { ok: Boolean(node), status: res.status, data: node, scopes: null };
  } catch (err) {
    return { ok: false, status: 0, data: null, scopes: null, error: err instanceof Error ? err.message : String(err) };
  }
}
