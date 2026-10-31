// Pure rendering for get_pr_checks (#348): a PR head's statuses + check runs
// with their states, and the trimmed tail of each failed Actions job's log.

import type { CombinedStatus, CheckRunsResult } from "./github.js";
import { classifyChecks } from "./check_wait.js";

export const LOG_TAIL_LINES = 50;

type CheckRun = CheckRunsResult["check_runs"][number];

const GREEN = ["success", "neutral", "skipped"];

/** A check run that settled red. Pure. */
export function isFailedRun(c: CheckRun): boolean {
  return c.status === "completed" && !GREEN.includes(c.conclusion ?? "");
}

/** Failed runs whose log can be fetched from the Actions jobs API. Pure. */
export function failedActionsRuns(checks: CheckRunsResult): CheckRun[] {
  return checks.check_runs.filter((c) => isFailedRun(c) && c.app?.slug === "github-actions" && typeof c.id === "number");
}

// Actions log lines are prefixed `2026-10-31T10:00:00.1234567Z `; ANSI colour
// codes are common too. Both are noise in a chat tail.
const TIMESTAMP = /^\uFEFF?\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z ?/;
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g;

/**
 * The `n` log lines that explain a failure, timestamps/ANSI stripped. A job log
 * ends with post-job cleanup (checkout teardown, orphan processes, runner
 * warnings), so the window ends at the LAST `##[error]` line when there is one;
 * otherwise it is the plain tail. Pure.
 */
export function logTail(raw: string, n = LOG_TAIL_LINES): string[] {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.replace(TIMESTAMP, "").replace(ANSI, "").trimEnd());
  let end = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].startsWith("##[error]")) {
      end = i + 1;
      break;
    }
  }
  const window = lines.slice(0, end);
  while (window.length > 0 && window[window.length - 1] === "") window.pop();
  return window.slice(-n);
}

const icon = (state: "green" | "failed" | "pending") => (state === "green" ? "✅" : state === "failed" ? "❌" : "⏳");

function runState(c: CheckRun): "green" | "failed" | "pending" {
  if (c.status !== "completed") return "pending";
  return isFailedRun(c) ? "failed" : "green";
}

function statusState(state: string): "green" | "failed" | "pending" {
  return state === "success" ? "green" : state === "pending" ? "pending" : "failed";
}

/**
 * Render the full report. `logs` maps a failed run's id to its log tail lines,
 * or to an error string when the log couldn't be fetched. Pure.
 */
export function renderChecksReport(
  header: string,
  combined: CombinedStatus,
  checks: CheckRunsResult,
  logs: Map<number, string[] | string>
): string {
  const { failed, pending } = classifyChecks(combined, checks);
  const total = combined.statuses.length + checks.check_runs.length;
  const verdict =
    total === 0
      ? "no checks reported"
      : failed.length > 0
        ? `${failed.length} failed, ${pending.length} pending`
        : pending.length > 0
          ? `${pending.length} pending, none failed`
          : "all green";
  const out = [`${header} — ${total} check(s): ${verdict}.`];

  for (const s of combined.statuses) {
    const st = statusState(s.state);
    out.push(`${icon(st)} ${s.context} — ${s.state}${s.description ? ` (${s.description})` : ""}${s.target_url ? ` ${s.target_url}` : ""}`);
  }
  for (const c of checks.check_runs) {
    const st = runState(c);
    out.push(`${icon(st)} ${c.name} — ${c.status === "completed" ? c.conclusion : c.status}${c.html_url ? ` ${c.html_url}` : ""}`);
  }

  for (const c of checks.check_runs) {
    if (c.id === undefined || !logs.has(c.id)) continue;
    const log = logs.get(c.id)!;
    if (typeof log === "string") {
      out.push("", `### ${c.name} — log unavailable`, log);
    } else {
      out.push("", `### ${c.name} — last ${log.length} log line(s)`, "```", ...log, "```");
    }
  }

  const otherFailed = checks.check_runs.filter((c) => isFailedRun(c) && c.app?.slug !== "github-actions");
  if (otherFailed.length > 0) {
    out.push("", `Not from GitHub Actions (no log fetched — follow the link): ${otherFailed.map((c) => c.name).join(", ")}.`);
  }
  return out.join("\n");
}
