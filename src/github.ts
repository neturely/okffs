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
    `No GitHub token found. Quickest fix: run \`npx @neturely/okffs setup\` in your repo for a guided setup. ` +
      `Or set GITHUB_TOKEN in .env yourself — a fine-grained PAT (least privilege; ` +
      `Issues/Contents/Pull requests read-write, Metadata read, Administration read-write) or, for a quick start, ` +
      `a classic broad repo-scope token: ${PAT_LINK} — or sign in with the GitHub CLI (\`gh auth login\`).`
  );
}

if (!owner || !repo) {
  throw new Error(
    "Could not determine the GitHub repository. Quickest fix: run `npx @neturely/okffs setup` in your repo for a guided setup. " +
      "Or run okffs from inside a git repo with a GitHub `origin` remote, or set GITHUB_OWNER and GITHUB_REPO in .env."
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

export async function graphqlRequest<T>(query: string, variables: Record<string, unknown>): Promise<T> {
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
): Promise<{ number: number; html_url: string; node_id: string }> {
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

// Mutate core issue fields on an existing issue (title/body/assignees/labels/
// milestone) via a single REST PATCH. Only the keys present in `fields` are sent
// — undefined keys are dropped by JSON.stringify, so omitted fields are left
// unchanged. Note GitHub's PATCH REPLACES the whole labels/assignees set (it does
// not merge), and milestone: null clears it. Returns the updated issue.
export async function updateIssue(
  issueNumber: number,
  fields: { title?: string; body?: string; assignees?: string[]; labels?: string[]; milestone?: number | null }
): Promise<{ number: number; html_url: string; title: string }> {
  return request(`/repos/${owner}/${repo}/issues/${issueNumber}`, {
    method: "PATCH",
    body: JSON.stringify(fields),
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
  type: string | null; // native GitHub Issue Type name (e.g. Task/Bug/Feature), if set
}

export async function listIssues(): Promise<IssueSummary[]> {
  // The issues endpoint also returns pull requests; filter them out via the
  // pull_request field that only PRs carry. Issue objects carry `type: {name}`
  // (org-level native Issue Type) when the org defines types and one is set.
  const raw = await request<Array<Omit<IssueSummary, "type"> & { pull_request?: unknown; type?: { name: string } | null }>>(
    `/repos/${owner}/${repo}/issues?state=open&per_page=100`
  );
  return raw
    .filter((i) => !i.pull_request)
    .map(({ number, title, html_url, body, type }) => ({ number, title, html_url, body, type: type?.name ?? null }));
}

// Read the org's native Issue Types (Task/Bug/Feature/…). Org-level: 404s on a
// user-owned repo and needs an org-capable token. Callers treat any failure as
// "types unavailable" and skip cleanly (mirrors the Projects / org Issue Field
// gating). Returns the raw list; issue_types.ts memoizes + filters to enabled.
export async function getOrgIssueTypes(): Promise<Array<{ name: string; is_enabled: boolean }>> {
  return request(`/orgs/${owner}/issue-types`);
}

// Set a native Issue Type on an issue by name (REST PATCH `type`). Passing null
// clears it. Verified against the org's enabled types before calling.
export async function setIssueType(issueNumber: number, type: string | null): Promise<void> {
  await request(`/repos/${owner}/${repo}/issues/${issueNumber}`, {
    method: "PATCH",
    body: JSON.stringify({ type }),
  });
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

export async function getIssue(issueNumber: number): Promise<{ number: number; title: string; html_url: string; body: string | null; node_id: string }> {
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

// GitHub can reject a PR POST with 422 "No commits between <base> and <head>"
// when the POST outruns GitHub's own indexing of a commit that was pushed moments
// earlier — the push→open-PR eventual-consistency race behind #247. It resolves
// within seconds, so retry PR creation a few times with a short backoff. Any other
// error (real "no commits", bad base, permissions, …) is rethrown immediately.
// Centralised here so every PR-open path benefits: create_issue's auto-PR, the
// allow_empty backfill (create_pull_request / commit_and_update), promote_branch,
// and fix_into_base — all go through createPullRequest / createDraftPullRequest.
// Turn a thrown request() error ("GitHub API error 422: {json body}") into a
// concise, human message — "<status> <github message>" — by extracting GitHub's
// `message` field from the JSON body instead of dumping the whole raw response.
// Keeps tool-facing text (e.g. create_issue's auto-PR WARN line) readable (#247
// review). Falls back to the raw string when it doesn't match the known shape.
export function summarizeGitHubError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const m = raw.match(/^GitHub (?:API|GraphQL) error (\d+): ([\s\S]*)$/);
  if (!m) return raw;
  const [, status, body] = m;
  try {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed.message === "string" && parsed.message.trim()) {
      return `${status} ${parsed.message.trim()}`;
    }
  } catch {
    /* body isn't JSON — fall through to the trimmed raw form */
  }
  return `${status} ${body}`.trim();
}

async function withPrCreateRetry<T>(fn: () => Promise<T>, attempts = 4, delayMs = 1500): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isIndexingRace = /error 422/.test(msg) && /no commits between/i.test(msg);
      if (!isIndexingRace || attempt >= attempts) throw err;
      console.warn(
        `[okffs] PR creation hit the push→POST indexing race (422 no commits) — retry ${attempt}/${attempts - 1} in ${delayMs}ms.`
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

export async function createPullRequest(
  title: string,
  body: string,
  head: string,
  base: string
): Promise<{ number: number; html_url: string; node_id: string }> {
  return withPrCreateRetry(() =>
    request(`/repos/${owner}/${repo}/pulls`, {
      method: "POST",
      body: JSON.stringify({ title, head, base, body }),
    })
  );
}

// Request reviewers on a PR (REST). Used by promote_branch to put the configured
// reviewers (e.g. Copilot's `copilot-pull-request-reviewer[bot]`) on the
// develop→main gate PR. Bot/app reviewers go in `reviewers` alongside users.
export async function requestReviewers(prNumber: number, reviewers: string[]): Promise<void> {
  await request(`/repos/${owner}/${repo}/pulls/${prNumber}/requested_reviewers`, {
    method: "POST",
    body: JSON.stringify({ reviewers }),
  });
}

// Find the open PR (if any) whose head is the given branch. Used to reuse a
// draft PR created up front by create_issue under OKFFS_AUTO_PR=true. Pass
// `base` to also filter by target branch — required for long-lived heads like
// `develop`, which can have open PRs into several bases (promote_branch), so
// matching on head alone could return the wrong PR.
export async function getOpenPullRequestForBranch(
  branch: string,
  base?: string
): Promise<{ number: number; html_url: string; node_id: string; draft: boolean } | null> {
  const baseParam = base ? `&base=${base}` : "";
  const prs = await request<Array<{ number: number; html_url: string; node_id: string; draft: boolean }>>(
    `/repos/${owner}/${repo}/pulls?head=${owner}:${branch}${baseParam}&state=open&per_page=1`
  );
  return prs.length > 0 ? prs[0] : null;
}

// Full PR detail — includes the mergeability signals the autonomous-merge gate
// needs (`mergeable`, `mergeable_state`) that the list endpoint omits.
export interface PullRequestDetail {
  number: number;
  state: string; // "open" | "closed"
  draft: boolean;
  merged: boolean;
  mergeable: boolean | null; // null while GitHub is still computing it
  mergeable_state: string; // clean | unstable | dirty | blocked | behind | draft | has_hooks | unknown
  html_url: string;
  head: { sha: string; ref: string };
  base: { ref: string };
}

export async function getPullRequest(prNumber: number): Promise<PullRequestDetail> {
  return request(`/repos/${owner}/${repo}/pulls/${prNumber}`);
}

// Legacy combined commit status (the older Statuses API — e.g. many CI providers).
export interface CombinedStatus {
  state: "success" | "failure" | "pending" | "error";
  statuses: Array<{ state: string; context: string }>;
}
export async function getCombinedStatus(sha: string): Promise<CombinedStatus> {
  return request(`/repos/${owner}/${repo}/commits/${sha}/status`);
}

// Check runs (the newer Checks API — e.g. GitHub Actions). Independent of the
// Statuses API above; a commit can have either or both, so the merge gate checks
// both to decide "are the checks green".
export interface CheckRunsResult {
  total_count: number;
  check_runs: Array<{ name: string; status: string; conclusion: string | null }>;
}
export async function getCheckRuns(sha: string): Promise<CheckRunsResult> {
  return request(`/repos/${owner}/${repo}/commits/${sha}/check-runs?per_page=100`);
}

// Merge a PR with an explicit method (squash | merge | rebase). Throws on any
// GitHub refusal (405 not mergeable, 409 head moved, etc.) so the caller surfaces it.
export async function mergePullRequest(
  prNumber: number,
  mergeMethod: string
): Promise<{ sha: string; merged: boolean; message: string }> {
  return request(`/repos/${owner}/${repo}/pulls/${prNumber}/merge`, {
    method: "PUT",
    body: JSON.stringify({ merge_method: mergeMethod }),
  });
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

export async function closePullRequest(prNumber: number): Promise<void> {
  await request(`/repos/${owner}/${repo}/pulls/${prNumber}`, {
    method: "PATCH",
    body: JSON.stringify({ state: "closed" }),
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
  return withPrCreateRetry(() =>
    request(`/repos/${owner}/${repo}/pulls`, {
      method: "POST",
      body: JSON.stringify({ title, head, base, body, draft: true }),
    })
  );
}

export function extractBranchFromBody(body: string | null): string | null {
  if (!body) return null;
  const match = body.match(/\*\*Branch:\*\*\s+`([^`]+)`/);
  return match ? match[1] : null;
}

// ── PR review feedback ──────────────────────────────────────────────────────

export interface ReviewComment {
  id: number; // REST databaseId — used as in_reply_to when replying
  path: string | null;
  line: number | null;
  author: string;
  body: string;
}

export interface ReviewThread {
  id: string; // GraphQL node id — used to resolve the thread
  isResolved: boolean;
  comments: ReviewComment[];
}

export interface ReviewSummary {
  author: string;
  state: string;
  body: string;
}

export interface PullRequestReview {
  threads: ReviewThread[];
  reviews: ReviewSummary[];
}

// Fetch inline review threads (with resolved state + thread ids) and overall
// review summaries for a PR. Uses GraphQL so we get thread ids and resolved
// state, which the REST comments endpoint does not expose.
export async function getPullRequestReview(prNumber: number): Promise<PullRequestReview> {
  const data = await graphqlRequest<{
    repository: {
      pullRequest: {
        reviewThreads: {
          nodes: Array<{
            id: string;
            isResolved: boolean;
            comments: {
              nodes: Array<{
                databaseId: number;
                path: string | null;
                line: number | null;
                originalLine: number | null;
                body: string;
                author: { login: string } | null;
              }>;
            };
          }>;
        };
        reviews: {
          nodes: Array<{ state: string; body: string; author: { login: string } | null }>;
        };
      } | null;
    };
  }>(
    `query($owner:String!,$repo:String!,$pr:Int!){
      repository(owner:$owner,name:$repo){
        pullRequest(number:$pr){
          reviewThreads(first:100){ nodes{ id isResolved comments(first:50){ nodes{ databaseId path line originalLine body author{login} } } } }
          reviews(first:50){ nodes{ state body author{login} } }
        }
      }
    }`,
    { owner, repo, pr: prNumber }
  );

  const pr = data.repository.pullRequest;
  if (!pr) {
    // GitHub GraphQL returns pullRequest: null (no errors array) for an
    // unknown PR number — surface a clear message instead of a null deref.
    throw new Error(`Pull request #${prNumber} not found in ${owner}/${repo}.`);
  }
  const threads: ReviewThread[] = pr.reviewThreads.nodes.map((t) => ({
    id: t.id,
    isResolved: t.isResolved,
    comments: t.comments.nodes.map((c) => ({
      id: c.databaseId,
      path: c.path,
      line: c.line ?? c.originalLine,
      author: c.author?.login ?? "unknown",
      body: c.body,
    })),
  }));
  const reviews: ReviewSummary[] = pr.reviews.nodes
    .filter((r) => r.body && r.body.trim())
    .map((r) => ({ author: r.author?.login ?? "unknown", state: r.state, body: r.body }));

  return { threads, reviews };
}

// Reply to an inline review comment thread (REST in_reply_to).
export async function replyToReviewComment(
  prNumber: number,
  commentId: number,
  body: string
): Promise<{ id: number; html_url: string }> {
  return request(`/repos/${owner}/${repo}/pulls/${prNumber}/comments`, {
    method: "POST",
    body: JSON.stringify({ body, in_reply_to: commentId }),
  });
}

// Mark a review thread resolved (GraphQL — no REST equivalent).
export async function resolveReviewThread(threadId: string): Promise<void> {
  await graphqlRequest(
    `mutation($id:ID!){ resolveReviewThread(input:{threadId:$id}){ thread{ id isResolved } } }`,
    { id: threadId }
  );
}
