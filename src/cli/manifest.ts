// The env-var manifest — the single source of truth the setup wizard, sync mode,
// and the .env writer all read from. It mirrors .env.example (grouped sections,
// descriptions, defaults) in a structured form so the three consumers never
// drift from one another. Keep it in sync with .env.example and src/config.ts
// when adding a variable (the sanity of that trio is the whole point).

export type VarKind = "text" | "boolean" | "secret" | "select";

export interface VarSpec {
  key: string;
  kind: VarKind;
  /** One-line help shown at the prompt. */
  description: string;
  /** Default value (as it would appear in .env). Empty string = unset. */
  default: string;
  /** Allowed values for kind: "select". */
  options?: string[];
  /** Example value shown as placeholder for free-text vars. */
  placeholder?: string;
}

export interface Section {
  id: string;
  /** Header comment written into the generated .env. */
  title: string;
  /** Optional explanatory line under the header. */
  blurb?: string;
  vars: VarSpec[];
  /**
   * A gated section asks a single yes/no question first; declining it skips the
   * whole group (its vars are written as commented placeholders). Auth & repo is
   * the only ungated section — it is always asked.
   */
  gated: boolean;
  /** Prompt shown for the gate question. */
  gatePrompt?: string;
  /**
   * For a section whose gate maps onto a real boolean env var (Projects), the
   * gate answer is persisted to this key (true/false) rather than just toggling
   * whether the sub-vars are asked.
   */
  gateKey?: string;
  /**
   * Only offer this section when the predicate holds against values collected so
   * far (e.g. promotion is only relevant once a protected branch is set).
   */
  onlyIf?: (values: Record<string, string>) => boolean;
}

const PRIORITY = ["Urgent", "High", "Medium", "Low"];
const EFFORT = ["High", "Medium", "Low"];
const MERGE_METHODS = ["squash", "merge", "rebase"];

export const SECTIONS: Section[] = [
  {
    id: "auth",
    title: "1. GitHub connection",
    blurb: "Auth & repository. Leave GITHUB_TOKEN blank to fall back to the GitHub CLI (`gh auth token`); owner/repo auto-detect from the `origin` remote.",
    gated: false,
    vars: [
      {
        key: "GITHUB_TOKEN",
        kind: "secret",
        description:
          "GitHub personal access token. Create a fine-grained one at " +
          "https://github.com/settings/personal-access-tokens/new with these repo permissions: " +
          "Issues, Contents, Pull requests (Read & write), Metadata (Read), Administration (Read & write). " +
          "Leave blank to fall back to the GitHub CLI (`gh auth token`).",
        default: "",
      },
      {
        key: "GITHUB_OWNER",
        kind: "text",
        description: "Repository owner (org or user). Blank = auto-detect from the git remote.",
        default: "",
        placeholder: "neturely",
      },
      {
        key: "GITHUB_REPO",
        kind: "text",
        description: "Repository name. Blank = auto-detect from the git remote.",
        default: "",
        placeholder: "okffs",
      },
    ],
  },
  {
    id: "branching",
    title: "2. Branching",
    gated: true,
    gatePrompt: "Configure branching (base/protected branch, identifier prefix)?",
    vars: [
      {
        key: "OKFFS_BASE_BRANCH",
        kind: "text",
        description: "Branch new issue branches are created from. Blank = the repo's default branch.",
        default: "",
        placeholder: "develop",
      },
      {
        key: "OKFFS_PROTECTED_BRANCH",
        kind: "text",
        description: "A branch okffs must never autonomously merge/tag/publish into (e.g. main). Governs merging, not PR creation.",
        default: "",
        placeholder: "main",
      },
      {
        key: "OKFFS_IDENTIFIER",
        kind: "text",
        description: "Project-scoped prefix inserted into branch names: {issue}-{identifier}-{slug}.",
        default: "",
        placeholder: "okffs",
      },
    ],
  },
  {
    id: "defaults",
    title: "3. Issue defaults & inference",
    gated: true,
    gatePrompt: "Configure issue defaults & inference (labels, assignees, priority/effort/type)?",
    vars: [
      {
        key: "OKFFS_DEFAULT_LABELS",
        kind: "text",
        description: "Comma-separated labels added to EVERY new issue, on top of any Claude picks from the task — e.g. okffs, backend, needs-triage.",
        default: "",
        placeholder: "okffs, backend",
      },
      {
        key: "OKFFS_DEFAULT_ASSIGNEES",
        kind: "text",
        description: "Comma-separated usernames assigned to every new issue.",
        default: "",
      },
      {
        key: "OKFFS_DEFAULT_PRIORITY",
        kind: "select",
        description: "Board Priority fallback when none is inferred/given. Needs a Priority field on the board.",
        default: "",
        options: ["", ...PRIORITY],
      },
      {
        key: "OKFFS_DEFAULT_EFFORT",
        kind: "select",
        description: "Board Effort fallback when none is inferred/given. Needs an Effort field on the board.",
        default: "",
        options: ["", ...EFFORT],
      },
      {
        key: "OKFFS_DEFAULT_TYPE",
        kind: "text",
        description: "Native GitHub Issue Type fallback (org-level, e.g. Task/Bug/Feature). Blank = none.",
        default: "",
        placeholder: "Task",
      },
      {
        key: "OKFFS_INFER_PRIORITY",
        kind: "boolean",
        description: "Have Claude read each new issue's title/description and decide its priority (Urgent/High/Medium/Low) for you, instead of you setting one. Falls back to the default above when it can't judge.",
        default: "true",
      },
      {
        key: "OKFFS_INFER_EFFORT",
        kind: "boolean",
        description: "Have Claude read each new issue and decide its effort (High/Medium/Low) for you, instead of you setting one. Falls back to the default above.",
        default: "true",
      },
      {
        key: "OKFFS_INFER_TYPE",
        kind: "boolean",
        description: "Have Claude read each new issue and decide its GitHub Issue Type (e.g. Bug/Feature/Task) for you, instead of you setting one. Falls back to the default above.",
        default: "true",
      },
    ],
  },
  {
    id: "prmerge",
    title: "4. Pull requests & merging",
    gated: true,
    gatePrompt: "Configure PR & merge behaviour (auto-PR, merge methods, auto-merge)?",
    vars: [
      {
        key: "OKFFS_AUTO_PR",
        kind: "boolean",
        description: "Open a draft PR at branch-creation time (via create_issue).",
        default: "false",
      },
      {
        key: "OKFFS_BASE_MERGE_METHOD",
        kind: "select",
        description: "PR merge method for the base tier (e.g. develop).",
        default: "squash",
        options: MERGE_METHODS,
      },
      {
        key: "OKFFS_PROTECTED_MERGE_METHOD",
        kind: "select",
        description: "PR merge method for the protected tier (e.g. main). Config only — okffs never merges it autonomously.",
        default: "merge",
        options: MERGE_METHODS,
      },
      {
        key: "OKFFS_AUTO_MERGE_BASE",
        kind: "boolean",
        description: "Let merge_pull_request autonomously merge a green, threads-resolved PR into the BASE branch. Heavily gated; never touches the protected branch.",
        default: "false",
      },
    ],
  },
  {
    id: "docs",
    title: "5. Docs & changelog",
    gated: true,
    gatePrompt: "Configure auto doc updates (CHANGELOG fragments, SECURITY.md)?",
    vars: [
      {
        key: "OKFFS_UPDATE_DOCS",
        kind: "boolean",
        description: "Auto-write doc updates (CHANGELOG fragment + SECURITY.md) onto the branch at create_pull_request time.",
        default: "false",
      },
      {
        key: "OKFFS_EXCLUDE_DOCS",
        kind: "text",
        description: "Comma-separated filenames to exclude from doc updates (valid: CHANGELOG.md, SECURITY.md).",
        default: "",
        placeholder: "SECURITY.md",
      },
    ],
  },
  {
    id: "review",
    title: "6. PR review",
    gated: true,
    gatePrompt: "Configure how okffs handles PR review feedback — e.g. from GitHub Copilot code review or human reviewers?",
    vars: [
      {
        key: "OKFFS_RESOLVE_THREADS",
        kind: "boolean",
        description: "After Claude fixes a PR's review comments, automatically mark those review threads resolved — e.g. threads left by GitHub Copilot code review or a human reviewer. Off = you resolve them yourself.",
        default: "false",
      },
      {
        key: "OKFFS_UPDATE_GUIDANCE",
        kind: "boolean",
        description: "Nudge create_pull_request to keep CLAUDE.md's okffs-owned guidance in sync with functionality changes.",
        default: "false",
      },
    ],
  },
  {
    id: "projects",
    title: "7. GitHub Projects v2 (board)",
    gated: true,
    gateKey: "OKFFS_PROJECT_ENABLED",
    gatePrompt: "Enable the GitHub Projects v2 integration?",
    vars: [
      {
        key: "OKFFS_PROJECT_ID",
        kind: "text",
        description: "The Project's GraphQL node ID (e.g. PVT_kwHO...). Required when Projects is enabled.",
        default: "",
        placeholder: "PVT_kwHO...",
      },
      {
        key: "OKFFS_PROJECT_AUTO_ADD",
        kind: "boolean",
        description: "Fallback for boards without native auto-add: create_issue adds each new issue to the board.",
        default: "false",
      },
      {
        key: "OKFFS_PROJECT_INITIAL_STATUS",
        kind: "text",
        description: "Board Status column a freshly auto-added issue should land in (e.g. Backlog).",
        default: "",
        placeholder: "Backlog",
      },
      {
        key: "OKFFS_CLASSIC_PAT",
        kind: "boolean",
        description: "Set true ONLY if GITHUB_TOKEN is a classic PAT with admin:org — unlocks org-level Issue Field Priority/Effort. SECURITY: broad token.",
        default: "false",
      },
    ],
  },
  {
    id: "promotion",
    title: "8. Branch promotion & releases",
    blurb: "promote_branch opens the issue-less base→protected promotion PR (e.g. develop→main).",
    gated: true,
    gatePrompt: "Configure the promotion gate (reviewers on the develop→main PR)?",
    onlyIf: (v) => Boolean(v.OKFFS_PROTECTED_BRANCH),
    vars: [
      {
        key: "OKFFS_PROMOTION_STATUS",
        kind: "text",
        description: "Board Status column the promotion PR card should land in (e.g. Review). Needs Projects enabled.",
        default: "",
        placeholder: "Review",
      },
      {
        key: "OKFFS_PROMOTION_REVIEWERS",
        kind: "text",
        description: "Comma-separated reviewers requested on the promotion PR (e.g. copilot-pull-request-reviewer[bot]).",
        default: "",
        placeholder: "copilot-pull-request-reviewer[bot]",
      },
      {
        key: "OKFFS_PROMOTION_AUTO_REVIEW",
        kind: "boolean",
        description: "Auto-request the reviewers above on the gate PR. COST: a billable reviewer (Copilot) is charged per new PR.",
        default: "false",
      },
    ],
  },
  {
    id: "misc",
    title: "9. Misc",
    gated: true,
    gatePrompt: "Configure misc options (metadata tip)?",
    vars: [
      {
        key: "OKFFS_PROMPT_METADATA",
        kind: "boolean",
        description: "After creating an issue, print a one-line reminder that you can also set assignees, labels, priority, etc. Turn off to silence that tip.",
        default: "true",
      },
    ],
  },
];

/** Every var key the manifest knows about, in section order. */
export function allKeys(): string[] {
  return SECTIONS.flatMap((s) => s.vars.map((v) => v.key)).concat(
    // Gate keys that are real env vars (e.g. OKFFS_PROJECT_ENABLED) but not listed
    // among their section's vars.
    SECTIONS.filter((s) => s.gateKey).map((s) => s.gateKey!)
  );
}

/** Look up a var spec by key across all sections. */
export function findVar(key: string): VarSpec | undefined {
  for (const s of SECTIONS) {
    const found = s.vars.find((v) => v.key === key);
    if (found) return found;
  }
  return undefined;
}

/** Keys that make up the Quick-setup subset (auth & repo + base branch). */
export const QUICK_KEYS = ["GITHUB_TOKEN", "GITHUB_OWNER", "GITHUB_REPO", "OKFFS_BASE_BRANCH"];
