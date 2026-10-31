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

// ── log matching (#362) ────────────────────────────────────────────────────
// Confirms a specific line made it into a run's log — e.g. a deploy job's
// migration line `[health] applied` — without the caller grepping raw logs.

export const MAX_LOG_MATCHES = 20;

/** Compile a caller-supplied pattern, or return the error text. Pure. */
export function compileLogMatch(pattern: string): RegExp | string {
  try {
    return new RegExp(pattern);
  } catch (err) {
    return `[okffs] log_match is not a valid regular expression: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/** Completed GitHub Actions runs whose log can be searched — skipped jobs never ran, so have none. Pure. */
export function completedActionsRuns(checks: CheckRunsResult): CheckRun[] {
  return checks.check_runs.filter(
    (c) => c.status === "completed" && c.conclusion !== "skipped" && c.app?.slug === "github-actions" && typeof c.id === "number"
  );
}

/** Log lines matching `re`, timestamps/ANSI stripped, at most `max`. Pure. */
export function matchLogLines(raw: string, re: RegExp, max = MAX_LOG_MATCHES): string[] {
  const out: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const clean = line.replace(TIMESTAMP, "").replace(ANSI, "").trimEnd();
    if (re.test(clean)) {
      out.push(clean);
      if (out.length >= max) break;
    }
  }
  return out;
}

/**
 * Render the log_match section. `matches` maps a searched run's id to its
 * matching lines, or to an error string when its log couldn't be fetched;
 * `notSearched` names runs still in progress. Pure.
 */
export function renderLogMatches(
  pattern: string,
  checks: CheckRunsResult,
  matches: Map<number, string[] | string>,
  notSearched: string[]
): string {
  const out = [`## log_match \`${pattern}\``];
  const found = [...matches.values()].some((m) => Array.isArray(m) && m.length > 0);
  for (const c of checks.check_runs) {
    if (c.id === undefined || !matches.has(c.id)) continue;
    const m = matches.get(c.id)!;
    if (typeof m === "string") out.push(`⚠️ ${c.name} — log unavailable: ${m}`);
    else if (m.length === 0) out.push(`➖ ${c.name} — no matching line`);
    else out.push(`✅ ${c.name} — ${m.length} matching line(s):`, "```", ...m, "```");
  }
  if (matches.size === 0) out.push("No completed GitHub Actions run to search.");
  if (notSearched.length > 0) out.push(`⏳ Not searched yet (still running): ${notSearched.join(", ")} — re-run with wait_for_checks: true.`);
  out.push(found ? "Verdict: matched." : "Verdict: NOT matched.");
  return out.join("\n");
}
