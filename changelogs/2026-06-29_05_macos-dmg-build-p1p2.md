# macOS DMG build (ad-hoc) with P1/P2 layout + CSP fixes

**Date:** 2026-06-29
**Type:** Infrastructure

## Summary

Produced a local ad-hoc-signed macOS DMG (arm64) of OpenReply 0.1.23 from the
`fix/p1-p2-audit` worktree so the P1/P2 layout/CSP fixes from this session
(responsive tables, `minmax(0,1fr)` grids, scrollable modal, `min-w-0` main
column, brand-accent checkboxes, and the local Tailwind bundle that lets the CSP
drop `'unsafe-eval'`) are baked into an installable artifact. The build reused
the already-built PyInstaller onedir sidecar (no PyInstaller re-run) and went
through the project's canonical `scripts/publish-mac.sh --skip-sidecar`
pipeline. Ad-hoc signed only — not Developer-ID signed or notarized (that path
requires `--sign` + `APPLE_*` creds, which were not used here).

## Changes

- Populated the worktree's `app-tauri/src-tauri/binaries/` from the main
  checkout (it previously held only `README.md`): the launcher script
  `openreply-cli-aarch64-apple-darwin` (1.8 K shim that `exec`s the onedir
  engine), `ffmpeg-aarch64-apple-darwin` (48 M), and the
  `openreply-cli-onedir/` engine (61.8 M exe + 394 M `_internal/`). These are
  gitignored build inputs, not tracked source.
- Ran `scripts/publish-mac.sh --skip-sidecar` which: Vite-built the worktree
  frontend (`main-*.css` = 41.42 kB, confirming the local Tailwind bundle),
  ad-hoc codesigned the launcher + every nested onedir Mach-O, fetched ffmpeg,
  ran `cargo tauri build --bundles app` (9m04s cold), ad-hoc re-signed the
  `.app` to seal `CodeResources`, then produced a ZIP and a `hdiutil` DMG from
  the re-signed `.app`.

## Verification

- `OpenReply_0.1.23_arm64.dmg` (273 M) and `OpenReply_0.1.23_arm64.zip` (236 M)
  produced under
  `app-tauri/src-tauri/target/aarch64-apple-darwin/release/bundle/{dmg,zip}/`.
- `codesign --verify --deep --strict` on the `.app` inside the mounted DMG: OK
  (sealed resources present).
- onedir sidecar confirmed bundled at
  `OpenReply.app/Contents/Resources/binaries/openreply-cli-onedir/`
  (`openreply-cli` 61.8 M + `_internal/`).

## Files Created

- (none committed; build outputs and copied binaries are gitignored)

## Files Modified

- (none — source unchanged this step; this was a build of the existing
  `fix/p1-p2-audit` tree)
