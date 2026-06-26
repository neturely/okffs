# Changelog

All notable changes to this project will be documented in this file.
See [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]
### Fixed
- fix & enhance: auto-PR flow improvements, CHANGELOG commit, branch push, and new workflow tools ([#38](https://github.com/2b9sa2owa/okffs/issues/38)) — Fixes and enhancements to the auto-PR flow plus a new commit_and_update tool.

- create_pull_request now commits the updated CHANGELOG onto the branch and pushes the branch before opening the PR, with non-blocking error handling.
- close_issue returns a /clear tip and no longer triggers a PR on c...