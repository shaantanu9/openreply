# Fix mac release notarization Invalid — pre-sign onedir Mach-O in CI

**Date:** 2026-06-02
**Type:** Fix (release / CI)

## Summary

The `release (mac)` workflow (run 26775805808, tag v0.1.8) failed at "Build and
release Tauri bundle (signed)" — `npm run tauri build` exited 1 because
**notarization returned status `Invalid`**. The errors were on every nested
Mach-O in the PyInstaller onedir sidecar:

- `binaries/openreply-cli-onedir/openreply-cli` (the engine)
- `_internal/*.so` (cpython extensions: `__mypyc…so`, `_cffi_backend…so`, …)
- `_internal/*.dylib` (libSvtAv1Enc, libvorbisenc, libbrotli*, …)

each reporting: *"not signed with a valid Developer ID certificate"*, *"the
signature does not include a secure timestamp"*, and *"the executable does not
have the hardened runtime enabled."* (The `joblib/test/data/*.gz` "could not be
unpacked" lines are benign warnings, not the cause.)

Root cause: Tauri ships the onedir via the `resources` glob
(`binaries/openreply-cli-onedir/**/*`) and its bundler does **not** deep-sign loose
Mach-O placed in `Contents/Resources/`. `scripts/publish-mac.sh` already
pre-signs the onedir before bundling (commit b2b86c1), but that fix was never
ported into the CI workflow `release-mac.yml`.

## Changes

- `.github/workflows/release-mac.yml` — new step **"Pre-sign onedir Mach-O
  (Developer ID + hardened runtime + timestamp)"** before the tauri build:
  imports the Developer ID cert into a dedicated keychain, then
  `codesign --force --timestamp --options runtime --sign "$APPLE_SIGNING_IDENTITY"`
  every `.so` / `.dylib` / the `openreply-cli` engine under
  `binaries/openreply-cli-onedir/`. Mirrors `scripts/publish-mac.sh`'s `--sign`
  block. Signatures ride into `Resources/` (Tauri leaves already-signed
  Resources Mach-O untouched), so notarization now accepts the bundle.

## Files Modified

- `.github/workflows/release-mac.yml`

## Validation

- YAML parses; step shell body passes `bash -n`.
- Logic is the proven `publish-mac.sh --sign` path (verified locally 2026-06-02).
- Full verification requires a re-run of the mac release on a tag that includes
  this workflow change (CI-only; needs Apple secrets).

## Follow-ups

- P2: prune PyInstaller junk from the onedir before staging (joblib test
  `*.gz`, `__pycache__`, `tests/`) — removes the notarization *warnings* and
  shrinks the bundle. Not required for notarization to pass.
- The CI `cargo check` fix (clearing `bundle.resources`) shipped separately in
  `2026-06-02_01`.
