import { z } from "zod";
import { join } from "node:path";

import { allKeys, findVar } from "../cli/manifest.js";
import { parseEnv, serializeEnv, writeEnv, type Collected } from "../cli/env.js";
import { packageVersion } from "../cli/banner.js";

export const name = "configure";

export const description =
  "Persist okffs configuration to the .env file in the current working directory — the write backend for the /okffs:setup conversational wizard. " +
  "Reuses the same manifest + serializer as the `okffs setup` CLI, so both paths produce identical files: okffs owns ONLY a marked block, and the user's own variables and comments outside it are preserved verbatim. " +
  "Pass `set` (a map of okffs env var → value) for variables to configure, and/or `declined` (a list of keys) for variables the user explicitly chose to skip (written as commented placeholders so a later sync won't re-ask them). " +
  "Existing configured values that you don't pass are left untouched. Keys are validated against the manifest — unknown keys are rejected. " +
  "Typically called by the /okffs:setup prompt after interviewing the user; not usually called directly. Secrets (GITHUB_TOKEN) are masked in the response.";

export const inputSchema = z.object({
  set: z
    .record(z.string())
    .optional()
    .describe("Map of okffs env var name → value to set, e.g. { OKFFS_BASE_BRANCH: \"develop\", OKFFS_AUTO_PR: \"true\" }. Booleans are the strings \"true\"/\"false\"."),
  declined: z
    .array(z.string())
    .optional()
    .describe("Env var names the user explicitly declined — written as `# KEY=` placeholders so sync mode treats them as asked-and-declined, not new."),
});

const SECRET_KEYS = new Set(["GITHUB_TOKEN"]);

function mask(v: string): string {
  if (v.length <= 8) return "•".repeat(v.length);
  return `${v.slice(0, 4)}${"•".repeat(6)}${v.slice(-4)}`;
}

export async function handler(input: z.infer<typeof inputSchema>) {
  const set = input.set ?? {};
  const declined = input.declined ?? [];

  // Validate every provided key against the manifest before touching the file.
  const known = new Set(allKeys());
  const unknown = [...Object.keys(set), ...declined].filter((k) => !known.has(k));
  if (unknown.length > 0) {
    return {
      content: [
        {
          type: "text" as const,
          text:
            `[okffs] Unknown config key(s): ${unknown.join(", ")}. ` +
            `configure only accepts okffs manifest variables (GITHUB_* / OKFFS_*). No changes were written.`,
        },
      ],
      isError: true,
    };
  }

  const envPath = join(process.cwd(), ".env");
  const parsed = parseEnv(envPath);

  // Seed from the existing file so untouched vars are preserved, then apply the
  // caller's changes on top.
  const collected: Collected = {};
  for (const key of parsed.known) {
    const val = parsed.values[key];
    collected[key] = val !== undefined && val !== "" ? { state: "set", value: val } : { state: "declined", value: "" };
  }
  for (const [key, value] of Object.entries(set)) collected[key] = { state: "set", value };
  for (const key of declined) collected[key] = { state: "declined", value: "" };

  const contents = serializeEnv(collected, parsed.preamble, parsed.postamble, packageVersion());
  writeEnv(envPath, contents);

  // Build a human-readable summary (masking secrets).
  const setLines = Object.entries(set).map(([k, v]) => `  ${k}=${SECRET_KEYS.has(k) ? mask(v) : v}`);
  const declinedLine = declined.length ? `  declined (left unset): ${declined.join(", ")}` : "";
  const summary = [
    `Wrote ${envPath} (okffs v${packageVersion()}).`,
    parsed.exists ? "Updated the okffs-managed block; your other variables and comments were preserved." : "Created a new .env with the okffs-managed block.",
    setLines.length ? `Set ${setLines.length} variable(s):` : "",
    ...setLines,
    declinedLine,
    "",
    "Reminder: restart the MCP server (or Claude Code) so okffs re-reads .env.",
  ]
    .filter(Boolean)
    .join("\n");

  return { content: [{ type: "text" as const, text: summary }] };
}
