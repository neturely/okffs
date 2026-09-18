import { test } from "node:test";
import assert from "node:assert/strict";
import { isEpicType, issueTypeName, epicToolRefusal } from "./epic.js";

test("isEpicType matches Epic case-insensitively and nothing else", () => {
  assert.equal(isEpicType("Epic"), true);
  assert.equal(isEpicType(" epic "), true);
  assert.equal(isEpicType("EPIC"), true);
  assert.equal(isEpicType("Task"), false);
  assert.equal(isEpicType("Epic Story"), false);
  assert.equal(isEpicType(null), false);
  assert.equal(isEpicType(undefined), false);
  assert.equal(isEpicType(""), false);
});

test("issueTypeName reads GitHub's type object, a plain string, or null", () => {
  assert.equal(issueTypeName({ name: "Epic", id: 1 }), "Epic");
  assert.equal(issueTypeName("Bug"), "Bug");
  assert.equal(issueTypeName(null), null);
  assert.equal(issueTypeName(undefined), null);
  assert.equal(issueTypeName({}), null);
});

test("epicToolRefusal names the tool and points at the children", () => {
  assert.match(epicToolRefusal("commit_and_update", 306), /#306 is an Epic/);
  assert.match(epicToolRefusal("commit_and_update", 306), /commit_and_update does not apply/);
  assert.match(epicToolRefusal("create_pull_request", 306), /child issues/);
});
