import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeReleases, renderReleaseSection, renderReleaseNote } from "./release_summary.js";

test("summarizeReleases keeps only apps whose version changed between base and head", () => {
  const entries = summarizeReleases([
    { name: "finance", tagPrefix: "finance-", versionAtHead: "1.3.0", versionAtBase: "1.2.0" },
    { name: "health", tagPrefix: "health-", versionAtHead: "0.1.0", versionAtBase: null },
    { name: "root", tagPrefix: "root-", versionAtHead: "2.0.0", versionAtBase: "2.0.0" },
    { name: "empty", tagPrefix: "empty-", versionAtHead: null, versionAtBase: null },
  ]);
  assert.deepEqual(entries, [
    { app: "finance", from: "1.2.0", to: "1.3.0", tag: "finance-1.3.0" },
    { app: "health", from: null, to: "0.1.0", tag: "health-0.1.0" },
  ]);
});

test("single-site summary names the v tag", () => {
  const entries = summarizeReleases([{ name: null, tagPrefix: "v", versionAtHead: "0.13.0", versionAtBase: "0.12.0" }]);
  assert.deepEqual(entries, [{ app: null, from: "0.12.0", to: "0.13.0", tag: "v0.13.0" }]);
  assert.match(renderReleaseSection(entries) ?? "", /release: 0\.12\.0 → 0\.13\.0 — tag `v0\.13\.0` after merge/);
  assert.match(renderReleaseNote(entries, false) ?? "", /Tag after merge: `v0\.13\.0`/);
  assert.match(renderReleaseNote(entries, true) ?? "", /OKFFS_TAG_RELEASE will tag/);
});

test("no release → no section, no note", () => {
  const entries = summarizeReleases([{ name: "finance", tagPrefix: "finance-", versionAtHead: "1.2.0", versionAtBase: "1.2.0" }]);
  assert.deepEqual(entries, []);
  assert.equal(renderReleaseSection(entries), null);
  assert.equal(renderReleaseNote(entries, true), null);
});

test("first release renders as such", () => {
  const entries = summarizeReleases([{ name: "health", tagPrefix: "health-", versionAtHead: "0.1.0", versionAtBase: null }]);
  assert.match(renderReleaseSection(entries) ?? "", /\*\*health\*\*: 0\.1\.0 \(first release\)/);
});
