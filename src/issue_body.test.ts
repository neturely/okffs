import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveIssueBody,
  extractBranchFromBody,
  extractIssueMetadata,
  mergeIssueMetadata,
  parseRelationships,
} from "./issue_body.js";

test("body alone resolves cleanly", () => {
  assert.deepEqual(resolveIssueBody({ body: "text" }, "create_issue"), { ok: true, body: "text" });
});

test("a missing body is an actionable error that names the removed alias", () => {
  const res = resolveIssueBody({}, "create_issue");
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.match(res.error, /required/);
    assert.match(res.error, /`description` alias was removed/);
  }
});

// ── okffs-owned metadata extract/merge (#295) ───────────────────────────────

const BRANCH_LINE = "**Branch:** `42-okffs-fix-the-thing`";
const REL_SECTION = "## Relationships\n- Parent: #1\n- Blocked by #3";
const FULL_BODY = `Some description.\n\n${BRANCH_LINE}\n\n${REL_SECTION}`;

test("extractBranchFromBody reads the anchored metadata line", () => {
  assert.equal(extractBranchFromBody(FULL_BODY), "42-okffs-fix-the-thing");
  assert.equal(extractBranchFromBody(null), null);
  assert.equal(extractBranchFromBody("no metadata here"), null);
});

test("extractBranchFromBody ignores the pattern quoted mid-prose (issue #295's own body)", () => {
  const body = "- the **`**Branch:** `{branch}`** line written by create_issue\n\n" + BRANCH_LINE;
  assert.equal(extractBranchFromBody(body), "42-okffs-fix-the-thing");
  // Quoted mention only, no real line → no match at all.
  assert.equal(extractBranchFromBody("- the **`**Branch:** `{branch}`** line"), null);
});

test("extractIssueMetadata finds both blocks", () => {
  const meta = extractIssueMetadata(FULL_BODY);
  assert.equal(meta.branchLine, BRANCH_LINE);
  assert.equal(meta.relationshipsSection, REL_SECTION);
});

test("extractIssueMetadata handles absent blocks and null bodies", () => {
  assert.deepEqual(extractIssueMetadata(null), { branchLine: null, relationshipsSection: null });
  assert.deepEqual(extractIssueMetadata("plain body"), { branchLine: null, relationshipsSection: null });
});

test("extractIssueMetadata stops the Relationships section at the next heading", () => {
  const meta = extractIssueMetadata(`Intro\n\n${REL_SECTION}\n\n## Notes\nlater prose`);
  assert.equal(meta.relationshipsSection, REL_SECTION);
});

test("mergeIssueMetadata re-appends dropped blocks", () => {
  const merged = mergeIssueMetadata("Rewritten body.", extractIssueMetadata(FULL_BODY));
  assert.equal(merged.body, `Rewritten body.\n\n${BRANCH_LINE}\n\n${REL_SECTION}`);
  assert.deepEqual(merged.preserved, ["**Branch:** line", "## Relationships"]);
});

test("mergeIssueMetadata leaves blocks the new body already carries (no duplicates)", () => {
  const merged = mergeIssueMetadata(FULL_BODY, extractIssueMetadata(FULL_BODY));
  assert.equal(merged.body, FULL_BODY);
  assert.deepEqual(merged.preserved, []);
});

test("mergeIssueMetadata respects a caller-supplied Branch line pointing elsewhere", () => {
  const newBody = "New text.\n\n**Branch:** `42-okffs-renamed-branch`";
  const merged = mergeIssueMetadata(newBody, extractIssueMetadata(FULL_BODY));
  assert.equal(extractBranchFromBody(merged.body), "42-okffs-renamed-branch");
  assert.deepEqual(merged.preserved, ["## Relationships"]);
});

test("mergeIssueMetadata with no stored metadata returns the body unchanged", () => {
  const merged = mergeIssueMetadata("Anything.", extractIssueMetadata("old plain body"));
  assert.equal(merged.body, "Anything.");
  assert.deepEqual(merged.preserved, []);
});

// ── parseRelationships (#259) ───────────────────────────────────────────────

test("parseRelationships reads all three relationship kinds", () => {
  const rels = parseRelationships("Intro\n\n## Relationships\n- Parent: #1\n- Blocked by #3\n- Blocking #7\n- Blocked by #4");
  assert.deepEqual(rels, { parent: [1], blockedBy: [3, 4], blocking: [7] });
});

test("parseRelationships is case-insensitive and tolerates missing colon on Parent", () => {
  const rels = parseRelationships("## Relationships\n- parent #2\n- BLOCKED BY #9");
  assert.deepEqual(rels, { parent: [2], blockedBy: [9], blocking: [] });
});

test("parseRelationships stops at the next heading", () => {
  const rels = parseRelationships("## Relationships\n- Parent: #1\n\n## Notes\n- Blocking #99");
  assert.deepEqual(rels, { parent: [1], blockedBy: [], blocking: [] });
});

test("parseRelationships never throws on malformed or absent input", () => {
  assert.deepEqual(parseRelationships(null), { parent: [], blockedBy: [], blocking: [] });
  assert.deepEqual(parseRelationships("no section here"), { parent: [], blockedBy: [], blocking: [] });
  assert.deepEqual(parseRelationships("## Relationships\ngarbage line\n- Blocked by nothing"), {
    parent: [],
    blockedBy: [],
    blocking: [],
  });
});

import { inferIssueBranch, appendBranchLine } from "./issue_body.js";

test("inferIssueBranch: explicit wins, else only an {issue}-… checkout", () => {
  assert.equal(inferIssueBranch(42, "main", "feature-x"), "feature-x");
  assert.equal(inferIssueBranch(42, "42-add-hero"), "42-add-hero");
  assert.equal(inferIssueBranch(42, "421-other"), null);
  assert.equal(inferIssueBranch(42, "develop"), null);
  assert.equal(inferIssueBranch(42, null), null);
});

test("appendBranchLine appends after the body, or stands alone", () => {
  assert.equal(appendBranchLine("Body text\n\n", "42-x"), "Body text\n\n**Branch:** `42-x`");
  assert.equal(appendBranchLine(null, "42-x"), "**Branch:** `42-x`");
  assert.equal(extractBranchFromBody(appendBranchLine("Body", "42-x")), "42-x");
});
