import { test } from "node:test";
import assert from "node:assert/strict";
import { versionFromFiles, decideTags, renderTagReport } from "./tagging.js";

const ctx = (over: Partial<{ mergeCommitSha: string; protectedTipSha: string; existingTags: Map<string, string> }> = {}) => ({
  mergeCommitSha: "aaaaaaa1",
  protectedTipSha: "aaaaaaa1",
  existingTags: new Map<string, string>(),
  ...over,
});

test("versionFromFiles prefers package.json, falls back to VERSION, rejects junk", () => {
  assert.equal(versionFromFiles({ packageJson: '{"version":"1.2.3"}', versionFile: "9.9.9\n" }), "1.2.3");
  assert.equal(versionFromFiles({ packageJson: "not json", versionFile: "0.4.0\n" }), "0.4.0");
  assert.equal(versionFromFiles({ versionFile: "v1.0\n" }), null);
  assert.equal(versionFromFiles({}), null);
});

test("single-site: tag v-version when the promotion changed it", () => {
  const [d] = decideTags([{ name: null, tagPrefix: "v", versionAtMerge: "0.13.0", versionAtParent: "0.12.0" }], ctx());
  assert.deepEqual(d, { action: "tag", tag: "v0.13.0", sha: "aaaaaaa1", app: null });
});

test("unchanged version and missing version file are silent skips", () => {
  const ds = decideTags(
    [
      { name: "finance", tagPrefix: "finance-", versionAtMerge: "1.2.0", versionAtParent: "1.2.0" },
      { name: "health", tagPrefix: "health-", versionAtMerge: null, versionAtParent: null },
    ],
    ctx()
  );
  assert.ok(ds.every((d) => d.action === "skip" && d.silent));
  assert.equal(renderTagReport(7, ds), null);
});

test("multi-app: only the apps released in this promotion get tagged; first release counts", () => {
  const ds = decideTags(
    [
      { name: "finance", tagPrefix: "finance-", versionAtMerge: "1.3.0", versionAtParent: "1.2.0" },
      { name: "health", tagPrefix: "health-", versionAtMerge: "0.1.0", versionAtParent: null },
      { name: "root", tagPrefix: "root-", versionAtMerge: "2.0.0", versionAtParent: "2.0.0" },
    ],
    ctx()
  );
  assert.deepEqual(ds.map((d) => d.action), ["tag", "tag", "skip"]);
  assert.equal((ds[1] as { tag: string }).tag, "health-0.1.0");
});

test("already tagged at the merge commit is idempotent; tagged elsewhere is a loud skip", () => {
  const probe = { name: null, tagPrefix: "v", versionAtMerge: "0.13.0", versionAtParent: "0.12.0" };
  const [same] = decideTags([probe], ctx({ existingTags: new Map([["v0.13.0", "aaaaaaa1"]]) }));
  assert.equal(same.action, "already");
  const [other] = decideTags([probe], ctx({ existingTags: new Map([["v0.13.0", "bbbbbbb2"]]) }));
  assert.equal(other.action, "skip");
  assert.equal((other as { silent: boolean }).silent, false);
  assert.match(renderTagReport(7, [other]) ?? "", /already exists on bbbbbbb/);
});

test("a moved protected tip blocks tagging with an actionable reason", () => {
  const [d] = decideTags([{ name: null, tagPrefix: "v", versionAtMerge: "0.13.0", versionAtParent: "0.12.0" }], ctx({ protectedTipSha: "ccccccc3" }));
  assert.equal(d.action, "skip");
  assert.match((d as { reason: string }).reason, /moved past/);
});

test("renderTagReport reports creations, idempotent hits and failures", () => {
  const ds = decideTags(
    [
      { name: "finance", tagPrefix: "finance-", versionAtMerge: "1.3.0", versionAtParent: "1.2.0" },
      { name: "health", tagPrefix: "health-", versionAtMerge: "0.1.0", versionAtParent: null },
    ],
    ctx()
  );
  const out = renderTagReport(9, ds, [{ tag: "health-0.1.0", error: "boom" }]) ?? "";
  assert.match(out, /Tagged finance-1\.3\.0/);
  assert.match(out, /Could not create tag health-0\.1\.0: boom/);
});
