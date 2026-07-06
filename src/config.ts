export const config = {
  promptForMetadata: process.env.OKFFS_PROMPT_METADATA !== "false",
  defaultAssignees: process.env.OKFFS_DEFAULT_ASSIGNEES
    ? process.env.OKFFS_DEFAULT_ASSIGNEES.split(",").map((s) => s.trim())
    : [],
  defaultLabels: process.env.OKFFS_DEFAULT_LABELS
    ? process.env.OKFFS_DEFAULT_LABELS.split(",").map((s) => s.trim())
    : [],
  baseBranch: process.env.OKFFS_BASE_BRANCH || null,
  // OKFFS_PROTECTED_BRANCH — a branch okffs won't open/finalize a PR into without
  // explicit user confirmation (e.g. `main`). create_pull_request refuses to
  // target it without confirmed:true, and prepare_release flags promoting/tagging
  // into it as manual, user-gated steps. Note: create_issue's OKFFS_AUTO_PR draft
  // is not gated (a draft is not a promotion), but finalizing it via
  // create_pull_request is — so the merge-worthy step still requires confirmation.
  // Guards against an agent auto-driving a full release (#152).
  protectedBranch: process.env.OKFFS_PROTECTED_BRANCH || null,
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
  // OKFFS_CLASSIC_PAT=true — a declaration that GITHUB_TOKEN is a classic PAT with
  // org-admin scope (`admin:org`), which unlocks org-admin-level features that
  // fine-grained PATs can't reach — currently setting a Priority that is a GitHub
  // *org-level Issue Field* (#91), via organization.issueFields / setIssueFieldValue.
  // Off by default. SECURITY: classic `admin:org` tokens are broad (all your repos
  // + org admin); only enable this if you accept that tradeoff. When off, okffs
  // skips the org Issue Field API path entirely and tells you to set it manually.
  classicPat: process.env.OKFFS_CLASSIC_PAT === "true",
  // OKFFS_DEFAULT_PRIORITY — Priority applied to a new issue when create_issue
  // isn't given an explicit `priority` (mirrors OKFFS_DEFAULT_LABELS/ASSIGNEES).
  // Flows through the same priority handling: set via a project-native Priority
  // field, or an org Issue Field when OKFFS_CLASSIC_PAT is on; skipped gracefully
  // otherwise. Unset = no priority unless the caller passes one. e.g. "Medium".
  defaultPriority: process.env.OKFFS_DEFAULT_PRIORITY || null,
  // OKFFS_DEFAULT_EFFORT — same as OKFFS_DEFAULT_PRIORITY, for the board's Effort
  // field (org Issue Field or project-native). Unset = no effort unless passed.
  defaultEffort: process.env.OKFFS_DEFAULT_EFFORT || null,
  // OKFFS_INFER_PRIORITY / OKFFS_INFER_EFFORT — when on (the default), create_issue's
  // tool description tells Claude to infer a priority/effort for the issue from the
  // task itself, so okffs uses its AI brain rather than always relying on the static
  // OKFFS_DEFAULT_*. Claude omits the field when it genuinely can't judge, and the
  // default fills in. Set to "false" to turn the inference instruction off (only an
  // explicit param or the default is used then).
  inferPriority: process.env.OKFFS_INFER_PRIORITY !== "false",
  inferEffort: process.env.OKFFS_INFER_EFFORT !== "false",
  // OKFFS_INFER_TYPE / OKFFS_DEFAULT_TYPE — native GitHub Issue Type (Task/Bug/
  // Feature/Epic/Story) handling, parallel to priority/effort. When inference is
  // on (the default), create_issue's description tells Claude to pick the fitting
  // org-defined type from the task; OKFFS_DEFAULT_TYPE fills in when it can't
  // judge (or when inference is off). Both no-op cleanly when the org defines no
  // Issue Types / the token can't read them (org-level feature — see #201, #199).
  inferType: process.env.OKFFS_INFER_TYPE !== "false",
  defaultType: process.env.OKFFS_DEFAULT_TYPE || null,
  // OKFFS_PROJECT_INITIAL_STATUS — Status column a freshly auto-added issue
  // should land in (e.g. "Backlog"). Set after the draft PR is created so it
  // wins over GitHub's "PR linked to issue" workflow, which would otherwise flip
  // a scaffolded issue straight to "In Progress" (#103). Unset = leave whatever
  // column the board's own automation assigns.
  projectInitialStatus: process.env.OKFFS_PROJECT_INITIAL_STATUS || null,
  // OKFFS_PROMOTION_STATUS — board Status column the develop→main promotion PR
  // card should land in when promote_branch adds it to the board (e.g. "Review").
  // Unset = leave the card wherever the board's own automation puts it. (#182)
  promotionStatus: process.env.OKFFS_PROMOTION_STATUS || null,
  // OKFFS_PROMOTION_REVIEWERS — comma-separated reviewers to request on the
  // promote_branch gate PR (e.g. `copilot-pull-request-reviewer[bot]` for GitHub
  // Copilot code review, the develop→main review convention). Unset = request no
  // reviewers. Best-effort: a failure warns and never blocks the PR. (#182)
  // Only acted on when OKFFS_PROMOTION_AUTO_REVIEW is true.
  promotionReviewers: process.env.OKFFS_PROMOTION_REVIEWERS
    ? process.env.OKFFS_PROMOTION_REVIEWERS.split(",").map((s) => s.trim()).filter(Boolean)
    : [],
  // OKFFS_PROMOTION_AUTO_REVIEW — explicit opt-in for promote_branch to auto-request
  // OKFFS_PROMOTION_REVIEWERS on the gate PR. Default false (cost-safe). When true,
  // reviewers are requested ONLY when the gate PR is first created — never on
  // updates/re-runs — so a paid reviewer (e.g. Copilot) isn't re-triggered
  // repeatedly. ⚠️ COST: enabling this with a billable reviewer incurs a charge per
  // newly-created gate PR. Re-review after new commits is a manual step. (#194)
  promotionAutoReview: process.env.OKFFS_PROMOTION_AUTO_REVIEW === "true",
};

// Warn once at startup if the feature is half-configured. Non-fatal: the
// Projects code no-ops when disabled, and every call re-checks projectId.
if (config.projectEnabled && !config.projectId) {
  console.warn(
    "[okffs] OKFFS_PROJECT_ENABLED=true but OKFFS_PROJECT_ID is unset — Projects features are inert until you set the board's GraphQL node ID."
  );
}
