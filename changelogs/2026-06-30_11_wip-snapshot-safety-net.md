# WIP snapshot safety net (prevent losing uncommitted work)

**Date:** 2026-06-30
**Type:** Infrastructure

## Summary

Uncommitted work-in-progress has been lost more than once during commit /
reset operations (e.g. `git commit -- <path>` silently committing the
working-tree version of a file, or hunk-staging mishaps). This adds a
triple-redundant, automatic backup so no WIP can ever be lost again.

`scripts/wip-snapshot.sh` captures every uncommitted file (modified +
untracked) three independent ways, and is wired as a git `pre-commit` hook so
a full backup is taken **before every commit**, automatically. The hook is
non-blocking — a backup failure can never block a commit.

## What it backs up (each run)

1. **File copies** → `~/reddit-myind-wip-backups/<timestamp>/files/<path>` —
   full content of every WIP file, so any single file can be restored verbatim.
2. **Patch** → `…/all-tracked-changes.patch` — `git diff HEAD` of all tracked
   changes, plus `MODIFIED-tracked.txt` / `UNTRACKED.txt` manifests.
3. **Git branch** → `wip-safety-<timestamp>` — a permanent ref (via a
   working-tree-neutral stash round-trip) so the snapshot lives in git history.

Old backups + branches auto-prune to the newest 30 (override with `KEEP=N`).

## Recovery

- One file: `cp ~/reddit-myind-wip-backups/<ts>/files/<path> <path>`
- Whole snapshot: `git show wip-safety-<ts> --stat` / `git checkout wip-safety-<ts> -- <path>`

## Files Created

- `scripts/wip-snapshot.sh` — the snapshot tool (executable).
- `.git/hooks/pre-commit` — installed locally (not tracked); calls the script.

## Notes

- The backup root `~/reddit-myind-wip-backups/` lives outside the repo, so it
  is never touched by git operations.
- Run manually any time with `scripts/wip-snapshot.sh`.
