# Fix release auto-promote race — dedicated workflow_run promote backstop

**Date:** 2026-06-01
**Type:** Infrastructure (CI/Release)

## Summary

The public release of v0.1.7 built successfully on all three platforms and uploaded all
8 friendly-named assets to `myind-ai/openreply`, but the release stayed a **draft** and the
public homepage kept showing v0.1.4 as latest — it had to be promoted by hand. Root cause
is a race in the auto-promote design: each per-platform workflow (release-mac/windows/
linux) carries an inlined "promote-if-complete" step that runs **mid-job, right after that
job's own upload**. Depending on timing, no single one of those checks observes all
required platforms (mac Apple Silicon + mac Intel + Windows) present at the instant it
runs, so none flips the draft.

Fix: a new dedicated workflow `release-promote.yml` that triggers via `workflow_run`
**after each platform workflow fully completes**, re-reads the current public-release asset
list, and promotes draft → latest the moment mac + windows are both present. Because it
re-checks on every platform completion and is idempotent, the last workflow to finish
always lands the promotion — regardless of per-job timing.

## Changes

- Created `.github/workflows/release-promote.yml`:
  - Triggers on `workflow_run` completion of `release (mac)`, `release (windows)`,
    `release (linux)`, plus a `workflow_dispatch` manual entry (`tag` input).
  - Resolves the tag from `workflow_run.head_branch` (the pushed tag for tag-triggered
    runs) or the dispatch input; skips non-`v*` refs and non-success triggering runs.
  - Reuses the existing `scripts/promote-release-if-complete.sh` (mac + windows required,
    linux optional) with the `PUBLIC_RELEASE_TOKEN` secret + `PUBLIC_RELEASE_REPO` var.
- Left the per-platform inlined promote steps in place as a fast-path; the new workflow is
  the guaranteed backstop. Both are idempotent.
- Validated all four release workflows parse as YAML.

## Files Created

- `.github/workflows/release-promote.yml`
- `changelogs/2026-06-01_01_fix-release-auto-promote-race.md`

## Notes

- `workflow_run` only fires when this file exists on the repo's **default branch**
  (`multi-source`), so it is committed there. It takes effect for the **next** tagged
  release; v0.1.7 was already promoted manually.
- To validate end-to-end, cut a future release (e.g. v0.1.8) and confirm the public
  release auto-promotes without manual intervention.
