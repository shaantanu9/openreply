# Sidecar: force UPX off in PyInstaller spec

**Date:** 2026-05-30
**Type:** Fix

## Summary

Fresh-DMG installs reported a wall of `cli exited 255: [PYI-NNNNN:ERROR] … decompression resulted in return code -1!` errors (on `__mypyc.cpython-311-darwin.so`, `hf_xet/hf_xet.abi3.so`, etc.), which broke every data/LLM/MCP feature because the bundled Python sidecar 255-exited on spawn. Root cause (per the `tauri-fresh-install-triage` skill): UPX corrupts compiled extension modules (`.so`/`.dylib`) on macOS arm64. The CI build runner has `upx` on PATH (the dev machine does not — `which upx` → not found — which is why "works in dev, broken in DMG"). Set `upx=False` in the spec so the corruption can't be reintroduced by any build environment.

The companion `Could not create temporary directory!` errors were a separate cause — the user's boot volume was full at install time (disk now has 15 GB free); no code change needed for that one.

## Changes

- Set `upx=False` (was `upx=True`) in `openreply-cli.spec` EXE() with an explanatory comment.
- Rebuilt the sidecar locally (`scripts/build-pyinstaller.sh`), copied to `binaries/`, ad-hoc codesigned; smoke-tested `info` + a 12-way concurrent-spawn stress test (0/12 failures, no extraction errors).

## Files Modified

- `openreply-cli.spec` — `upx=True` → `upx=False`

## Follow-up

The spec fix only reaches users via a fresh CI DMG rebuild + re-notarization. Existing UPX-built installs keep failing until they install the new DMG. Push a release tag (or run the release workflow) to rebuild.
