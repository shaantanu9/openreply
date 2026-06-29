# Signed + notarized DMG (v0.1.23) carrying the onboarding redesign + test-llm fix

**Date:** 2026-06-29
**Type:** Infrastructure

## Summary

Ran the full local macOS publish pipeline (`scripts/publish-mac.sh --sign`) to
cut a Developer ID-signed, Apple-notarized, stapled `OpenReply_0.1.23_arm64.dmg`.
This is the first shareable build that carries BOTH the guided 4-step onboarding
(changelog 11) and the `test-llm`/`list-models` CLI fix (changelog 10) — until
now those fixes only existed in source / the dev build, so the installed DMG
still errored on "Test connection". The packaged sidecar and frontend in this
DMG are rebuilt from the fixed sources.

## Changes

- Rebuilt the Vite frontend (new onboarding compiled in — `main-*.css` 42.0 KB).
- Rebuilt the PyInstaller onedir sidecar from the fixed `cli/main.py` (carries
  the restored top-level `test-llm` + `list-models` commands).
- Developer ID-signed the `.app` wrapper + all 442 nested onedir Mach-O
  (hardened runtime + secure timestamp); `codesign --verify --deep --strict`
  passes.
- Built the DMG from the re-signed `.app` via `hdiutil` (not Tauri's bundler).
- Notarized + stapled the DMG.

## Notarization recovery

The pipeline's in-build notarization (Step 6) failed once on a transient
network timeout during the multipart upload to Apple's notary S3 bucket
(`HTTPClientError.deadlineExceeded`) — not a signing/code problem. Re-submitted
the already-signed DMG directly via `notarytool submit --wait`; **Accepted on
the first retry** (submission id `fbb349b9-8503-4def-8232-3f230d26c31a`),
stapled, and validated.

## Verification

- `xcrun stapler validate …OpenReply_0.1.23_arm64.dmg` → "The validate action worked!"
- `spctl -a -vvv` on the `.app` inside the mounted DMG →
  `accepted · source=Notarized Developer ID · origin=Developer ID Application: Shantanu Bombatkar (263A33H6P5)`
- DMG: 277 MB · sha256 `d6100af49b078d5c27c50120f0466e8b27662987fecc7a0aae08f48152c65448`

## Files Created

- `app-tauri/src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/OpenReply_0.1.23_arm64.dmg`
  (signed + notarized + stapled, arm64)
- `app-tauri/src-tauri/target/aarch64-apple-darwin/release/bundle/zip/OpenReply_0.1.23_arm64.zip`
  (signed; Developer ID, not yet notarized — DMG is the shareable artifact)

## Files Modified

- None (build artifacts only; source already committed in changelogs 10 & 11).

## Follow-up

- The DMG is arm64 (Apple Silicon) only. An Intel (`x86_64`) build needs
  `scripts/publish-mac.sh --sign --arch x86_64` (cross-compile not yet wired —
  see obs 10141).
