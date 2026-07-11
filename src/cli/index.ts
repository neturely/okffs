#!/usr/bin/env node
// okffs command-line entrypoint. Dispatches subcommands (currently `setup`) and
// is deliberately structured so `login` (Tier 3 OAuth Device Flow) and a future
// `status` slot in without reworking the dispatcher.
//
// Reachable two ways:
//   npx @neturely/okffs setup   → the package's single `okffs` bin is dist/index.js
//                                  (the MCP server), which forwards CLI argv here.
//   node dist/cli/index.js setup → this file run directly (local dev).
import "dotenv/config";
import { pathToFileURL } from "node:url";

import { runSetup } from "./setup.js";
import { packageVersion } from "./banner.js";

/** Subcommands that route to the CLI rather than the MCP server. */
export const SUBCOMMANDS = new Set(["setup", "login"]);
const HELP_FLAGS = new Set(["help", "--help", "-h"]);
const VERSION_FLAGS = new Set(["--version", "-v"]);

/**
 * Whether argv[2..] should be handled as a CLI invocation rather than starting
 * the stdio MCP server. MCP hosts launch the server with no extra args, so a
 * bare invocation always falls through to the server.
 */
export function isCliInvocation(args: string[]): boolean {
  const first = args[0];
  if (!first) return false;
  return SUBCOMMANDS.has(first) || HELP_FLAGS.has(first) || VERSION_FLAGS.has(first);
}

export async function runCli(args: string[]): Promise<number> {
  const [sub, ...rest] = args;

  if (VERSION_FLAGS.has(sub)) {
    console.log(packageVersion());
    return 0;
  }
  if (!sub || HELP_FLAGS.has(sub)) {
    printHelp();
    return sub ? 0 : 1;
  }

  switch (sub) {
    case "setup":
      return runSetup(rest);
    case "login":
      console.error(
        "`okffs login` (OAuth Device Flow) isn't implemented yet.\n" +
          "For now, configure a GITHUB_TOKEN (or sign in with `gh auth login`) via `okffs setup`."
      );
      return 1;
    default:
      console.error(`Unknown command: ${sub}\n`);
      printHelp();
      return 1;
  }
}

function printHelp(): void {
  console.log(
    [
      `okffs v${packageVersion()} — GitHub issue → branch → PR → merge workflow for Claude Code`,
      "",
      "Usage:",
      "  npx @neturely/okffs <command>",
      "",
      "Commands:",
      "  setup            Interactive wizard to create/update .env (run in a repo)",
      "  login            (coming soon) OAuth Device Flow sign-in",
      "",
      "Flags:",
      "  -h, --help       Show this help",
      "  -v, --version    Print the okffs version",
      "",
      "With no command, okffs runs as an MCP server over stdio (how Claude Code launches it).",
    ].join("\n")
  );
}

// Run directly: `node dist/cli/index.js <args>`.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  );
}
