import { test } from "node:test";
import assert from "node:assert/strict";
import { gitignoreCoversEnv, gitignoreAnchoredEnvOnly, appendEnvIgnore } from "./gitignore.js";

test("depth-agnostic .env rules count; anchored, negated or commented ones do not", () => {
  assert.equal(gitignoreCoversEnv("node_modules\n.env\n"), true);
  assert.equal(gitignoreCoversEnv("**/.env"), true);
  assert.equal(gitignoreCoversEnv("*.env"), true);
  assert.equal(gitignoreCoversEnv("/.env\n"), false);
  assert.equal(gitignoreCoversEnv("# .env\n"), false);
  assert.equal(gitignoreCoversEnv("!.env\n"), false);
  assert.equal(gitignoreCoversEnv(".env\n!.env\n"), false); // later negation re-includes it
  assert.equal(gitignoreCoversEnv(".env\n!finance/.env\n"), false);
  assert.equal(gitignoreCoversEnv("!.env\n.env\n"), true); // negation BEFORE the rule is overridden
  assert.equal(gitignoreCoversEnv(""), false);
  assert.equal(gitignoreAnchoredEnvOnly("/.env\n"), true);
  assert.equal(gitignoreAnchoredEnvOnly(".env\n"), false);
});

test("appendEnvIgnore is idempotent and keeps existing content", () => {
  const once = appendEnvIgnore("dist/\n");
  assert.match(once, /^dist\/\n\n# okffs: .*\n\.env\n$/);
  assert.equal(appendEnvIgnore(once), once);
  assert.equal(appendEnvIgnore(""), "# okffs: .env files hold tokens — ignored at every depth (root and app directories)\n.env\n");
  assert.equal(gitignoreCoversEnv(appendEnvIgnore("/.env\n")), true);
});
