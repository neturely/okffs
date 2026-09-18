import { execFileSync } from "node:child_process";
import { config } from "./config.js";
import { isPrCreateRaceError } from "./github_errors.js";
import { parseOwnerRepo } from "./remote.js";

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

// parseOwnerRepo lives in remote.ts (pure, shared with cli/probe.ts — #259).

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
// `let`, not `const`: ES-module live bindings mean every importer of
// owner/repo observes the values canonicalizeRepo() adopts at startup (#273).
export let owner = resolved.owner;
export let repo = resolved.repo;

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

/**
 * Canonicalize owner/repo against the GitHub API (#273). After a repository
 * transfer (or rename), path-based REST calls keep working — fetch follows the
 * 301 — which masks the stale name; but anything embedding the owner OUTSIDE
 * the URL path, like the `head=owner:branch` PR filter, silently matches
 * nothing. One GET /repos/{owner}/{repo} at startup adopts GitHub's
 * `full_name`, so every subsequent call uses the canonical owner/repo.
 * Best-effort: on any failure the resolved values stay and startup proceeds
 * (a genuinely wrong repo surfaces on first use anyway).
 */
export async function canonicalizeRepo(): Promise<void> {
  try {
    const data = await request<{ full_name?: string }>(`/repos/${owner}/${repo}`);
    const [canonOwner, canonRepo] = (data.full_name ?? "").split("/");
    if (canonOwner && canonRepo && (canonOwner !== owner || canonRepo !== repo)) {
      console.warn(
        `[okffs] Repository resolved as ${owner}/${repo} but GitHub reports ${canonOwner}/${canonRepo} (transferred or renamed) — using the canonical name for this session. Update GITHUB_OWNER/GITHUB_REPO (or the origin remote) to silence this.`
      );
      owner = canonOwner;
      repo = canonRepo;
    }
  } catch (err) {
    console.warn(
      "[okffs] Could not canonicalize owner/repo at startup:",
      err instanceof Error ? err.message : err
    );
  }
}

// A hung GitHub fetch otherwise blocks a tool call for minutes before dying as
// an opaque "fetch failed" (#284). Every request gets a timeout; only reads
// (GET) are retried once — retrying a failed write could double-apply it
// (e.g. a duplicate issue comment) when the first attempt actually reached
// GitHub.
const FETCH_TIMEOUT_MS = 30_000;

async function timedFetch(url: string, options: RequestInit, retryable: boolean): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(url, { ...options, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    } catch (err) {
      if (retryable && attempt === 0) continue;
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`GitHub request to ${url} failed: ${msg}`);
    }
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();
  const res = await timedFetch(`${BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...options.headers,
    },
  }, method === "GET");

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
  // GraphQL is always POST, and mutations can't safely be retried — timeout only.
  const res = await timedFetch(`${BASE}/graphql`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  }, false);

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

// Moved to branch.ts (pure, unit-testable — #259); re-exported so existing
// importers keep working.
export { slugify, buildBranchName } from "./branch.js";

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
  base: { ref: string };
}

export async function listOpenPullRequests(): Promise<PullRequestSummary[]> {
  return request(`/repos/${owner}/${repo}/pulls?state=open&per_page=100`);
}

// Moved to issue_body.ts (pure, unit-testable — #259); re-exported so existing
// importers keep working.
export { parseRelationships, type IssueRelationships } from "./issue_body.js";

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

// Marker-based comment upsert (#267): edit the existing comment carrying the
// hidden HTML-comment marker, or create it if absent — giving callers a single
// running status comment per issue instead of an append-only thread.
export async function upsertIssueCommentByMarker(
  issueNumber: number,
  marker: string,
  body: string
): Promise<{ action: "created" | "updated"; url: string }> {
  const tag = `<!-- okffs:comment:${marker} -->`;
  // Page newest-first until the marker is found or comments run out (bounded at
  // 10 pages / 1000 comments) — scanning only the newest 100 would duplicate the
  // marker comment on a busy issue once it aged past page 1 (PR #289 review).
  let existing: { id: number; body: string | null; html_url: string } | undefined;
  for (let page = 1; page <= 10; page++) {
    const comments = await request<Array<{ id: number; body: string | null; html_url: string }>>(
      `/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=100&page=${page}&sort=created&direction=desc`
    );
    existing = comments.find((c) => c.body?.includes(tag));
    if (existing || comments.length < 100) break;
  }
  const fullBody = `${tag}\n${body}`;
  if (existing) {
    const updated = await request<{ html_url: string }>(
      `/repos/${owner}/${repo}/issues/comments/${existing.id}`,
      { method: "PATCH", body: JSON.stringify({ body: fullBody }) }
    );
    return { action: "updated", url: updated.html_url };
  }
  const created = await request<{ html_url: string }>(
    `/repos/${owner}/${repo}/issues/${issueNumber}/comments`,
    { method: "POST", body: JSON.stringify({ body: fullBody }) }
  );
  return { action: "created", url: created.html_url };
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
// The error-summarising and race-detection helpers live in github_errors.ts
// (pure, import-safe without a configured env, unit-tested — #271); re-exported
// here so existing importers keep working.
export { summarizeGitHubError } from "./github_errors.js";

async function withPrCreateRetry<T>(fn: () => Promise<T>, attempts = 4, delayMs = 1500): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!isPrCreateRaceError(msg) || attempt >= attempts) throw err;
      console.warn(
        `[okffs] PR creation hit the push→POST indexing race (422) — retry ${attempt}/${attempts - 1} in ${delayMs}ms.`
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
  /** Reviewers whose requested review has not been submitted yet. */
  requested_reviewers?: Array<{ login: string }>;
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

// Moved to issue_body.ts (pure, unit-testable — #295); re-exported so existing
// importers keep working. The extraction is now anchored to a line start, so a
// body that merely quotes the "**Branch:** `...`" pattern mid-prose no longer
// shadows the real metadata line.
export { extractBranchFromBody } from "./issue_body.js";

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

// --- Release tagging (#310) -------------------------------------------------

export interface MergedPullRequest {
  number: number;
  html_url: string;
  merge_commit_sha: string | null;
  merged_at: string | null;
}

/** The most recently merged PR for head→base, or null. */
export async function getLatestMergedPullRequestForBranch(head: string, base: string): Promise<MergedPullRequest | null> {
  const prs = await request<MergedPullRequest[]>(
    `/repos/${owner}/${repo}/pulls?head=${owner}:${head}&base=${base}&state=closed&sort=updated&direction=desc&per_page=10`
  );
  return prs.find((p) => p.merged_at) ?? null;
}

/** First-parent sha of a commit (the base tip before a merge/squash landed), or null. */
export async function getCommitParentSha(sha: string): Promise<string | null> {
  const data = await request<{ parents?: Array<{ sha: string }> }>(`/repos/${owner}/${repo}/commits/${sha}`);
  return data.parents?.[0]?.sha ?? null;
}

/** The sha a tag points at, or null when the tag doesn't exist. */
export async function getTagSha(tag: string): Promise<string | null> {
  try {
    const ref = await request<{ object: { sha: string } }>(`/repos/${owner}/${repo}/git/ref/tags/${encodeURIComponent(tag)}`);
    return ref.object.sha;
  } catch (err) {
    if (err instanceof Error && /GitHub API error 404/.test(err.message)) return null;
    throw err;
  }
}

/** Create a lightweight tag at `sha` (what `on: push: tags` CI triggers on). */
export async function createTag(tag: string, sha: string): Promise<void> {
  await request(`/repos/${owner}/${repo}/git/refs`, {
    method: "POST",
    body: JSON.stringify({ ref: `refs/tags/${tag}`, sha }),
  });
}

/** A file's text content at a ref, or null when it doesn't exist there. */
export async function getFileContentAtRef(filePath: string, ref: string): Promise<string | null> {
  try {
    const data = await request<{ content?: string; encoding?: string }>(
      `/repos/${owner}/${repo}/contents/${filePath.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`
    );
    if (!data.content) return null;
    return Buffer.from(data.content, data.encoding === "base64" ? "base64" : "utf8").toString("utf8");
  } catch (err) {
    if (err instanceof Error && /GitHub API error 404/.test(err.message)) return null;
    throw err;
  }
}
