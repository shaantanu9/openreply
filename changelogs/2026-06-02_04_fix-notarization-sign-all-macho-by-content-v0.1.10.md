# Fix notarization (round 2): sign ALL onedir Mach-O by content — v0.1.10

**Date:** 2026-06-02
**Type:** Fix (release / CI)

## Summary

v0.1.9's mac release still failed notarization (`status: Invalid`) even though
the new pre-sign step ran successfully. Root cause: the pre-sign loop matched
Mach-O **by name** (`*.so` / `*.dylib` / `gapmap-cli`), which signed ~128 files
but **missed two**:

- `_internal/Python` — an **extensionless** Mach-O interpreter executable
- `_internal/Python.framework/Versions/3.11/Python` — a **framework** binary

Both stayed unsigned → notarization rejected the bundle ("not signed with a
valid Developer ID" / "the signature of the binary is invalid" / no secure
timestamp). The same flaw existed in `scripts/publish-mac.sh`.

## Changes

- `.github/workflows/release-mac.yml` — pre-sign step now detects Mach-O **by
  content** (`file -b … | grep Mach-O`) instead of by extension, signs
  deepest-path-first, and adds a **verify loop** (`codesign -v --strict` over
  every Mach-O) that aborts BEFORE notarytool if anything is still unsigned —
  so a missed file class fails fast instead of burning a ~4-min notarization
  round trip.
- `scripts/publish-mac.sh` — same content-based detection in BOTH the ad-hoc
  warmup loop and the `--sign` pre-sign block (kept in sync with CI).
- Version bump `0.1.9` → `0.1.10` (tauri.conf.json, Cargo.toml, Cargo.lock,
  package.json, package-lock.json) and tag `v0.1.10` to re-trigger the release
  (release workflows build from the tag's commit — a re-run can't pick up the
  fix).

## Files Modified

- `.github/workflows/release-mac.yml`
- `scripts/publish-mac.sh`
- `app-tauri/src-tauri/tauri.conf.json`, `Cargo.toml`, `Cargo.lock`
- `app-tauri/package.json`, `package-lock.json`

## Lessons (also written to skills)

- Sign Mach-O by CONTENT, never by extension — PyInstaller onedir ships
  extensionless executables + a Python.framework a name filter misses.
- Don't trust the signing loop's exit code; `codesign -v --strict`-verify every
  Mach-O before submitting to Apple.
- A release builds from the tag's commit; verify exhaustively before re-tagging
  (each attempt = a full ~13-min release cycle per OS).
- `tauri-github-release-flow` + `tauri-python-sidecar-app` skills updated.
