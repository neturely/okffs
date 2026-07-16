// GitHub Projects v2 integration (Phase 5).
//
// Projects v2 has no REST API, so everything here goes through GraphQL, reusing
// the shared `graphqlRequest` helper from github.ts. Field and single-select
// option node IDs differ per board, so they are discovered at runtime (and
// memoized) rather than hardcoded. All calls no-op / throw clearly when the
// feature is disabled or the token lacks Projects permission.

import { graphqlRequest, owner, repo } from "./github.js";
import { config } from "./config.js";

export interface ProjectSingleSelect {
  fieldId: string;
  options: Map<string, string>; // option name → option id
}

export interface ProjectMetadata {
  // Status is kept as a dedicated field because it has special handling
  // (update_project_status, the initial-status flow). Every single-select field
  // on the board — including Status, Priority, Effort, and any others — is also
  // in singleSelectByName, keyed by lowercased name, so generic field handling
  // (Priority/Effort/…) doesn't need a bespoke entry per field.
  statusFieldId: string | null;
  statusOptions: Map<string, string>;
  singleSelectByName: Map<string, ProjectSingleSelect>;
}

// Throw a clear, actionable message when the token can't reach Projects, rather
// than leaking a raw GraphQL blob. Permission errors arrive in several shapes:
// an HTTP 403, a 200 with a FORBIDDEN error, or — the common gh-CLI-fallback
// case — an INSUFFICIENT_SCOPES error because the CLI's OAuth token lacks the
// `project` scope that Projects v2 requires.
async function projectCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/\b403\b|FORBIDDEN|INSUFFICIENT_SCOPES|not accessible|requires .*\bproject\b/i.test(msg)) {
      throw new Error(
        "[okffs] GitHub denied a Projects API call (insufficient scope / forbidden). " +
          "Projects v2 (GraphQL) needs a token with Projects access: " +
          'fine-grained PAT → Organization permissions → "Projects: Read and write"; ' +
          "classic PAT → the `project` scope. " +
          "Note: the GitHub CLI fallback token (used when GITHUB_TOKEN is unset) usually " +
          "lacks `project` scope — grant it with `gh auth refresh -s project,read:project`. " +
          `Original error: ${msg}`
      );
    }
    throw err;
  }
}

function requireProjectId(): string {
  if (!config.projectId) {
    throw new Error(
      "[okffs] OKFFS_PROJECT_ID is not set — cannot talk to a GitHub Project board. " +
        "Set it to the board's GraphQL node ID (e.g. PVT_kwHO...)."
    );
  }
  return config.projectId;
}

let metadataCache: Promise<ProjectMetadata> | null = null;

// Discover the board's single-select fields and options once per process.
// The promise itself is cached so concurrent callers share one request; on
// failure the cache is cleared so a later call can retry.
export function getProjectMetadata(): Promise<ProjectMetadata> {
  if (!metadataCache) {
    metadataCache = fetchProjectMetadata().catch((err) => {
      metadataCache = null;
      throw err;
    });
  }
  return metadataCache;
}

async function fetchProjectMetadata(): Promise<ProjectMetadata> {
  const projectId = requireProjectId();
  const data = await projectCall(() =>
    graphqlRequest<{
      node: {
        fields: {
          nodes: Array<{
            id?: string;
            name?: string;
            options?: Array<{ id: string; name: string }>;
          }>;
        };
      } | null;
    }>(
      `query($project:ID!){
        node(id:$project){
          ... on ProjectV2 {
            fields(first:100){
              nodes{
                ... on ProjectV2SingleSelectField { id name options { id name } }
              }
            }
          }
        }
      }`,
      { project: projectId }
    )
  );

  if (!data.node) {
    throw new Error(
      `[okffs] Project ${projectId} not found (or not visible to this token). Check OKFFS_PROJECT_ID.`
    );
  }

  const meta: ProjectMetadata = {
    statusFieldId: null,
    statusOptions: new Map(),
    singleSelectByName: new Map(),
  };

  for (const field of data.node.fields.nodes) {
    // Non-single-select fields come back as empty objects from the inline
    // fragment — skip anything without a name and options.
    if (!field.id || !field.name || !field.options) continue;
    const optionMap = new Map(field.options.map((o) => [o.name, o.id] as const));
    const name = field.name.toLowerCase();
    meta.singleSelectByName.set(name, { fieldId: field.id, options: optionMap });
    if (name === "status") {
      meta.statusFieldId = field.id;
      meta.statusOptions = optionMap;
    }
  }

  return meta;
}

// Add an issue (by its GraphQL node id) to the configured board. Returns the
// project *item* id — distinct from the issue node id, and required to set
// field values on the item.
export async function addIssueToProject(issueNodeId: string): Promise<string> {
  const projectId = requireProjectId();
  const data = await projectCall(() =>
    graphqlRequest<{ addProjectV2ItemById: { item: { id: string } } }>(
      `mutation($project:ID!,$content:ID!){
        addProjectV2ItemById(input:{projectId:$project,contentId:$content}){ item{ id } }
      }`,
      { project: projectId, content: issueNodeId }
    )
  );
  return data.addProjectV2ItemById.item.id;
}

// Set a single-select field (Status, Priority) on a project item.
export async function setProjectFieldValue(
  itemId: string,
  fieldId: string,
  optionId: string
): Promise<void> {
  const projectId = requireProjectId();
  await projectCall(() =>
    graphqlRequest(
      `mutation($project:ID!,$item:ID!,$field:ID!,$opt:String!){
        updateProjectV2ItemFieldValue(input:{
          projectId:$project,itemId:$item,fieldId:$field,
          value:{ singleSelectOptionId:$opt }
        }){ projectV2Item{ id } }
      }`,
      { project: projectId, item: itemId, field: fieldId, opt: optionId }
    )
  );
}

// --- Org-level Issue Fields (Phase 5.1, #91) -------------------------------
// GitHub's newer org-level "Issue Fields" (e.g. Priority, Effort) are NOT the
// same as a project-native single-select field: their options live under
// organization.issueFields, and values are written on the *issue* (not the
// project item) via setIssueFieldValue. On such boards the project single-select
// field reports empty options, which is the signal to fall back to this path.
//
// Access needs a different permission than Projects: a classic PAT with the
// `admin:org` scope works; fine-grained PATs currently get FORBIDDEN for this
// preview API. Translate that into an actionable message rather than the
// Projects-scope one.
// The org-level Issue Fields API is a GitHub preview and is noticeably flaky —
// transient 5xx / timeouts / secondary-rate blips are common. Retry those a
// couple of times with a short backoff (#137). Permission errors (403/FORBIDDEN)
// are deterministic, so they are translated and thrown immediately, never retried.
const ORG_FIELD_MAX_ATTEMPTS = 3;
const ORG_FIELD_RETRY_BASE_MS = 300;

function isOrgFieldPermissionError(msg: string): boolean {
  return /\b403\b|FORBIDDEN|not accessible/i.test(msg);
}

async function orgFieldCall<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= ORG_FIELD_MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isOrgFieldPermissionError(msg)) {
        throw new Error(
          "[okffs] GitHub denied access to org-level Issue Fields (organization.issueFields). " +
            "This is a separate permission from Projects: a classic PAT with the `admin:org` scope works; " +
            "fine-grained PATs currently return FORBIDDEN for this preview API. Use an org-capable GITHUB_TOKEN " +
            "or set the field manually in the board UI. " +
            `Original error: ${msg}`
        );
      }
      lastErr = err;
      if (attempt < ORG_FIELD_MAX_ATTEMPTS) {
        console.warn(
          `[okffs] org Issue Fields API call failed (attempt ${attempt}/${ORG_FIELD_MAX_ATTEMPTS}), retrying: ${msg}`
        );
        await new Promise((resolve) => setTimeout(resolve, ORG_FIELD_RETRY_BASE_MS * attempt));
      }
    }
  }
  // Normalize to an Error so callers' `err instanceof Error` handling is reliable.
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export interface OrgIssueField {
  fieldId: string;
  options: Map<string, string>; // option name → option id
}

// Per-field-name cache so each org Issue Field (Priority, Effort, …) is fetched
// at most once per process. On failure the entry is cleared so a later call can
// retry.
const orgFieldCache = new Map<string, Promise<OrgIssueField | null>>();

// Discover an org single-select Issue Field by name (case-insensitive) and its
// options. Returns null if the owner isn't an org, has no such field, or it
// isn't a single-select. Throws (via orgFieldCall) on a permission error.
export function getOrgIssueField(name: string): Promise<OrgIssueField | null> {
  const key = name.toLowerCase();
  let cached = orgFieldCache.get(key);
  if (!cached) {
    cached = fetchOrgIssueField(key).catch((err) => {
      orgFieldCache.delete(key);
      throw err;
    });
    orgFieldCache.set(key, cached);
  }
  return cached;
}

async function fetchOrgIssueField(nameLower: string): Promise<OrgIssueField | null> {
  const data = await orgFieldCall(() =>
    graphqlRequest<{
      organization: {
        issueFields: {
          nodes: Array<{
            __typename?: string;
            id?: string;
            name?: string;
            options?: Array<{ id: string; name: string }>;
          }>;
        } | null;
      } | null;
    }>(
      `query($org:String!){
        organization(login:$org){
          issueFields(first:100){
            nodes{
              __typename
              ... on IssueFieldSingleSelect { id name options { id name } }
            }
          }
        }
      }`,
      { org: owner }
    )
  );

  const nodes = data.organization?.issueFields?.nodes ?? [];
  const match = nodes.find(
    (n) =>
      n.__typename === "IssueFieldSingleSelect" &&
      (n.name ?? "").toLowerCase() === nameLower &&
      n.id &&
      n.options
  );
  if (!match?.id || !match.options) return null;
  return {
    fieldId: match.id,
    options: new Map(match.options.map((o) => [o.name, o.id] as const)),
  };
}

// Set an org Issue Field single-select value on an issue (by its node id).
export async function setIssueFieldSingleSelect(
  issueNodeId: string,
  fieldId: string,
  optionId: string
): Promise<void> {
  await orgFieldCall(() =>
    graphqlRequest(
      `mutation($iss:ID!,$field:ID!,$opt:ID!){
        setIssueFieldValue(input:{
          issueId:$iss,
          issueFields:[{ fieldId:$field, singleSelectOptionId:$opt }]
        }){ issue{ number } }
      }`,
      { iss: issueNodeId, field: fieldId, opt: optionId }
    )
  );
}

// Find the project item id for an issue already on the board (null if absent).
export async function getProjectItemForIssue(issueNumber: number): Promise<string | null> {
  const projectId = requireProjectId();
  const data = await projectCall(() =>
    graphqlRequest<{
      repository: {
        issue: {
          projectItems: { nodes: Array<{ id: string; project: { id: string } }> };
        } | null;
      } | null;
    }>(
      `query($owner:String!,$repo:String!,$num:Int!){
        repository(owner:$owner,name:$repo){
          issue(number:$num){
            projectItems(first:20){ nodes{ id project{ id } } }
          }
        }
      }`,
      { owner, repo, num: issueNumber }
    )
  );
  const nodes = data.repository?.issue?.projectItems.nodes ?? [];
  return nodes.find((n) => n.project.id === projectId)?.id ?? null;
}

export interface ProjectItemFields {
  status?: string;
  priority?: string; // project-native fields only (org Issue Fields aren't exposed
  effort?: string;   // on the project item — see getOrgIssueFieldValuesByNumber)
}

// Map of issue number → its board Status + project-native Priority/Effort, for
// list_issues enrichment.
//
// Starts from THIS repo's issues (not the board's items) and reads each issue's
// projectItems, keeping the one on our board — repo-scoped by construction, so a
// foreign issue sharing a number can never enter the map (#257). Querying the
// board directly (node(project).items) keys by number alone and, on a shared org
// board, lets another repo's #N overwrite ours.
//
// first:100 + orderBy CREATED_AT desc mirrors listIssues (github.ts, REST
// state=open&per_page=100, default sort created desc). Since REST's page is
// diluted by PRs (filtered client-side) while repository.issues excludes them,
// this is a superset of what list_issues displays — every shown issue is
// covered without paginating.
export async function getProjectFieldsByIssueNumber(): Promise<Map<number, ProjectItemFields>> {
  const projectId = requireProjectId();
  const data = await projectCall(() =>
    graphqlRequest<{
      repository: {
        issues: {
          nodes: Array<{
            number: number;
            projectItems: {
              nodes: Array<{
                project: { id: string };
                status: { name?: string } | null;
                priority: { name?: string } | null;
                effort: { name?: string } | null;
              }>;
              pageInfo: { hasNextPage: boolean };
            };
          }>;
        };
      } | null;
    }>(
      `query($owner:String!,$repo:String!){
        repository(owner:$owner,name:$repo){
          issues(first:100,states:OPEN,orderBy:{field:CREATED_AT,direction:DESC}){
            nodes{
              number
              projectItems(first:10){
                nodes{
                  project{ id }
                  status:fieldValueByName(name:"Status"){
                    ... on ProjectV2ItemFieldSingleSelectValue { name }
                  }
                  priority:fieldValueByName(name:"Priority"){
                    ... on ProjectV2ItemFieldSingleSelectValue { name }
                  }
                  effort:fieldValueByName(name:"Effort"){
                    ... on ProjectV2ItemFieldSingleSelectValue { name }
                  }
                }
                pageInfo{ hasNextPage }
              }
            }
          }
        }
      }`,
      { owner, repo }
    )
  );

  const result = new Map<number, ProjectItemFields>();
  for (const issue of data.repository?.issues.nodes ?? []) {
    // Unrealistic (an issue on >10 boards), but announce it rather than silently
    // dropping the board we didn't page to.
    if (issue.projectItems.pageInfo.hasNextPage) {
      console.warn(
        `[okffs] Issue #${issue.number} is on more than 10 project boards; ` +
          "only the first 10 were checked for board fields."
      );
    }
    const item = issue.projectItems.nodes.find((n) => n.project.id === projectId);
    if (!item) continue;
    const fields: ProjectItemFields = {};
    if (item.status?.name) fields.status = item.status.name;
    if (item.priority?.name) fields.priority = item.priority.name;
    if (item.effort?.name) fields.effort = item.effort.name;
    if (fields.status || fields.priority || fields.effort) result.set(issue.number, fields);
  }
  return result;
}

// Map of issue number → its org-level Issue Field single-select values, keyed by
// lowercased field name (e.g. "priority" → "High", "effort" → "Medium"). For
// boards whose Priority/Effort are org Issue Fields (not project-native fields —
// those aren't readable off the project item). One batched query over open
// issues. Needs the org-field permission, so callers gate this on
// OKFFS_CLASSIC_PAT. Throws (via orgFieldCall) on a permission error; list_issues
// treats that as non-fatal.
export async function getOrgIssueFieldValuesByNumber(): Promise<Map<number, Map<string, string>>> {
  const data = await orgFieldCall(() =>
    graphqlRequest<{
      repository: {
        issues: {
          nodes: Array<{
            number: number;
            issueFieldValues: {
              nodes: Array<{
                __typename?: string;
                name?: string;
                field?: { name?: string };
              }>;
            };
          }>;
        };
      } | null;
    }>(
      `query($owner:String!,$repo:String!){
        repository(owner:$owner,name:$repo){
          issues(first:100,states:OPEN){
            nodes{
              number
              issueFieldValues(first:50){
                nodes{
                  __typename
                  ... on IssueFieldSingleSelectValue {
                    name
                    field{ ... on IssueFieldSingleSelect { name } }
                  }
                }
              }
            }
          }
        }
      }`,
      { owner, repo }
    )
  );

  const result = new Map<number, Map<string, string>>();
  for (const issue of data.repository?.issues.nodes ?? []) {
    const values = new Map<string, string>();
    for (const v of issue.issueFieldValues.nodes) {
      const fname = v.field?.name;
      if (fname && v.name) values.set(fname.toLowerCase(), v.name);
    }
    if (values.size) result.set(issue.number, values);
  }
  return result;
}
