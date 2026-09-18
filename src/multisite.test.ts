import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveIssueApp, multisiteWarnings } from "./multisite.js";

const single = { sessionApp: null, apps: [] as string[], explicitIdentifier: null };

test("single-site: no app, no label, identifier untouched", () => {
  assert.deepEqual(resolveIssueApp({ ...single }), { app: null, label: null, identifier: null, error: null });
  assert.deepEqual(resolveIssueApp({ ...single, explicitIdentifier: "okffs" }), { app: null, label: null, identifier: "okffs", error: null });
});

test("session app supplies label and identifier; explicit OKFFS_IDENTIFIER wins", () => {
  const r = resolveIssueApp({ sessionApp: "finance", apps: ["finance", "health"], explicitIdentifier: null });
  assert.deepEqual(r, { app: "finance", label: "finance", identifier: "finance", error: null });
  const r2 = resolveIssueApp({ sessionApp: "finance", apps: ["finance"], explicitIdentifier: "fin" });
  assert.equal(r2.identifier, "fin");
  assert.equal(r2.label, "finance");
});

test("per-call override beats the session app and is validated against the registry", () => {
  const ok = resolveIssueApp({ override: "Health", sessionApp: "finance", apps: ["finance", "health"], explicitIdentifier: null });
  assert.deepEqual(ok, { app: "health", label: "health", identifier: "health", error: null });
  const bad = resolveIssueApp({ override: "wealth", sessionApp: "finance", apps: ["finance", "health"], explicitIdentifier: null });
  assert.equal(bad.app, null);
  assert.match(bad.error ?? "", /not in OKFFS_APPS/);
  const shape = resolveIssueApp({ override: "fin ance", sessionApp: null, apps: [], explicitIdentifier: null });
  assert.match(shape.error ?? "", /not a valid app name/);
  // No registry → any well-formed override is accepted.
  assert.equal(resolveIssueApp({ override: "wealth", sessionApp: null, apps: [], explicitIdentifier: null }).label, "wealth");
});

test("multisite warnings are silent for single-site", () => {
  assert.deepEqual(multisiteWarnings({ app: null, apps: [], inAppDir: false, rootFragmentCount: 3 }), []);
  assert.deepEqual(multisiteWarnings({ app: null, apps: [], inAppDir: true, rootFragmentCount: 0 }), []);
});

test("multisite warnings: registry/app mismatches and orphaned root fragments", () => {
  assert.match(multisiteWarnings({ app: "finance", apps: [], inAppDir: true, rootFragmentCount: 0 }).join("\n"), /OKFFS_APPS .*is unset/);
  assert.match(multisiteWarnings({ app: "wealth", apps: ["finance"], inAppDir: true, rootFragmentCount: 0 }).join("\n"), /not listed in OKFFS_APPS/);
  const w = multisiteWarnings({ app: "finance", apps: ["finance", "health"], inAppDir: true, rootFragmentCount: 2 });
  assert.equal(w.length, 1);
  assert.match(w[0], /2 pending changelog fragment/);
  // Root fragments are not a hazard when releasing from the root itself.
  assert.deepEqual(multisiteWarnings({ app: "root", apps: ["root", "finance"], inAppDir: false, rootFragmentCount: 2 }), []);
  // Root session without OKFFS_APP while a registry exists → nudge.
  assert.match(multisiteWarnings({ app: null, apps: ["finance"], inAppDir: false, rootFragmentCount: 0 }).join("\n"), /root session has no OKFFS_APP/);
  // Clean app session → nothing.
  assert.deepEqual(multisiteWarnings({ app: "finance", apps: ["finance", "health"], inAppDir: true, rootFragmentCount: 0 }), []);
});

test("appFromLabels matches a registered app from label objects or strings", async () => {
  const { appFromLabels } = await import("./multisite.js");
  assert.equal(appFromLabels([{ name: "okffs" }, { name: "Finance" }], ["finance", "health"]), "finance");
  assert.equal(appFromLabels(["health"], ["finance", "health"]), "health");
  assert.equal(appFromLabels([{ name: "bug" }], ["finance"]), null);
  assert.equal(appFromLabels([{ name: "finance" }], []), null); // no registry → never marks
  assert.equal(appFromLabels(undefined, ["finance"]), null);
});
