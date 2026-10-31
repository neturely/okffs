import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyChecks, clampWaitSeconds, waitForChecks, waitRefusal, DEFAULT_WAIT_SECONDS, MAX_WAIT_SECONDS } from "./check_wait.js";

const run = (name: string, status: string, conclusion: string | null = null) => ({ name, status, conclusion });
const snap = (runs: ReturnType<typeof run>[], statuses: Array<{ state: string; context: string }> = []) => ({
  combined: { state: "pending" as const, statuses },
  checks: { total_count: runs.length, check_runs: runs },
});

test("classifyChecks separates settled-red from still-running", () => {
  const s = snap(
    [run("ok", "completed", "success"), run("audit", "in_progress"), run("bad", "completed", "failure"), run("skip", "completed", "skipped")],
    [{ state: "pending", context: "ci/a" }, { state: "error", context: "ci/b" }, { state: "success", context: "ci/c" }]
  );
  assert.deepEqual(classifyChecks(s.combined, s.checks), {
    failed: ["ci/b (error)", "bad (failure)"],
    pending: ["ci/a (pending)", "audit (in_progress)"],
  });
});

test("clampWaitSeconds defaults and caps", () => {
  assert.equal(clampWaitSeconds(undefined), DEFAULT_WAIT_SECONDS);
  assert.equal(clampWaitSeconds(30), 30);
  assert.equal(clampWaitSeconds(9999), MAX_WAIT_SECONDS);
  assert.equal(clampWaitSeconds(-5), 0);
});

function fakeClock() {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => { t += ms; }, slept: () => t };
}

test("waitForChecks returns green once pending checks pass", async () => {
  const clock = fakeClock();
  const seq = [snap([run("audit", "queued")]), snap([run("audit", "in_progress")]), snap([run("audit", "completed", "success")])];
  let i = 0;
  const out = await waitForChecks(90, { fetch: async () => seq[Math.min(i++, seq.length - 1)], ...clock, intervalMs: 10_000 });
  assert.equal(out.state, "green");
  assert.equal(clock.slept(), 20_000);
});

test("waitForChecks fails fast on a red check even while others run", async () => {
  const clock = fakeClock();
  const out = await waitForChecks(90, { fetch: async () => snap([run("audit", "completed", "failure"), run("review", "in_progress")]), ...clock });
  assert.equal(out.state, "failed");
  assert.equal(clock.slept(), 0);
  if (out.state === "failed") assert.deepEqual(out.pending, ["review (in_progress)"]);
});

test("waitForChecks gives up at the deadline without oversleeping", async () => {
  const clock = fakeClock();
  const out = await waitForChecks(25, { fetch: async () => snap([run("review", "in_progress")]), ...clock, intervalMs: 10_000 });
  assert.equal(out.state, "pending");
  assert.equal(clock.slept(), 25_000);
});

test("waitForChecks with zero timeout checks once", async () => {
  const clock = fakeClock();
  let calls = 0;
  const out = await waitForChecks(0, { fetch: async () => { calls++; return snap([run("x", "queued")]); }, ...clock });
  assert.equal(out.state, "pending");
  assert.equal(calls, 1);
});

test("waitRefusal renders failed and pending outcomes", () => {
  assert.match(waitRefusal("PR #1", { state: "failed", failed: ["audit (failure)"], pending: [], waitedMs: 0 }, "retry"), /check\(s\) failed — audit \(failure\)/);
  const p = waitRefusal("PR #1", { state: "pending", pending: ["review (in_progress)"], waitedMs: 90_000 }, "retry later.");
  assert.match(p, /still pending after waiting 90s — review \(in_progress\)\. Nothing merged; retry later\./);
});
