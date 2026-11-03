import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SYNC_BACK_MERGE_METHOD,
  planSyncBack,
  syncBackTitle,
  syncBackBody,
  mergeCommitWarning,
  renderSyncBackMerged,
  isEmptyPromotion,
} from "./sync_back.js";

test("sync-back always merges with a merge commit", () => {
  assert.equal(SYNC_BACK_MERGE_METHOD, "merge");
});

test("planSyncBack: nothing ahead and no PR → none; ahead → open; open PR → reuse", () => {
  assert.equal(planSyncBack(0, false), "none");
  assert.equal(planSyncBack(1, false), "open");
  assert.equal(planSyncBack(3, true), "reuse");
  assert.equal(planSyncBack(0, true), "reuse");
});

test("title and body name both branches and carry no closing keyword", () => {
  assert.equal(syncBackTitle("main", "develop"), "Sync main → develop");
  const body = syncBackBody("main", "develop");
  assert.match(body, /merge commit/);
  assert.doesNotMatch(body, /\b(close[sd]?|fix(e[sd])?|resolve[sd]?) #\d/i);
});

test("mergeCommitWarning: 2 parents is fine, 1 is flagged", () => {
  assert.equal(mergeCommitWarning("e4f4468aaaa", ["9a432f0", "187766f"]), null);
  assert.match(mergeCommitWarning("e4f4468aaaa", ["9a432f0"]) ?? "", /1 parent\(s\), not 2/);
});

test("renderSyncBackMerged lists the merge commit and parents", () => {
  const ok = renderSyncBackMerged(1345, "main", "develop", "e4f4468abc", ["9a432f0abc", "187766fabc"]);
  assert.match(ok, /PR #1345 — merge commit e4f4468 \(parents 9a432f0, 187766f\)/);
  const bad = renderSyncBackMerged(1345, "main", "develop", "e4f4468abc", ["9a432f0abc"]);
  assert.match(bad, /not a true merge commit/);
});

test("isEmptyPromotion: no commits, or commits with no file changes", () => {
  assert.equal(isEmptyPromotion(0, 0), true);
  assert.equal(isEmptyPromotion(1, 0), true); // only a sync-back merge commit
  assert.equal(isEmptyPromotion(2, 5), false);
});
