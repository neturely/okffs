export const name = "update_guidance";

export const description =
  "Review the work done for an issue and intelligently update CLAUDE.md to reflect any new or changed functionality.";

export const argumentDefs = [
  {
    name: "issue_number",
    description: "The issue number whose changes to review (optional; defaults to the current branch)",
    required: false,
  },
];

export function build(args: Record<string, string | undefined>) {
  const scope = args.issue_number ? `issue #${args.issue_number}` : "the current branch";
  const text = [
    `Review the changes made for ${scope} and update CLAUDE.md **only if** they add or change functionality, configuration, or conventions. This is substantive guidance maintenance — not a changelog (CHANGELOG.md already covers history), so do not add a "Recent Changes" log.`,
    ``,
    `Look at the diff (e.g. \`git diff\` against the base branch) and apply minimal, accurate edits to the **correct existing sections** of CLAUDE.md:`,
    `- New tool → add it to the tools list with a one-line description.`,
    `- New env var / config option → document it where the other env vars are described.`,
    `- New or changed convention / workflow → update the relevant section.`,
    `- New MCP prompt / slash command → note it alongside the others.`,
    ``,
    `Guidelines:`,
    `- If nothing substantive changed (e.g. a trivial bug fix or pure docs tweak), make **no edits** and say so.`,
    `- Keep edits concise and consistent with the surrounding style; don't restructure unrelated content.`,
    `- Commit any CLAUDE.md changes to the current branch so they're included in the PR for review — never leave silent uncommitted edits.`,
  ].join("\n");

  return {
    description: `Update CLAUDE.md to reflect functionality changes from ${scope}`,
    messages: [
      {
        role: "user" as const,
        content: { type: "text" as const, text },
      },
    ],
  };
}
