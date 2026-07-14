// Autopilot ("minimum interference") — #238.
//
// The mode itself is behavioural: okffs can't suppress the host LLM's questions,
// so the load-bearing piece is the always-on guidance in SERVER_INSTRUCTIONS
// (src/server.ts), which tells the agent to take the recommended option at each
// reversible fork, honour the hard stops, and report the decisions. This module
// is the small amount of *plumbing* okffs owns: knowing whether the env default
// is on, and rendering the decisions report into a PR body / issue comment in a
// consistent shape (the host LLM supplies the content — the decisions — the same
// way it supplies triage/fixes for address_pr_review).

import { config } from "./config.js";

/**
 * Whether minimum-interference mode is on by env default (OKFFS_AUTOPILOT=true).
 * Per-request activation ("fully handle this") is behavioural and not visible
 * here — this only reflects the persistent default.
 */
export function autopilotEnabled(): boolean {
  return config.autopilot;
}

/**
 * Render the "Autopilot decisions" report block — one line per fork, each already
 * phrased by the agent as *what was chosen* + *one-line why*. Returns null when
 * there is nothing to report so callers omit the section cleanly rather than
 * emitting an empty heading. Blank/whitespace-only entries are dropped. #238.
 */
export function renderAutopilotDecisions(decisions?: string[] | null): string | null {
  const items = (decisions ?? []).map((d) => d.trim()).filter(Boolean);
  if (items.length === 0) return null;
  return ["## 🤖 Autopilot decisions", ...items.map((d) => `- ${d}`)].join("\n");
}

/** Shared schema description for the `autopilot_decisions` tool parameter. */
export const AUTOPILOT_DECISIONS_DESCRIPTION =
  "Autopilot decisions report — when driving this issue in minimum-interference " +
  "(autopilot) mode, pass one entry per reversible fork you decided without asking, " +
  "each phrased as 'what you chose — one-line why'. okffs renders them as an " +
  "'Autopilot decisions' block in the PR body and the issue comment so the user has " +
  "an audit trail to redirect in a single message. Omit when not in autopilot.";
