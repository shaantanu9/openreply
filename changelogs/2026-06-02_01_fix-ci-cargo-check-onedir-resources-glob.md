# Fix CI `cargo check` failing on onedir sidecar resources glob

**Date:** 2026-06-02
**Type:** Fix (CI)

## Summary

The `Rust — cargo check` job in `ci.yml` failed with exit code 101 on every
push to `multi-source` (runs 26774521285, 26775771743). The Tauri build script
aborted with `glob pattern binaries/openreply-cli-onedir/**/* path not found or
didn't match any files`. Root cause: the `onefile→onedir` sidecar migration
added `bundle.resources: ["binaries/openreply-cli-onedir/**/*"]` to
`tauri.conf.json`, but the CI prep step only emptied `bundle.externalBin` — not
`bundle.resources`. Those binaries are gitignored build artifacts, so the glob
matched nothing on a bare checkout and `tauri-build` (run by `cargo check`)
failed before any Rust source was type-checked. Not caused by the
paper-workflow code — `cargo check` passes locally where the binaries exist.

## Changes

- `.github/workflows/ci.yml` — the "Prep tauri.conf.json + stub frontend for
  cargo check" step now also clears `d['bundle']['resources']=[]` alongside
  `externalBin`, so the onedir glob isn't resolved during the type-check-only
  CI run. Updated the explanatory comment.

## Files Modified

- `.github/workflows/ci.yml`

## Validation

- Replayed the prep transform on a copy of `tauri.conf.json`: both
  `externalBin` and `resources` emptied, JSON valid.
- The real bundle build (`release.yml`) is unaffected — it builds the binaries
  + frontend first and keeps `tauri.conf.json` intact.
