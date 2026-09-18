import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeabilityRefusal, outstandingChecks, pendingReviewers, unresolvedThreadCount } from "./pr_gates.js";

const pr = (over: Record<string, unknown> = {}) => ({
  number: 5,
  state: "open",
  draft: false,
  merged: false,
  mergeable: true,
  mergeable_state: "clean",
  head: { sha: "abc", ref: "develop" },
  base: { ref: "main" },
  ...over,
});

test("mergeabilityRefusal accepts a clean open PR and refuses each bad state", () => {
  assert.equal(mergeabilityRefusal(pr(), "main"), null);
  assert.match(mergeabilityRefusal(pr({ merged: true }), "main") ?? "", /already merged/);
  assert.match(mergeabilityRefusal(pr({ state: "closed" }), "main") ?? "", /closed, not open/);
  assert.match(mergeabilityRefusal(pr({ draft: true }), "main") ?? "", /still a draft/);
  assert.match(mergeabilityRefusal(pr({ mergeable: false }), "main") ?? "", /merge conflicts with `main`/);
  assert.match(mergeabilityRefusal(pr({ mergeable_state: "behind" }), "main") ?? "", /behind `main`/);
  assert.match(mergeabilityRefusal(pr({ mergeable_state: "blocked" }), "main") ?? "", /blocked by a required gate/);
  assert.match(mergeabilityRefusal(pr({ mergeable: null }), "main") ?? "", /hasn't finished computing/);
});

test("outstandingChecks lists failing/pending statuses and check runs only", () => {
  const combined = { state: "pending" as const, statuses: [{ state: "success", context: "ci/a" }, { state: "pending", context: "ci/b" }] };
  const checks = {
    total_count: 3,
    check_runs: [
      { name: "test", status: "completed", conclusion: "success" },
      { name: "lint", status: "in_progress", conclusion: null },
      { name: "skip", status: "completed", conclusion: "skipped" },
      { name: "bad", status: "completed", conclusion: "failure" },
    ],
  };
  assert.deepEqual(outstandingChecks(combined, checks), ["ci/b (pending)", "lint (in_progress)", "bad (failure)"]);
  assert.deepEqual(outstandingChecks({ state: "success", statuses: [] }, { total_count: 0, check_runs: [] }), []);
});

test("pendingReviewers and unresolvedThreadCount", () => {
  assert.deepEqual(pendingReviewers(pr()), []);
  assert.deepEqual(pendingReviewers(pr({ requested_reviewers: [{ login: "copilot-pull-request-reviewer[bot]" }] })), ["copilot-pull-request-reviewer[bot]"]);
  assert.deepEqual(pendingReviewers(pr({ requested_teams: [{ slug: "release-owners" }] })), ["team:release-owners"]);
  const threads = [
    { id: "1", isResolved: false, comments: [{ id: 1, path: null, line: null, author: "a", body: "x" }] },
    { id: "2", isResolved: true, comments: [{ id: 2, path: null, line: null, author: "a", body: "y" }] },
    { id: "3", isResolved: false, comments: [] }, // empty thread doesn't count
  ];
  assert.equal(unresolvedThreadCount({ threads }), 1);
});
