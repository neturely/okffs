import { test } from "node:test";
import assert from "node:assert/strict";
import { extractChangelogSection, releaseTitle, isPrereleaseVersion, releaseNotes } from "./release_notes.js";

const cl = `# Changelog

## [Unreleased]

## [0.1.0] - 2026-09-18
### Added
- First release ([#1](https://x/1))

## [0.0.1] - 2026-01-01
- Older

[Unreleased]: https://x/compare/v0.1.0...HEAD
[0.1.0]: https://x/releases/tag/v0.1.0
`;

test("extractChangelogSection returns the section body, stopping at the next heading", () => {
  assert.equal(extractChangelogSection(cl, "0.1.0"), "### Added\n- First release ([#1](https://x/1))");
  assert.equal(extractChangelogSection(cl, "0.0.1"), "- Older"); // last section: stops at the link block
  assert.equal(extractChangelogSection(cl, "9.9.9"), null);
  assert.equal(extractChangelogSection("## [1.0.0]\n\n\n[1.0.0]: u", "1.0.0"), null); // empty section
});

test("releaseTitle, isPrereleaseVersion, releaseNotes", () => {
  assert.equal(releaseTitle(null, "0.13.1", "v0.13.1"), "v0.13.1");
  assert.equal(releaseTitle("health", "0.1.0", "health-0.1.0"), "health 0.1.0");
  assert.equal(isPrereleaseVersion("0.1.0"), false);
  assert.equal(isPrereleaseVersion("1.0.0-rc.1"), true);
  assert.equal(isPrereleaseVersion("1.0.0+build-1"), false); // build metadata, not a prerelease
  assert.equal(isPrereleaseVersion("1.0.0-rc.1+build-2"), true);
  assert.equal(releaseNotes("body", null, "1.0.0"), "body");
  assert.match(releaseNotes(null, "health", "0.1.0"), /health\/CHANGELOG\.md/);
});
