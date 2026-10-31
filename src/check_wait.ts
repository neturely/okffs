// Bounded wait for a PR's checks to settle (#347). Pure over an injected
// fetcher/sleep/clock so the loop is unit-tested without GitHub. Deliberately
// bounded: an MCP call must not block for minutes, so a check still running at
// the deadline is reported as "pending — retry", never waited out.

import type { CombinedStatus, CheckRunsResult } from "./github.js";

export const DEFAULT_WAIT_SECONDS = 90;
export const MAX_WAIT_SECONDS = 180;
export const POLL_INTERVAL_MS = 10_000;
/**
 * Right after a PR opens, GitHub may not have registered any check yet (#351):
 * "zero checks" only counts as green once this long has passed without one
 * appearing, so a fresh PR can't merge before its CI starts. Repos with no CI
 * still pass, just this much later.
 */
export const NO_CHECKS_GRACE_MS = 20_000;

const GREEN_CONCLUSIONS = ["success", "neutral", "skipped"];

export interface CheckClassification {
  failed: string[];
  pending: string[];
}

/** Split non-green statuses/check runs into failed (settled red) and pending. Pure. */
export function classifyChecks(combined: CombinedStatus, checks: CheckRunsResult): CheckClassification {
  const failed: string[] = [];
  const pending: string[] = [];
  for (const s of combined.statuses) {
    if (s.state === "success") continue;
    (s.state === "pending" ? pending : failed).push(`${s.context} (${s.state})`);
  }
  for (const c of checks.check_runs) {
    if (c.status !== "completed") pending.push(`${c.name} (${c.status})`);
    else if (!GREEN_CONCLUSIONS.includes(c.conclusion ?? "")) failed.push(`${c.name} (${c.conclusion})`);
  }
  return { failed, pending };
}

/** Clamp a requested wait to [0, MAX_WAIT_SECONDS], defaulting when absent. Pure. */
export function clampWaitSeconds(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) return DEFAULT_WAIT_SECONDS;
  return Math.min(Math.max(0, Math.floor(requested)), MAX_WAIT_SECONDS);
}

export type WaitOutcome =
  | { state: "green"; waitedMs: number }
  | { state: "failed"; failed: string[]; pending: string[]; waitedMs: number }
  | { state: "pending"; pending: string[]; waitedMs: number };

export interface WaitDeps {
  fetch: () => Promise<{ combined: CombinedStatus; checks: CheckRunsResult }>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  intervalMs?: number;
  noChecksGraceMs?: number;
}

/**
 * Poll until every check is green, any check settles red (fail fast), or the
 * deadline passes. Never sleeps past the deadline.
 */
export async function waitForChecks(timeoutSeconds: number, deps: WaitDeps): Promise<WaitOutcome> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now ?? Date.now;
  const interval = deps.intervalMs ?? POLL_INTERVAL_MS;
  const grace = deps.noChecksGraceMs ?? NO_CHECKS_GRACE_MS;
  const start = now();
  const deadline = start + timeoutSeconds * 1000;
  for (;;) {
    const { combined, checks } = await deps.fetch();
    const { failed, pending } = classifyChecks(combined, checks);
    const waitedMs = now() - start;
    if (failed.length > 0) return { state: "failed", failed, pending, waitedMs };
    const none = combined.statuses.length + checks.check_runs.length === 0;
    // Zero checks within the grace window: CI may simply not have registered
    // yet, so treat it as pending rather than green.
    const awaitingRegistration = none && waitedMs < grace;
    if (pending.length === 0 && !awaitingRegistration) return { state: "green", waitedMs };
    const stillPending = awaitingRegistration ? ["(no checks registered yet)"] : pending;
    const remaining = deadline - now();
    if (remaining <= 0) return { state: "pending", pending: stillPending, waitedMs };
    await sleep(Math.min(interval, remaining, awaitingRegistration ? grace - waitedMs : interval));
  }
}

/** Actionable text for a non-green wait outcome. Pure. */
export function waitRefusal(label: string, outcome: Exclude<WaitOutcome, { state: "green" }>, retryHint: string): string {
  const secs = Math.round(outcome.waitedMs / 1000);
  if (outcome.state === "failed") {
    const still = outcome.pending.length > 0 ? ` (still running: ${outcome.pending.join(", ")})` : "";
    return `[okffs] Refusing to merge ${label}: check(s) failed — ${outcome.failed.join(", ")}${still}. Run get_pr_checks for the failing job's log tail, fix, then retry.`;
  }
  return `⏳ ${label}: checks still pending after waiting ${secs}s — ${outcome.pending.join(", ")}. Nothing merged; ${retryHint}`;
}
