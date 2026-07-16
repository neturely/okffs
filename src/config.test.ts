import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCommaList } from "./config.js";

// Regression coverage for #253: comma-list env vars must drop empty entries so a
// malformed-but-truthy value (trailing comma, whitespace) never emits a phantom
// "" that reaches the GitHub API as an invalid label/assignee.
test("parseCommaList drops empty entries", () => {
  // Unset / empty → [] (the supported "none" case).
  assert.deepEqual(parseCommaList(undefined), []);
  assert.deepEqual(parseCommaList(""), []);

  // Whitespace-only → [] (was [""] before the fix).
  assert.deepEqual(parseCommaList(" "), []);
  assert.deepEqual(parseCommaList(" , "), []);

  // Trailing comma → no phantom trailing entry.
  assert.deepEqual(parseCommaList("okffs,"), ["okffs"]);

  // Interior empty entry → dropped, order preserved.
  assert.deepEqual(parseCommaList("a, ,b,"), ["a", "b"]);

  // Well-formed input is trimmed and preserved.
  assert.deepEqual(parseCommaList("x, y"), ["x", "y"]);
});
