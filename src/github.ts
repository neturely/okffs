const BASE = "https://api.github.com";

const token = process.env.GITHUB_TOKEN;
const owner = process.env.GITHUB_OWNER;
const repo = process.env.GITHUB_REPO;

if (!token || !owner || !repo) {
  throw new Error("GITHUB_TOKEN, GITHUB_OWNER, and GITHUB_REPO must be set");
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

  return res.json() as Promise<T>;
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

export async function createIssue(
  title: string,
  body: string,
  assignees?: string[],
  labels?: string[]
): Promise<{ number: number; html_url: string }> {
  return request(`/repos/${owner}/${repo}/issues`, {
    method: "POST",
    body: JSON.stringify({ title, body, assignees, labels }),
  });
}

export async function updateIssueBody(issueNumber: number, body: string): Promise<void> {
  await request(`/repos/${owner}/${repo}/issues/${issueNumber}`, {
    method: "PATCH",
    body: JSON.stringify({ body }),
  });
}

export async function getDefaultBranch(): Promise<string> {
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

export async function listIssues(): Promise<Array<{ number: number; title: string; html_url: string }>> {
  return request(`/repos/${owner}/${repo}/issues?state=open&per_page=100`);
}

export async function closeIssue(issueNumber: number): Promise<void> {
  await request(`/repos/${owner}/${repo}/issues/${issueNumber}`, {
    method: "PATCH",
    body: JSON.stringify({ state: "closed" }),
  });
}
