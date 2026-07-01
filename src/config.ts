export const config = {
  promptForMetadata: process.env.OKFFS_PROMPT_METADATA !== "false",
  defaultAssignees: process.env.OKFFS_DEFAULT_ASSIGNEES
    ? process.env.OKFFS_DEFAULT_ASSIGNEES.split(",").map((s) => s.trim())
    : [],
  defaultLabels: process.env.OKFFS_DEFAULT_LABELS
    ? process.env.OKFFS_DEFAULT_LABELS.split(",").map((s) => s.trim())
    : [],
  baseBranch: process.env.OKFFS_BASE_BRANCH || null,
  // OKFFS_IDENTIFIER — optional project-scoped prefix inserted into branch names:
  // {issue-number}-{identifier}-{slug} instead of {issue-number}-{slug}
  identifier: process.env.OKFFS_IDENTIFIER || null,
  updateDocs: process.env.OKFFS_UPDATE_DOCS === "true",
  // OKFFS_AUTO_PR=true — creates a draft PR when a new issue branch is created
  autoPR: process.env.OKFFS_AUTO_PR === "true",
  // OKFFS_RESOLVE_THREADS=true — auto-resolve PR review threads after they are
  // addressed. Default false: threads are left open for the user to resolve.
  resolveThreads: process.env.OKFFS_RESOLVE_THREADS === "true",
  // OKFFS_UPDATE_GUIDANCE=true — nudge the agent to keep CLAUDE.md in sync with
  // new/changed functionality when a PR is created (intelligent, not a changelog
  // append). Default false. The `update_guidance` prompt works regardless.
  updateGuidance: process.env.OKFFS_UPDATE_GUIDANCE === "true",
  excludeDocs: process.env.OKFFS_EXCLUDE_DOCS
    ? process.env.OKFFS_EXCLUDE_DOCS.split(",").map((s) => s.trim())
    : [],
  // ── GitHub Projects v2 (Phase 5) ──────────────────────────────────────────
  // OKFFS_PROJECT_ENABLED=true — opt-in; surfaces the project column in
  // list_issues and lets update_project_status run. Zero overhead when unset.
  projectEnabled: process.env.OKFFS_PROJECT_ENABLED === "true",
  // OKFFS_PROJECT_ID — the Project's GraphQL node ID (e.g. PVT_kwHO...).
  projectId: process.env.OKFFS_PROJECT_ID || null,
  // OKFFS_PROJECT_AUTO_ADD=true — fallback for users without native GitHub board
  // automation: create_issue adds the new issue to the board. Off by default.
  projectAutoAdd: process.env.OKFFS_PROJECT_AUTO_ADD === "true",
};

// Warn once at startup if the feature is half-configured. Non-fatal: the
// Projects code no-ops when disabled, and every call re-checks projectId.
if (config.projectEnabled && !config.projectId) {
  console.warn(
    "[okffs] OKFFS_PROJECT_ENABLED=true but OKFFS_PROJECT_ID is unset — Projects features are inert until you set the board's GraphQL node ID."
  );
}
