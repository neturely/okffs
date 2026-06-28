export const name = "update_guidance";

export const description =
  "Review the work done for an issue and intelligently maintain the okffs-owned 'Project Guidance (okffs usage)' section of CLAUDE.md to reflect new or changed functionality.";

export const argumentDefs = [
  {
    name: "issue_number",
    description: "The issue number whose changes to review (optional; defaults to the current branch)",
    required: false,
  },
];

const START_MARKER = "<!-- okffs:guidance:start -->";
const END_MARKER = "<!-- okffs:guidance:end -->";

export function build(args: Record<string, string | undefined>) {
  const scope = args.issue_number ? `issue #${args.issue_number}` : "the current branch";
  const text = [
    `Maintain the okffs-owned guidance section of CLAUDE.md to reflect the changes from ${scope}. This is substantive guidance for future agents — not a changelog (CHANGELOG.md covers history).`,
    ``,
    `**Only edit within the okffs-owned region**, delimited by these markers:`,
    ``,
    "```markdown",
    START_MARKER,
    `## Project Guidance (okffs usage)`,
    `- LLM-maintained notes: project tooling, conventions, and anything agents should know.`,
    END_MARKER,
    "```",
    ``,
    `Steps:`,
    `1. Look at the diff (e.g. \`git diff\` against the base branch) to see what changed.`,
    `2. If the markers don't exist in CLAUDE.md yet, create the section once — append the start marker, the \`## Project Guidance (okffs usage)\` heading, the content, then the end marker — at the end of the file.`,
    `3. Update the content **between the markers only** to reflect current functionality/conventions: add new tools, env vars, MCP prompts/slash commands, or workflow conventions; revise or remove entries that are now stale. Curate it (organize, dedupe, rewrite) — keep it a clean current-state summary, not a running log.`,
    ``,
    `Rules:`,
    `- **Never modify anything outside the two markers** — the rest of CLAUDE.md is the user's hand-written content.`,
    `- If nothing substantive changed (e.g. a trivial bug fix or pure docs tweak), make **no edits** and say so.`,
    `- Keep it concise and consistent in style.`,
    `- Commit any CLAUDE.md change to the current branch so it's included in the PR for review — never leave silent uncommitted edits.`,
  ].join("\n");

  return {
    description: `Maintain the okffs guidance section of CLAUDE.md for ${scope}`,
    messages: [
      {
        role: "user" as const,
        content: { type: "text" as const, text },
      },
    ],
  };
}
