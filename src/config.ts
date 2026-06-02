export const config = {
  promptForMetadata: process.env.OKFFS_PROMPT_METADATA !== "false",
  defaultAssignees: process.env.OKFFS_DEFAULT_ASSIGNEES
    ? process.env.OKFFS_DEFAULT_ASSIGNEES.split(",").map((s) => s.trim())
    : [],
  defaultLabels: process.env.OKFFS_DEFAULT_LABELS
    ? process.env.OKFFS_DEFAULT_LABELS.split(",").map((s) => s.trim())
    : [],
};
