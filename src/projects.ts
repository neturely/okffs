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
// than leaking a raw GraphQL FORBIDDEN blob. Permission errors arrive either as
// an HTTP 403 or as a 200 with a FORBIDDEN error in the payload.
async function projectCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/\b403\b|FORBIDDEN|not accessible/i.test(msg)) {
      throw new Error(
        "[okffs] GitHub denied a Projects API call (403 / forbidden). The token needs Projects access: " +
          'fine-grained PAT → Organization permissions → "Projects: Read and write"; ' +
          "classic PAT → the `project` scope. " +
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

// Map of issue number → current Status column, for list_issues enrichment.
// Capped at the first 100 board items (matches list_issues' own page size).
export async function getProjectStatusByIssueNumber(): Promise<Map<number, string>> {
  const projectId = requireProjectId();
  const data = await projectCall(() =>
    graphqlRequest<{
      node: {
        items: {
          nodes: Array<{
            content: { number?: number } | null;
            fieldValueByName: { name?: string } | null;
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
                fieldValueByName(name:"Status"){
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

  const result = new Map<number, string>();
  for (const item of data.node?.items.nodes ?? []) {
    const number = item.content?.number;
    const status = item.fieldValueByName?.name;
    if (number != null && status) result.set(number, status);
  }
  return result;
}
