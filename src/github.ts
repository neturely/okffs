import { execFileSync } from "node:child_process";
import { config } from "./config.js";

const BASE = "https://api.github.com";

const PAT_LINK =
  "https://github.com/settings/tokens/new?scopes=repo&description=okffs";

/** Run a command and return trimmed stdout, or null on any failure. */
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

/**
 * Resolve a GitHub token. Prefers GITHUB_TOKEN, then falls back to the GitHub
 * CLI (`gh auth token`) so users already signed in with `gh` need no setup.
 */
function resolveToken(): string | null {
  return process.env.GITHUB_TOKEN || tryExec("gh", ["auth", "token"]);
}

/** Parse owner/repo from a GitHub remote URL (https or ssh form). */
function parseOwnerRepo(remoteUrl: string): { owner: string; repo: string } | null {
  const m = remoteUrl.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/);
  return m ? { owner: m[1], repo: m[2] } : null;
}

/**
 * Resolve owner/repo. Prefers explicit env vars, then auto-detects from the
 * `origin` git remote of the current working directory.
 */
function resolveOwnerRepo(): { owner?: string; repo?: string } {
  let owner = process.env.GITHUB_OWNER;
  let repo = process.env.GITHUB_REPO;
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

const token = resolveToken();
const resolved = resolveOwnerRepo();
export const owner = resolved.owner;
export const repo = resolved.repo;

if (!token) {
  throw new Error(
    `No GitHub token found. Set GITHUB_TOKEN in .env (create one at ${PAT_LINK}), or sign in with the GitHub CLI (\`gh auth login\`).`
  );
}

if (!owner || !repo) {
  throw new Error(
    "Could not determine the GitHub repository. Run okffs from inside a git repo with a GitHub `origin` remote, or set GITHUB_OWNER and GITHUB_REPO in .env."
  );
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API error ${res.status}: ${body}`);
  }

  if (res.status === 204) {
    return undefined as unknown as T;
  }

  return res.json() as Promise<T>;
}

async function graphqlRequest<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${BASE}/graphql`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub GraphQL error ${res.status}: ${body}`);
  }

  const json = (await res.json()) as { data?: T; errors?: unknown };
  if (json.errors) {
    throw new Error(`GitHub GraphQL error: ${JSON.stringify(json.errors)}`);
  }
  return json.data as T;
}

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 5)
    .join("-");
}

/**
 * Build the branch name for an issue.
 * Format: {issue-number}-{slug}, or {issue-number}-{identifier}-{slug}
 * when OKFFS_IDENTIFIER is set. The identifier is slugified too, so spaces or
 * other characters invalid in a git ref can't break branch creation.
 */
export function buildBranchName(issueNumber: number, title: string): string {
  const slug = slugify(title);
  const identifier = config.identifier ? slugify(config.identifier) : "";
  return identifier
    ? `${issueNumber}-${identifier}-${slug}`
    : `${issueNumber}-${slug}`;
}

export async function createIssue(
  title: string,
  body: string,
  assignees?: string[],
  labels?: string[],
  milestone?: number
): Promise<{ number: number; html_url: string }> {
  return request(`/repos/${owner}/${repo}/issues`, {
    method: "POST",
    body: JSON.stringify({ title, body, assignees, labels, ...(milestone !== undefined && { milestone }) }),
  });
}

export async function updateIssueBody(issueNumber: number, body: string): Promise<void> {
  await request(`/repos/${owner}/${repo}/issues/${issueNumber}`, {
    method: "PATCH",
    body: JSON.stringify({ body }),
  });
}

export async function getDefaultBranch(): Promise<string> {
  if (config.baseBranch) return config.baseBranch;
  const data = await request<{ default_branch: string }>(`/repos/${owner}/${repo}`);
  return data.default_branch;
}

// The repository's actual default branch, ignoring OKFFS_BASE_BRANCH. GitHub's
// `Closes #N` only auto-closes the issue when a PR merges into this branch.
export async function getRepoDefaultBranch(): Promise<string> {
  const data = await request<{ default_branch: string }>(`/repos/${owner}/${repo}`);
  return data.default_branch;
}

export async function getRef(ref: string): Promise<{ object: { sha: string } }> {
  return request(`/repos/${owner}/${repo}/git/ref/heads/${ref}`);
}

export async function createBranch(branchName: string, sha: string): Promise<void> {
  await request(`/repos/${owner}/${repo}/git/refs`, {
    method: "POST",
    body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha }),
  });
}

export interface IssueSummary {
  number: number;
  title: string;
  html_url: string;
  body: string | null;
}

export async function listIssues(): Promise<IssueSummary[]> {
  // The issues endpoint also returns pull requests; filter them out via the
  // pull_request field that only PRs carry.
  const raw = await request<Array<IssueSummary & { pull_request?: unknown }>>(
    `/repos/${owner}/${repo}/issues?state=open&per_page=100`
  );
  return raw
    .filter((i) => !i.pull_request)
    .map(({ number, title, html_url, body }) => ({ number, title, html_url, body }));
}

export interface PullRequestSummary {
  number: number;
  html_url: string;
  draft: boolean;
  head: { ref: string };
}

export async function listOpenPullRequests(): Promise<PullRequestSummary[]> {
  return request(`/repos/${owner}/${repo}/pulls?state=open&per_page=100`);
}

export interface IssueRelationships {
  parent: number[];
  blockedBy: number[];
  blocking: number[];
}

// Parse the "## Relationships" section written by link_issues, e.g.
//   - Blocked by #3
//   - Blocking #7
//   - Parent: #1
export function parseRelationships(body: string | null): IssueRelationships {
  const result: IssueRelationships = { parent: [], blockedBy: [], blocking: [] };
  if (!body) return result;

  const idx = body.indexOf("## Relationships");
  if (idx === -1) return result;

  let section = body.slice(idx + "## Relationships".length);
  const nextHeading = section.search(/\n## /);
  if (nextHeading !== -1) section = section.slice(0, nextHeading);

  for (const line of section.split("\n")) {
    const m = line.match(/^\s*-\s*(Blocked by|Blocking|Parent:?)\s*#(\d+)/i);
    if (!m) continue;
    const num = parseInt(m[2], 10);
    const label = m[1].toLowerCase();
    if (label.startsWith("blocked")) result.blockedBy.push(num);
    else if (label.startsWith("blocking")) result.blocking.push(num);
    else if (label.startsWith("parent")) result.parent.push(num);
  }
  return result;
}

export async function closeIssue(issueNumber: number): Promise<void> {
  await request(`/repos/${owner}/${repo}/issues/${issueNumber}`, {
    method: "PATCH",
    body: JSON.stringify({ state: "closed" }),
  });
}

export async function getIssue(issueNumber: number): Promise<{ number: number; title: string; html_url: string; body: string | null }> {
  return request(`/repos/${owner}/${repo}/issues/${issueNumber}`);
}

export async function addIssueComment(issueNumber: number, body: string): Promise<void> {
  await request(`/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

export async function deleteBranch(branchName: string): Promise<void> {
  await request(`/repos/${owner}/${repo}/git/refs/heads/${branchName}`, {
    method: "DELETE",
  });
}

export async function getBranchCommits(branchName: string, baseBranch: string): Promise<Array<{ sha: string; commit: { message: string } }>> {
  return request(`/repos/${owner}/${repo}/compare/${baseBranch}...${branchName}`).then(
    (data: any) => data.commits ?? []
  );
}

export async function getIssueComments(issueNumber: number): Promise<Array<{ body: string }>> {
  // Fetch newest-first so callers can reliably take the most recent N comments.
  return request(`/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=100&sort=created&direction=desc`);
}

export async function createPullRequest(
  title: string,
  body: string,
  head: string,
  base: string
): Promise<{ number: number; html_url: string }> {
  return request(`/repos/${owner}/${repo}/pulls`, {
    method: "POST",
    body: JSON.stringify({ title, head, base, body }),
  });
}

// Find the open PR (if any) whose head is the given branch. Used to reuse a
// draft PR created up front by create_issue under OKFFS_AUTO_PR=true.
export async function getOpenPullRequestForBranch(
  branch: string
): Promise<{ number: number; html_url: string; node_id: string; draft: boolean } | null> {
  const prs = await request<Array<{ number: number; html_url: string; node_id: string; draft: boolean }>>(
    `/repos/${owner}/${repo}/pulls?head=${owner}:${branch}&state=open&per_page=1`
  );
  return prs.length > 0 ? prs[0] : null;
}

export async function updatePullRequest(
  prNumber: number,
  fields: { title?: string; body?: string }
): Promise<void> {
  await request(`/repos/${owner}/${repo}/pulls/${prNumber}`, {
    method: "PATCH",
    body: JSON.stringify(fields),
  });
}

// Mark a draft PR ready for review. The REST update endpoint cannot change the
// draft flag, so this uses the GraphQL markPullRequestReadyForReview mutation.
export async function markPullRequestReady(nodeId: string): Promise<void> {
  await graphqlRequest(
    `mutation($id: ID!) { markPullRequestReadyForReview(input: { pullRequestId: $id }) { pullRequest { id } } }`,
    { id: nodeId }
  );
}

export async function createDraftPullRequest(
  title: string,
  body: string,
  head: string,
  base: string
): Promise<{ number: number; html_url: string }> {
  return request(`/repos/${owner}/${repo}/pulls`, {
    method: "POST",
    body: JSON.stringify({ title, head, base, body, draft: true }),
  });
}

export function extractBranchFromBody(body: string | null): string | null {
  if (!body) return null;
  const match = body.match(/\*\*Branch:\*\*\s+`([^`]+)`/);
  return match ? match[1] : null;
}
