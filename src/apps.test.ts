import { test } from "node:test";
import assert from "node:assert/strict";
import { SINGLE_SITE, resolveApp, appDescriptor, tagName, releaseBranchName, isValidAppName } from "./apps.js";

test("resolveApp with no name is the single-site descriptor reproducing the pre-multisite layout", () => {
  const app = resolveApp();
  assert.equal(app, SINGLE_SITE);
  assert.deepEqual(app, {
    name: null,
    root: ".",
    tagPrefix: "v",
    changelogPath: "CHANGELOG.md",
    fragmentsDir: ".changes/unreleased",
    label: null,
  });
  assert.equal(tagName(app, "0.12.0"), "v0.12.0");
  assert.equal(releaseBranchName(app, "0.12.0"), "release/0.12.0");
});

test("resolveApp treats null/empty name as single-site", () => {
  assert.equal(resolveApp({ name: null }), SINGLE_SITE);
  assert.equal(resolveApp({ name: "" }), SINGLE_SITE);
});

test("an app descriptor gets a name-prefixed tag (no v), release branch and label", () => {
  const app = appDescriptor("finance");
  assert.equal(app.root, ".");
  assert.equal(app.label, "finance");
  assert.equal(app.changelogPath, "CHANGELOG.md");
  assert.equal(app.fragmentsDir, ".changes/unreleased");
  assert.equal(tagName(app, "1.2.0"), "finance-1.2.0");
  assert.equal(releaseBranchName(app, "1.2.0"), "release/finance-1.2.0");
  assert.equal(resolveApp({ name: "health", root: "health" }).root, "health");
});

test("app names are validated", () => {
  assert.equal(isValidAppName("finance"), true);
  assert.equal(isValidAppName("my-app2"), true);
  assert.equal(isValidAppName("Finance"), false);
  assert.equal(isValidAppName("fin ance"), false);
  assert.equal(isValidAppName("-x"), false);
  assert.throws(() => appDescriptor("Fin/ance"), /Invalid app name/);
});
