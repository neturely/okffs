import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { readVersionSource, writeVersionBump } from "./version_source.js";

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "okffs-vs-"));
}

test("package.json wins and package-lock.json is included only when present", () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "package.json"), '{\n  "name": "x",\n  "version": "1.2.3"\n}\n');
  fs.writeFileSync(path.join(dir, "VERSION"), "9.9.9\n"); // ignored when package.json exists
  let src = readVersionSource(dir);
  assert.equal(src.kind, "package.json");
  assert.equal(src.version, "1.2.3");
  assert.deepEqual(src.files, ["package.json"]);
  assert.equal(src.note, null);

  fs.writeFileSync(path.join(dir, "package-lock.json"), '{\n  "version": "1.2.3",\n  "packages": { "": { "version": "1.2.3" } }\n}\n');
  src = readVersionSource(dir);
  assert.deepEqual(src.files, ["package.json", "package-lock.json"]);

  const written = writeVersionBump(dir, src, "1.2.3", "1.3.0");
  assert.deepEqual(written, ["package.json", "package-lock.json"]);
  assert.match(fs.readFileSync(path.join(dir, "package.json"), "utf8"), /"version": "1.3.0"/);
  const lock = fs.readFileSync(path.join(dir, "package-lock.json"), "utf8");
  assert.equal(lock.split('"version": "1.3.0"').length - 1, 2);
  assert.equal(fs.readFileSync(path.join(dir, "VERSION"), "utf8"), "9.9.9\n"); // untouched
});

test("VERSION file is the fallback, with a note", () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "VERSION"), "0.4.1\n");
  const src = readVersionSource(dir);
  assert.equal(src.kind, "VERSION");
  assert.equal(src.version, "0.4.1");
  assert.deepEqual(src.files, ["VERSION"]);
  assert.match(src.note ?? "", /No package.json/);
  assert.deepEqual(writeVersionBump(dir, src, "0.4.1", "0.5.0"), ["VERSION"]);
  assert.equal(fs.readFileSync(path.join(dir, "VERSION"), "utf8"), "0.5.0\n");
});

test("a malformed VERSION file is rejected", () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "VERSION"), "v1.0\n");
  assert.throws(() => readVersionSource(dir), /plain X\.Y\.Z/);
});

test("no source at all → kind none from 0.0.0, and the bump creates VERSION", () => {
  const dir = tmp();
  const src = readVersionSource(dir);
  assert.equal(src.kind, "none");
  assert.equal(src.version, "0.0.0");
  assert.match(src.note ?? "", /will be created/);
  assert.deepEqual(writeVersionBump(dir, src, "0.0.0", "0.1.0"), ["VERSION"]);
  assert.equal(fs.readFileSync(path.join(dir, "VERSION"), "utf8"), "0.1.0\n");
});

test("a package.json bump validates before writing anything", () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "package.json"), '{ "version": "1.0.0" }');
  fs.writeFileSync(path.join(dir, "package-lock.json"), '{ "version": "1.0.0" }'); // only one occurrence → invalid
  const src = readVersionSource(dir);
  assert.throws(() => writeVersionBump(dir, src, "1.0.0", "1.0.1"), /package-lock\.json/);
  assert.match(fs.readFileSync(path.join(dir, "package.json"), "utf8"), /1\.0\.0/); // untouched
});
