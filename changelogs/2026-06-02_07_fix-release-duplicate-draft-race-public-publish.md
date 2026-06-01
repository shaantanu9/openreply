# Fix release flow: duplicate-draft race left public release incomplete

**Date:** 2026-06-02
**Type:** Fix (release / CI)

## Summary

After all platforms built+signed+notarized for v0.1.12, the **public release
card was missing mac-Intel + all Linux installers** even though those jobs
reported success. Root cause: `tauri-action`'s release creation isn't atomic,
so parallel platform jobs (mac arm64/x64 + windows + linux) sometimes create
**two duplicate drafts** for the same tag in the source repo. Each platform's
"Publish artifact to public repo" step then ran `gh release download <tag>`,
which resolves to only ONE of those drafts — so a platform whose artifact
landed on the *other* draft silently downloaded nothing and uploaded nothing
(exit 0, no error). v0.1.12 needed manual consolidation to publish.

## Changes

- `.github/workflows/release-mac.yml`, `release-windows.yml`, `release-linux.yml`
  — replaced the ambiguous `gh release download "$VER"` with a `dl_src()`
  helper that enumerates **all** source-repo releases carrying the tag and
  downloads matching assets **by asset id** (`gh api … Accept:
  application/octet-stream`). Robust to duplicate drafts; idempotent (skips
  files already present). Applies to the next release — no re-tag needed.

## Manual remediation already done for v0.1.12

- Downloaded the missing Intel DMG + Linux AppImage/deb/rpm from the source
  draft, size-verified, uploaded to the public release, and **published it
  (draft→latest)**: https://github.com/myind-ai/gapmap/releases/tag/v0.1.12
  — now 8 assets covering every device.

## Files Modified

- `.github/workflows/release-mac.yml`
- `.github/workflows/release-windows.yml`
- `.github/workflows/release-linux.yml`

## Lessons (written to `tauri-github-release-flow` skill)

- tauri-action can create duplicate drafts under parallel jobs; never trust
  `gh release download <tag>` when multiple workflows publish the same tag —
  download by asset id across all tagged releases.
- A publish step that "succeeds" but uploads nothing is a silent-failure trap;
  verify the public release asset count matches the expected platform set.

## Follow-up (P2, not blocking)

- macOS-Intel `.zip` (updater artifact) wasn't consolidated — only the `.dmg`.
  Apple Silicon has both; Intel auto-update may need the `.zip` added.
- Consider pre-creating a single source draft (a `needs:`-gated job) to
  eliminate the duplicate-draft race at the root.
