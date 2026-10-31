import { test } from "node:test";
import assert from "node:assert/strict";
import { changeTypeFor, changeTypeFromTitle } from "./change_type.js";

test("issue Type and labels win over title keywords", () => {
  // The 0.14.0 cases that came out as Changed from the title alone.
  assert.equal(changeTypeFor({ issueType: "Feature", title: "get_pr_checks: report a PR's check runs" }), "Added");
  assert.equal(changeTypeFor({ issueType: "Bug", title: "wait_for_checks: grace period when no checks are registered yet" }), "Fixed");
  assert.equal(changeTypeFor({ labels: [{ name: "bug" }], title: "grace period" }), "Fixed");
  assert.equal(changeTypeFor({ labels: ["enhancement"], title: "merge_pull_request: wait_for_checks option" }), "Added");
  // A feature whose title says "fix" is still Added; a security label beats both.
  assert.equal(changeTypeFor({ issueType: "Feature", title: "fix up the release flow" }), "Added");
  assert.equal(changeTypeFor({ issueType: "Bug", labels: [{ name: "Security" }], title: "x" }), "Security");
});

test("falls back to title keywords for Task/unknown types", () => {
  assert.equal(changeTypeFor({ issueType: "Task", labels: ["okffs"], title: "CI: run npm test on pull requests" }), "Changed");
  assert.equal(changeTypeFor({ issueType: null, title: "Remove the legacy alias" }), "Removed");
  assert.equal(changeTypeFor({ title: "Fix crash on empty body" }), "Fixed");
});

test("changeTypeFromTitle keeps the original heuristic", () => {
  assert.equal(changeTypeFromTitle("Add hero section"), "Added");
  assert.equal(changeTypeFromTitle("Patch CVE-2026-1"), "Security");
  assert.equal(changeTypeFromTitle("Rename a thing"), "Changed");
});
