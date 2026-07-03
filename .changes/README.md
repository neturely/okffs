# Changelog fragments

When `OKFFS_UPDATE_DOCS=true`, okffs does **not** edit the shared `CHANGELOG.md`
on each issue branch — that makes parallel branches deterministically conflict on
the changelog (add/add when the file is new, same-hunk when it already exists).

Instead, `create_pull_request` drops a uniquely-named fragment here:

```
.changes/unreleased/<issue-number>-<slug>.md
```

Each branch only ever creates its own file, so fragments **never conflict**. A
fragment carries its change type in a machine-readable header comment plus the
changelog bullet:

```md
<!-- okffs:type=Fixed -->
- Some concise change ([#123](https://github.com/neturely/okffs/issues/123))
```

`type` is one of `Added`, `Changed`, `Fixed`, `Removed`, `Security`.

## Assembly

`prepare_release` folds every fragment in `.changes/unreleased/` into the
`## [Unreleased]` section of `CHANGELOG.md` (grouped under the right `###`
heading), rolls that into the new `## [X.Y.Z]` version section, and deletes the
consumed fragments — all in the release commit. You never assemble by hand.
