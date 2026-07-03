// GitHub Projects v2 integration (Phase 5).
//
// Projects v2 has no REST API, so everything here goes through GraphQL, reusing
// the shared `graphqlRequest` helper from github.ts. Field and single-select
// option node IDs differ per board, so they are discovered at runtime (and
// memoized) rather than hardcoded. All calls no-op / throw clearly when the
// feature is disabled or the token lacks Projects permission.

import { graphqlRequest, owner, repo } from "./github.js";
import { config } from "./config.js";

export interface ProjectMetadata {
  // Single-select field ids + their option maps (option name → option id).
  // Status is expected on any board; Priority is optional.
  statusFieldId: string | null;
  statusOptions: Map<string, string>;
  priorityFieldId: string | null;
  priorityOptions: Map<string, string>;
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
            fields(first:50){
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
    priorityFieldId: null,
    priorityOptions: new Map(),
  };

  for (const field of data.node.fields.nodes) {
    // Non-single-select fields come back as empty objects from the inline
    // fragment — skip anything without a name and options.
    if (!field.id || !field.name || !field.options) continue;
    const optionMap = new Map(field.options.map((o) => [o.name, o.id] as const));
    const name = field.name.toLowerCase();
    if (name === "status") {
      meta.statusFieldId = field.id;
      meta.statusOptions = optionMap;
    } else if (name === "priority") {
      meta.priorityFieldId = field.id;
      meta.priorityOptions = optionMap;
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
async function orgFieldCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/\b403\b|FORBIDDEN|not accessible/i.test(msg)) {
      throw new Error(
        "[okffs] GitHub denied access to org-level Issue Fields (organization.issueFields). " +
          "This is a separate permission from Projects: a classic PAT with the `admin:org` scope works; " +
          "fine-grained PATs currently return FORBIDDEN for this preview API. Use an org-capable GITHUB_TOKEN " +
          "or set the Priority manually in the board UI. " +
          `Original error: ${msg}`
      );
    }
    throw err;
  }
}

export interface OrgIssueField {
  fieldId: string;
  options: Map<string, string>; // option name → option id
}

let orgPriorityCache: Promise<OrgIssueField | null> | null = null;

// Discover the org's single-select "Priority" Issue Field and its options once
// per process. Returns null if the owner isn't an org, has no such field, or the
// field isn't a single-select. Throws (via orgFieldCall) on a permission error.
export function getOrgIssueFieldPriority(): Promise<OrgIssueField | null> {
  if (!orgPriorityCache) {
    orgPriorityCache = fetchOrgIssueFieldPriority().catch((err) => {
      orgPriorityCache = null;
      throw err;
    });
  }
  return orgPriorityCache;
}

async function fetchOrgIssueFieldPriority(): Promise<OrgIssueField | null> {
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
          issueFields(first:50){
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
  const priority = nodes.find(
    (n) =>
      n.__typename === "IssueFieldSingleSelect" &&
      (n.name ?? "").toLowerCase() === "priority" &&
      n.id &&
      n.options
  );
  if (!priority?.id || !priority.options) return null;
  return {
    fieldId: priority.id,
    options: new Map(priority.options.map((o) => [o.name, o.id] as const)),
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
  priority?: string; // project-native Priority field only (org Issue Fields aren't
                     // exposed on the project item — see getOrgIssuePrioritiesByNumber)
}

// Map of issue number → its board Status + project-native Priority, for
// list_issues enrichment. Capped at the first 100 board items (matches
// list_issues' own page size).
export async function getProjectFieldsByIssueNumber(): Promise<Map<number, ProjectItemFields>> {
  const projectId = requireProjectId();
  const data = await projectCall(() =>
    graphqlRequest<{
      node: {
        items: {
          nodes: Array<{
            content: { number?: number } | null;
            status: { name?: string } | null;
            priority: { name?: string } | null;
          }>;
        };
      } | null;
    }>(
      `query($project:ID!){
        node(id:$project){
          ... on ProjectV2 {
            items(first:100){
              nodes{
                content{ ... on Issue { number } }
                status:fieldValueByName(name:"Status"){
                  ... on ProjectV2ItemFieldSingleSelectValue { name }
                }
                priority:fieldValueByName(name:"Priority"){
                  ... on ProjectV2ItemFieldSingleSelectValue { name }
                }
              }
            }
          }
        }
      }`,
      { project: projectId }
    )
  );

  const result = new Map<number, ProjectItemFields>();
  for (const item of data.node?.items.nodes ?? []) {
    const number = item.content?.number;
    if (number == null) continue;
    const fields: ProjectItemFields = {};
    if (item.status?.name) fields.status = item.status.name;
    if (item.priority?.name) fields.priority = item.priority.name;
    if (fields.status || fields.priority) result.set(number, fields);
  }
  return result;
}

// Map of issue number → org-level Issue Field "Priority" value, for boards whose
// Priority is an org Issue Field (not a project-native field — those aren't
// readable off the project item). One batched query over open issues. Needs the
// org-field permission, so callers gate this on OKFFS_CLASSIC_PAT. Throws (via
// orgFieldCall) on a permission error; list_issues treats that as non-fatal.
export async function getOrgIssuePrioritiesByNumber(): Promise<Map<number, string>> {
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
              issueFieldValues(first:10){
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

  const result = new Map<number, string>();
  for (const issue of data.repository?.issues.nodes ?? []) {
    const pri = issue.issueFieldValues.nodes.find(
      (v) => v.field?.name === "Priority" && v.name
    );
    if (pri?.name) result.set(issue.number, pri.name);
  }
  return result;
}
