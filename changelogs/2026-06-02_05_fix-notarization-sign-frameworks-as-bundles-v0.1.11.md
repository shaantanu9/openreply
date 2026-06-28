# Fix notarization (round 3): sign frameworks as bundles — v0.1.11

**Date:** 2026-06-02
**Type:** Fix (release / CI)

## Summary

v0.1.10's mac release still failed notarization (`status: Invalid`), but the
error changed and narrowed: the loose `.so`/`.dylib` I signed by content
**passed**, and only the `_internal/Python.framework` binary (+ the
`_internal/Python` symlink that resolves to it) came back **"the signature of
the binary is invalid."** Diagnostic tell: loose Mach-O pass + framework fails =
a **bundle-seal** problem, not a coverage problem. A `.framework` must be signed
as a **bundle** (its `Versions/<X>` directory), not as a loose inner binary.

## Changes

- `.github/workflows/release-mac.yml` + `scripts/publish-mac.sh` — reworked
  onedir pre-signing into three steps:
  - **A** sign each `.framework`'s `Versions/<X>` directory as a bundle
    (skip the `Current` symlink), deepest-first.
  - **B** sign remaining loose Mach-O **outside** any `.framework`, detected by
    content (`file | grep Mach-O`), deepest-first.
  - **C** verify before notarytool — frameworks with `codesign --verify --deep
    --strict`, loose Mach-O with `--strict`; abort if any invalid. (Plain
    `--strict` on a framework's loose inner binary passes even when the bundle
    seal is bad — which is why v0.1.10's verify didn't catch it; `--deep` does.)
- Version bump `0.1.10` → `0.1.11`; tag `v0.1.11` to re-trigger the release.

## Files Modified

- `.github/workflows/release-mac.yml`, `scripts/publish-mac.sh`
- `app-tauri/src-tauri/tauri.conf.json`, `Cargo.toml`, `Cargo.lock`
- `app-tauri/package.json`, `package-lock.json`

## Lessons (written to `tauri-github-release-flow` skill)

- Frameworks → bundle-level signing (`Versions/<X>` dir), not loose inner binary.
- Verify frameworks with `--deep --strict` (loose `--strict` gives false pass).
- Diagnostic: loose Mach-O pass + framework fail ⇒ bundle-seal issue.
- Three release cycles for one notarization bug (name-filter → missed framework
  → loose-signed framework). Verify-before-notarytool fails fast on the next
  miss instead of burning a ~13-min cycle.
