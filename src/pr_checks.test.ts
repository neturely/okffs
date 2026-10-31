import { test } from "node:test";
import assert from "node:assert/strict";
import { failedActionsRuns, logTail, renderChecksReport } from "./pr_checks.js";

const actions = { slug: "github-actions" };
const checks = {
  total_count: 4,
  check_runs: [
    { id: 1, name: "test", status: "completed", conclusion: "success", app: actions, html_url: "https://x/1" },
    { id: 2, name: "audit", status: "completed", conclusion: "failure", app: actions, html_url: "https://x/2" },
    { id: 3, name: "review", status: "in_progress", conclusion: null, app: actions },
    { id: 4, name: "codecov", status: "completed", conclusion: "failure", app: { slug: "codecov" } },
  ],
};
const combined = { state: "success" as const, statuses: [{ state: "success", context: "ci/legacy", target_url: "https://y" }] };

test("failedActionsRuns picks only red GitHub Actions runs", () => {
  assert.deepEqual(failedActionsRuns(checks).map((c) => c.name), ["audit"]);
});

test("logTail strips timestamps/ANSI and trailing blanks, keeps the last n", () => {
  const raw = [
    "﻿2026-10-31T10:00:00.1234567Z ##[group]Run npm audit",
    "2026-10-31T10:00:01.0000000Z \x1b[31mhigh\x1b[0m  Prototype pollution",
    "2026-10-31T10:00:02Z ##[error]Process completed with exit code 1.",
    "",
    "",
  ].join("\n");
  assert.deepEqual(logTail(raw), ["##[group]Run npm audit", "high  Prototype pollution", "##[error]Process completed with exit code 1."]);
  assert.deepEqual(logTail(raw, 1), ["##[error]Process completed with exit code 1."]);
});

test("logTail ends at the last ##[error], skipping post-job cleanup", () => {
  const raw = ["npm ERR! 2 vulnerabilities", "##[error]Process completed with exit code 1.", "Post job cleanup.", "Cleaning up orphan processes"].join("\n");
  assert.deepEqual(logTail(raw, 2), ["npm ERR! 2 vulnerabilities", "##[error]Process completed with exit code 1."]);
  assert.deepEqual(logTail("a\nb\nc", 2), ["b", "c"]);
});

test("renderChecksReport lists states, log tails, unavailable logs, and non-Actions failures", () => {
  const logs = new Map<number, string[] | string>([[2, ["npm ERR! audit", "exit 1"]]]);
  const out = renderChecksReport("PR #9", combined, checks, logs);
  assert.match(out, /^PR #9 — 5 check\(s\): 2 failed, 1 pending\./);
  assert.match(out, /✅ ci\/legacy — success https:\/\/y/);
  assert.match(out, /❌ audit — failure https:\/\/x\/2/);
  assert.match(out, /⏳ review — in_progress/);
  assert.match(out, /### audit — last 2 log line\(s\)\n```\nnpm ERR! audit\nexit 1\n```/);
  assert.match(out, /Not from GitHub Actions.*codecov/);

  const missing = renderChecksReport("PR #9", combined, checks, new Map([[2, "GitHub API error 403"]]));
  assert.match(missing, /### audit — log unavailable\nGitHub API error 403/);
});

test("renderChecksReport summarizes all-green and empty", () => {
  assert.match(renderChecksReport("PR #1", combined, { total_count: 0, check_runs: [] }, new Map()), /1 check\(s\): all green\./);
  assert.match(renderChecksReport("PR #1", { state: "success", statuses: [] }, { total_count: 0, check_runs: [] }, new Map()), /no checks reported/);
});
