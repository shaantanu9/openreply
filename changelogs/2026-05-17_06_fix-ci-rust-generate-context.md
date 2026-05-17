# Fix CI rust-check — generate_context!() panic on missing frontend bundle

**Date:** 2026-05-17
**Type:** Fix

## Summary

Follow-up to `2026-05-17_05`. After the `externalBin` fix let `cargo check`
get past `build.rs`, the `rust-check` job hit a second, previously-masked
failure: `src/main.rs:539:16: error: proc macro panicked`. Line 539 is
`.build(tauri::generate_context!())` — the `generate_context!()` macro reads
`frontendDist` (`../dist`, the Vite bundle) at compile time and panics when the
directory is missing. `app-tauri/dist` is gitignored and `rust-check` does not
run `npm run build`, so a bare CI checkout has no frontend bundle.

Reproduced locally by moving `app-tauri/dist` aside (`cargo check` → identical
panic) and verified the fix: a stub `dist/index.html` satisfies the macro and
`cargo check` finishes with 0 errors. `cargo check` only type-checks Rust — it
does not embed a real bundle — so a stub is correct here; `release.yml` builds
the real frontend before its bundle step.

## Changes

- `.github/workflows/ci.yml` (`rust-check`): the pre-`cargo check` step now
  also creates a minimal `app-tauri/dist/index.html` stub (alongside the
  existing `externalBin` strip), so `generate_context!()` does not panic.

## Files Created

- `changelogs/2026-05-17_06_fix-ci-rust-generate-context.md`

## Files Modified

- `.github/workflows/ci.yml` — stub frontend dist before `cargo check`
