# Fix notarization (root cause): non-framework Python — v0.1.12

**Date:** 2026-06-02
**Type:** Fix (release / CI)

## Summary

After three rounds of signing fixes (name-filter → missed framework →
loose-signed framework), v0.1.11 STILL failed mac notarization — even though the
pre-sign step signed the `Python.framework` as a bundle AND `codesign --verify
--deep --strict` passed (436 signed, 0 failures). Notarization still returned
"signature of the binary is invalid" for `_internal/Python` +
`_internal/Python.framework/Python`. Proof the signatures were valid *before*
the Tauri build and invalid *after* ⇒ **Tauri re-signs the nested framework
during its bundle-signing pass and breaks the hardened-runtime signature**
(loose `.dylib`/`.so` survive because codesign treats them as resources; a
`.framework` is nested *code* it re-touches).

Root cause: `actions/setup-python` on macOS installs
`/Library/Frameworks/Python.framework`, so PyInstaller bundles
`_internal/Python.framework`. The known-good LOCAL build uses a non-framework
Python (`sysconfig PYTHONFRAMEWORK = none`) and has no framework to break.

## Fix (eliminate the framework instead of fighting it)

- `.github/workflows/release-mac.yml`:
  - Dropped `actions/setup-python`; build PyInstaller against uv's
    `python-build-standalone` (non-framework): `uv python install 3.11` +
    `UV_PYTHON_PREFERENCE=only-managed` + `UV_PYTHON=3.11` exported to all
    subsequent uv steps.
  - Busted the PyInstaller dist cache key (`pyinstaller-` → `pyinstaller-nonfw-`)
    so the old framework build isn't restored.
  - Kept the pre-sign step — with a standalone Python it just signs the loose
    `libpython*.dylib` + `.so` + engine (no framework), which already
    notarizes cleanly.
- Windows (v0.1.11) already passed; Linux passing. This change is mac-only.
- Bump `0.1.11` → `0.1.12`; tag `v0.1.12`.

## Files Modified

- `.github/workflows/release-mac.yml`
- `app-tauri/src-tauri/tauri.conf.json`, `Cargo.toml`, `Cargo.lock`
- `app-tauri/package.json`, `package-lock.json`

## Lesson (written to `tauri-github-release-flow` skill)

If your local build signs/notarizes fine but CI doesn't, compare the Python:
`PYTHONFRAMEWORK = none` (local) vs a framework Python (CI) is the bug. Use a
non-framework Python in CI; don't try to sign a bundled `Python.framework`.
