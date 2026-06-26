export const config = {
  promptForMetadata: process.env.OKFFS_PROMPT_METADATA !== "false",
  defaultAssignees: process.env.OKFFS_DEFAULT_ASSIGNEES
    ? process.env.OKFFS_DEFAULT_ASSIGNEES.split(",").map((s) => s.trim())
    : [],
  defaultLabels: process.env.OKFFS_DEFAULT_LABELS
    ? process.env.OKFFS_DEFAULT_LABELS.split(",").map((s) => s.trim())
    : [],
  baseBranch: process.env.OKFFS_BASE_BRANCH || null,
  updateDocs: process.env.OKFFS_UPDATE_DOCS === "true",
  // OKFFS_AUTO_PR=true — creates a draft PR when a new issue branch is created
  autoPR: process.env.OKFFS_AUTO_PR === "true",
  excludeDocs: process.env.OKFFS_EXCLUDE_DOCS
    ? process.env.OKFFS_EXCLUDE_DOCS.split(",").map((s) => s.trim())
    : [],
};
