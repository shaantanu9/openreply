# Fix: "Daily frequency" scheduler — bundled sidecar path + accurate interval

**Date:** 2026-07-01
**Type:** Fix

## Summary

The Settings → Automation "Auto cadence" (Daily / Weekly) control had two bugs
in the Rust launchd layer (`schedule.rs`):

1. `sidecar_absolute()` only resolved the **dev** sidecar path
   (`src-tauri/binaries/openreply-cli-aarch64-apple-darwin`). In any packaged
   build it fell straight through to `None`, so `schedule_install` returned
   "could not resolve sidecar binary path" — meaning **daily frequency could
   never be enabled from an installed DMG**.
2. `status()` never returned `interval_hours`, so the Settings label
   (`On · every ${s.interval_hours || 24}h`) always read "every 24h" regardless
   of the real cadence.

## Changes

- `sidecar_absolute()`: after the dev-path probe, fall back to the bundled
  `openreply-cli` wrapper next to `current_exe` (Contents/MacOS/), mirroring
  `cli.rs::resolve_bundled_sidecar`. Now resolves in both dev and packaged apps.
- `status()`: parse `<StartInterval>` (seconds) out of the installed plist and
  return it as `interval_hours`, so the UI shows the true cadence.

Verified with `cargo check` (clean compile).

## Files Modified

- `app-tauri/src-tauri/src/schedule.rs` — `sidecar_absolute()` bundled fallback;
  `status()` now returns `interval_hours` parsed from the plist.

## Important follow-up — stale onedir sidecar

The launchd job runs the compiled **onedir** sidecar (dev-venv bypass does NOT
apply to scheduled runs). The current onedir under
`app-tauri/src-tauri/binaries/openreply-cli-onedir/` predates today's
`init_schema` contention fix, so a scheduled `schedule-tick` run would still hit
the old hang. To make daily/weekly auto-runs actually work end-to-end, rebuild
the sidecar:

```
pyinstaller <spec>  →  copy into binaries/openreply-cli-onedir/  →  codesign --force --deep --sign - <exe>
```

(Interactive buttons in `tauri dev` already use the fixed dev-venv code.)
