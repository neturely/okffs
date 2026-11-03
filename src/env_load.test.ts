import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { findGitRoot, envFilesFor, loadEnv } from "./env_load.js";

function repo(): { root: string; site: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "okffs-env-"));
  fs.mkdirSync(path.join(root, ".git"));
  const site = path.join(root, "finance");
  fs.mkdirSync(site);
  return { root, site };
}

test("findGitRoot walks up to the enclosing repo and returns null outside one", () => {
  const { root, site } = repo();
  assert.equal(findGitRoot(site), root);
  assert.equal(findGitRoot(root), root);
  const nested = path.join(site, "a", "b");
  fs.mkdirSync(nested, { recursive: true });
  assert.equal(findGitRoot(nested), root);
  // A .git FILE (worktree/submodule) counts too.
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), "okffs-wt-"));
  fs.writeFileSync(path.join(wt, ".git"), "gitdir: /elsewhere\n");
  assert.equal(findGitRoot(wt), wt);
  const loose = fs.mkdtempSync(path.join(os.tmpdir(), "okffs-loose-"));
  assert.equal(findGitRoot(loose), null); // tmpdir is not inside a repo
});

test("single-site: cwd is the git root → exactly one .env, loaded once, identical to before", () => {
  const { root } = repo();
  assert.deepEqual(envFilesFor(root, root), [path.join(root, ".env")]);
  fs.writeFileSync(path.join(root, ".env"), "GITHUB_OWNER=acme\nOKFFS_BASE_BRANCH=develop\n");
  const target: NodeJS.ProcessEnv = { GITHUB_OWNER: "from-process" };
  const res = loadEnv(root, target);
  assert.deepEqual(res.loaded, [path.join(root, ".env")]);
  assert.equal(res.gitRoot, root);
  assert.equal(target.GITHUB_OWNER, "from-process"); // real env still wins, as with dotenv/config
  assert.equal(target.OKFFS_BASE_BRANCH, "develop");
});

test("outside a repo only the cwd .env is considered and nothing throws", () => {
  const loose = fs.mkdtempSync(path.join(os.tmpdir(), "okffs-loose-"));
  assert.deepEqual(envFilesFor(loose, null), [path.join(loose, ".env")]);
  const res = loadEnv(loose, {});
  assert.deepEqual(res, { loaded: [], gitRoot: null });
});

test("multisite: the site .env overlays the root .env, closer file wins", () => {
  const { root, site } = repo();
  assert.deepEqual(envFilesFor(site, root), [path.join(site, ".env"), path.join(root, ".env")]);
  fs.writeFileSync(path.join(root, ".env"), "GITHUB_TOKEN=shared-token\nOKFFS_IDENTIFIER=root\nOKFFS_PROJECT_ID=PVT_1\n");
  fs.writeFileSync(path.join(site, ".env"), "OKFFS_IDENTIFIER=finance\nOKFFS_APP=finance\n");
  const target: NodeJS.ProcessEnv = {};
  const res = loadEnv(site, target);
  assert.deepEqual(res.loaded, [path.join(site, ".env"), path.join(root, ".env")]);
  assert.equal(target.GITHUB_TOKEN, "shared-token"); // inherited
  assert.equal(target.OKFFS_PROJECT_ID, "PVT_1"); // inherited
  assert.equal(target.OKFFS_IDENTIFIER, "finance"); // overridden by the closer file
  assert.equal(target.OKFFS_APP, "finance");
});

test("a site without its own .env simply inherits the root", () => {
  const { root, site } = repo();
  fs.writeFileSync(path.join(root, ".env"), "OKFFS_BASE_BRANCH=develop\n");
  const target: NodeJS.ProcessEnv = {};
  const res = loadEnv(site, target);
  assert.deepEqual(res.loaded, [path.join(root, ".env")]);
  assert.equal(target.OKFFS_BASE_BRANCH, "develop");
});
