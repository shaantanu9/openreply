# Boot-time PyInstaller `_MEI` orphan reaper (durable MCP/sidecar disk fix)

**Date:** 2026-05-30
**Type:** Fix / Infrastructure

## Summary

A fresh-install beta tester hit a wall of `cli exited 255` errors —
`[PYI-NNNNN:ERROR] Could not create temporary directory!` and
`decompression resulted in return code -1!` on `.so` extraction — which
255-exited **every** bundled-sidecar call: data tabs, table counts,
audience build, **and MCP install**. Root cause was NOT UPX corruption
(verified: no `UPX!` marker in the binary, spec already `upx=False`, the
bundled binary extracts and runs `exit 0`). It was **disk exhaustion**:
the PyInstaller onefile sidecar extracts ~130 MB into a fresh `_MEIxxxxxx`
temp dir on every spawn and only cleans up on graceful exit. Crashes /
SIGKILLs (sidecar lock-timeout, Claude Code reloading the MCP server, app
force-quit) leave the dir behind. They accumulated to 41 dirs = 4.56 GB on
a machine with only 4.6 GB free — the orphans *were* the deficit.

Immediate remediation was a one-time manual `rm -rf "$TMPDIR"_MEI*` (freed
4.3 → 29 GiB). This change makes the fix **durable** so it can never
silently recur: a boot-time reaper sweeps stale `_MEI*` dirs off the temp
path on every app launch. This is what makes "MCP installs with the app and
works smoothly, no interruptions" actually hold on any user's machine.

## Changes

- Added `cli::reap_pyinstaller_orphans()` — scans `std::env::temp_dir()` for
  `_MEI*` directories, removes those older than `min_age` (default 6 h,
  override via `GAPMAP_MEI_REAP_MIN_AGE_SECS`), returns `(dirs_removed,
  bytes_freed)`. Age gate guarantees it never deletes a live extraction or a
  freshly-started MCP server's dir.
- Added private `cli::dir_size_bytes()` helper (best-effort recursive size,
  for the freed-bytes log line only).
- Wired the reaper into `main.rs` `.setup()` on a dedicated `std::thread`
  (non-blocking — a slow temp dir never delays the window). Logs
  `[boot] reaped N orphaned _MEI dir(s), freed X.X MB` when it removes any.
- Recorded the failure mode + fix as a battle-tested gotcha in the
  `tauri-python-sidecar-app` skill.

## Verification

- `cargo check` / `cargo build`: 0 errors (1 unrelated JWT debug-fallback warning).
- Manually confirmed the bundled binary now extracts + runs `exit 0` after
  the temp cleanup, and `gapmap-cli mcp status --json` reports
  `installed/connected/db_aligned/token_in_env: true`.

## Files Created

- `changelogs/2026-05-30_01_pyinstaller-mei-orphan-reaper.md`

## Files Modified

- `app-tauri/src-tauri/src/cli.rs` — added `reap_pyinstaller_orphans()` + `dir_size_bytes()`.
- `app-tauri/src-tauri/src/main.rs` — call the reaper on a background thread in `.setup()`.
- `~/.claude/skills/tauri-python-sidecar-app/SKILL.md` — new gotcha row (the `Could not create temporary directory` / `decompression -1` disk-orphan family).
