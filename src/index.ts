#!/usr/bin/env node
// okffs entrypoint (the package's single `okffs` bin).
//
// With no arguments it runs as an MCP server over stdio — how Claude Code and
// other MCP hosts launch it. With a CLI subcommand (`setup`, `login`, `--help`,
// `--version`) it dispatches to the CLI instead.
//
// The server is loaded via a DYNAMIC import so the CLI path never pulls in the
// tool chain (→ github.ts), which resolves the token/owner/repo at import time
// and throws when unconfigured — precisely the state `okffs setup` runs in.
import "dotenv/config";

import { isCliInvocation, runCli } from "./cli/index.js";

const args = process.argv.slice(2);

if (isCliInvocation(args)) {
  const code = await runCli(args);
  process.exit(code);
} else {
  const { startServer } = await import("./server.js");
  await startServer();
}
