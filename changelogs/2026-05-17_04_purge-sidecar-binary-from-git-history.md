# Purge sidecar binary from git history — 1.5 GB → 72 MB

**Date:** 2026-05-17
**Type:** Infrastructure

## Summary

The `.git` directory had grown to 1.5 GB. Cause: the PyInstaller-built Python
sidecar binary (`app-tauri/src-tauri/binaries/reddit-cli-aarch64-apple-darwin`,
~230 MB per build) was committed via Git LFS, and every rebuild added a fresh
full copy — 7 LFS objects (1.2 GB) plus 2 plain blobs (~124 MB) from a branch
that had de-LFS'd it. For an open-source repo this is unworkable: GitHub's free
LFS tier is 1 GB/month bandwidth (≈4 clones before contributors are throttled).

Rewrote history with `git filter-repo` to remove every copy of the sidecar
binary from all commits, pruned the LFS objects, and added the binary to
`.gitignore` so future rebuilds never re-bloat the repo. Result: `.git` is now
72 MB and the public repo carries zero LFS objects.

The binary itself is unaffected — it is a build artifact. `release.yml` already
rebuilds it fresh on every tagged release; local dev rebuilds it with
`pyinstaller reddit-cli.spec`. The live binary was preserved on disk during the
rewrite (it is now an untracked, gitignored file).

## Changes

- Ran `git filter-repo --invert-paths --path-glob 'app-tauri/src-tauri/binaries/reddit-cli-*'` to purge the sidecar binary from all 299 commits across every branch.
- `git lfs prune` + cleared orphaned LFS objects; `.git/lfs` no longer referenced by any ref (`git lfs ls-files --all` is empty).
- Added `app-tauri/src-tauri/binaries/reddit-cli-*` and `ffmpeg-*` to `.gitignore`.
- Removed `.gitattributes` (its only entry was the now-obsolete LFS filter for `reddit-cli-*`).
- Rewrote `app-tauri/src-tauri/binaries/README.md` to document that **both** sidecar binaries are build artifacts, not committed, with local build commands.
- Full pre-rewrite backup bundle written to `/tmp/openreply-prefilter-backup-*.bundle` (all refs + stash).

## Files Created

- `changelogs/2026-05-17_04_purge-sidecar-binary-from-git-history.md`

## Files Modified

- `.gitignore` — ignore the sidecar + ffmpeg binaries under `app-tauri/src-tauri/binaries/`
- `app-tauri/src-tauri/binaries/README.md` — both binaries documented as build-locally artifacts

## Files Deleted

- `.gitattributes` — obsolete LFS filter (no LFS-tracked files remain)
