import { SECTIONS } from "../cli/manifest.js";

export const name = "setup";

export const description =
  "Configure okffs for this repo conversationally, right here in the chat — the in-Claude-Code counterpart to the `okffs setup` CLI wizard. Interviews you for the settings that apply, then writes them to .env via the `configure` tool (preserving your own variables and comments).";

export const argumentDefs = [
  {
    name: "mode",
    description: "Optional: 'quick' (auth + repo + base branch only), 'full' (every section), or 'sync' (only options not yet configured). Defaults to sync when a .env exists, else asks.",
    required: false,
  },
];

// Render the manifest into a compact reference the model can drive the interview
// from, so the prompt is self-contained (no need to also expose the manifest as a
// resource). Mirrors how create_issue injects the board's real options.
function renderReference(): string {
  const lines: string[] = [];
  for (const s of SECTIONS) {
    const gate = !s.gated
      ? "always ask"
      : s.gateKey
        ? `gated — ask "${s.gatePrompt}" and record the answer as ${s.gateKey}=true/false`
        : `gated — ask "${s.gatePrompt}"; if declined, mark its vars declined`;
    const cond = s.onlyIf ? " [only if a protected branch is set]" : "";
    lines.push(`\n### ${s.title} (${gate})${cond}`);
    for (const v of s.vars) {
      const opts = v.options ? ` options: ${v.options.map((o) => o || "(unset)").join("/")};` : "";
      const def = v.default ? ` default: ${v.default};` : "";
      lines.push(`- \`${v.key}\` (${v.kind});${opts}${def} ${v.description}`);
    }
  }
  return lines.join("\n");
}

export function build(args: Record<string, string | undefined>) {
  const mode = args.mode?.trim().toLowerCase();

  const text = [
    `Configure okffs for THIS repository by talking with the user, then persist the result by calling the \`configure\` tool. Do not edit .env yourself — \`configure\` owns the write (it preserves the user's own variables and comments, touching only okffs's marked block).`,
    ``,
    `## 1. Assess current state`,
    `- Read \`./.env\` in the current working directory if it exists (use your file-reading tool). Note which \`GITHUB_*\`/\`OKFFS_*\` variables are already set, and look for the \`# okffs:configured-version=…\` stamp.`,
    `- **Never print or echo the value of GITHUB_TOKEN** (or any secret). Acknowledge it's set without showing it.`,
    ``,
    `## 2. Choose breadth`,
    mode
      ? `- The user requested **${mode}** mode.`
      : `- No .env yet → ask the user: **Quick** (auth, repo, base branch only) or **Full** (every section). A .env already exists → default to **sync**: only ask about variables that are not yet set. Offer "reconfigure everything" if they want a full pass.`,
    `- In sync/upgrade situations, only ask about variables that are missing — leave already-configured values alone unless the user asks to change them.`,
    ``,
    `## 3. Interview`,
    `- Go section by section using the reference below. For a **gated** section, ask its single gate question first; if the user declines, skip the whole group (and include those vars in \`declined\`).`,
    `- For each variable: show already-set values (mask the token) with a keep/change choice; for unset ones, give the short description and default and let the user set or skip.`,
    `- For \`GITHUB_TOKEN\`: mention they can leave it blank to use the GitHub CLI (\`gh auth token\`), and share the fine-grained PAT URL from the reference. Let them paste a token OR choose the gh fallback — don't force it.`,
    `- Keep it brief and batch related questions; don't interrogate one variable at a time when a section can be covered together.`,
    ``,
    `## 4. Persist`,
    `- Call \`configure\` once with:`,
    `  - \`set\`: a map of every variable the user gave a value for (booleans as "true"/"false").`,
    `  - \`declined\`: every OPTIONAL variable the user explicitly skipped (so a later sync won't re-ask it). Don't list variables you never brought up.`,
    `- Then relay \`configure\`'s summary and remind the user to **restart the MCP server / Claude Code** so okffs re-reads .env.`,
    ``,
    `## 5. Notes`,
    `- Booleans that default on (inference/metadata) should stay on unless the user wants them off.`,
    `- If the user wants \`OKFFS_AUTO_MERGE_BASE=true\`, confirm \`OKFFS_PROTECTED_BRANCH\` is also set — the merge tool refuses without it.`,
    `- The Projects and promotion sections only matter if the user uses a GitHub Projects board / a protected-branch promotion flow; it's fine to skip them.`,
    ``,
    `## Variable reference`,
    renderReference(),
  ].join("\n");

  return {
    description: "Configure okffs for this repo conversationally, then persist via the configure tool",
    messages: [
      {
        role: "user" as const,
        content: { type: "text" as const, text },
      },
    ],
  };
}
