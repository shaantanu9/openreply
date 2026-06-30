# Fix wip-snapshot pre-commit hook silently emptying commits

**Date:** 2026-06-30
**Type:** Fix

## Summary

The `wip-snapshot.sh` pre-commit hook used a `git stash push -u` + `git stash
apply` round-trip to snapshot WIP into a recovery branch. Because the hook runs
*during* `git commit` (pre-commit phase), `stash push` cleared the index and
`stash apply` restored the changes **unstaged** — so the in-flight commit
captured almost nothing of what was staged. Real symptom: two feature commits
silently committed only their (untracked) changelog files and dropped every
staged code change. Working trees were never lost (the changes stayed on disk),
but commits were unreliable.

## Changes

- Replaced the `stash push/apply/branch/drop` round-trip with a single
  `git stash create` — it builds a snapshot commit object **without touching the
  index or working tree**, then `git branch` pins it. No commit-time side
  effects. Untracked files remain covered by the patch + filesystem copy the
  script already writes.

## Files Modified

- `scripts/wip-snapshot.sh` — section 3 now uses `git stash create` instead of a
  `stash push`/`apply` round-trip.
