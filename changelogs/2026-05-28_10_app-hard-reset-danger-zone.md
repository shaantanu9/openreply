# Hard reset — wipe app data + relaunch, from Settings → Danger Zone

**Date:** 2026-05-28
**Type:** Feature (UX + tooling)

## Summary

Sharing the app with another tester (or simulating a first install on
the same Mac) previously required a terminal incantation across three
folders:

```bash
rm -rf "$HOME/Library/Application Support/com.shantanu.gapmap"
rm -rf "$HOME/.config/gapmap"
# Then uninstall + reinstall the .dmg + open
```

That's a footgun (`rm -rf` on the wrong path is unrecoverable), it's
macOS-only as written, and it doesn't clear the WebView localStorage
unless the user fully uninstalls. Now there's an in-app **Danger Zone
→ Delete & reset** flow that:

1. Reads back exactly what would be deleted (topic count, license
   email, BYOK provider names, data-folder size in MB) so the user
   sees what's going away **before** confirming.
2. Requires typing the literal string `DELETE` to enable the red
   button — deliberate friction so a stray click or muscle-memory
   double-press can't trigger it.
3. Wipes the data dir (SQLite + license_state.json + caches +
   schedule.log) AND the BYOK env file (`~/.config/gapmap/.env`)
   in one round-trip.
4. Clears localStorage + sessionStorage so the next session has
   zero in-memory state from before the reset.
5. Calls `AppHandle::restart()` so the app relaunches into the
   welcome wizard automatically — no Cmd+Q required.

Also added a softer "Reset UI state (keep data + keys)" button next
to the existing Clear-profile / Reset-prefs row. Clears every
`gapmap.*` localStorage key (including onboarding completion, tab
cache, dismissed banners, dashboard SWR cache) but leaves the SQLite
DB, license, and BYOK keys intact. Used to recover from a wedged UI
without losing data — and to reproduce the welcome wizard for
on-boarding screenshots / demos.

## Cross-platform

The hard-reset wipes the right paths on every OS Tauri supports:

- **macOS**: `~/Library/Application Support/com.shantanu.gapmap/`
  (resolved via `AppHandle::path().app_data_dir()`) and
  `$HOME/.config/gapmap/.env`.
- **Windows**: `%APPDATA%\com.shantanu.gapmap\` (same Tauri helper)
  and `%USERPROFILE%\.config\gapmap\.env` (HOME isn't set on
  Windows by default — fixed `byok_env_path()` to fall back to
  USERPROFILE in the same edit).
- **Linux**: `~/.local/share/com.shantanu.gapmap/` (Tauri helper)
  and `$HOME/.config/gapmap/.env`.

## Changes

- New Rust commands in `app-tauri/src-tauri/src/commands.rs`:
  - `app_reset_preview(app)` — read-only summary returned as JSON
    (`{data_dir, data_mb, data_files, topic_count, license_email,
    byok_providers:[]}`). Opens SQLite read-only via the
    `file:…?mode=ro` URI so a held write-lock from the running app
    doesn't block the preview.
  - `app_hard_reset(app)` — wipes data_dir contents +
    BYOK env file. Returns `{ok, removed:[paths]}` on success or
    `{ok:false, removed:[…], errors:[…]}` on partial failure
    (FE doesn't relaunch on partial failure so the user can
    investigate). Idempotent: re-running on a clean machine
    returns `removed:[]`.
  - `app_relaunch(app)` — wraps `AppHandle::restart()` for the FE.
  - Helper `walk_dir_size(path)` — recursive size walker; does NOT
    follow symlinks (a stray symlink-to-/ would otherwise lock the
    UI walking the whole filesystem).
- `byok_env_path()` now falls back to `USERPROFILE` when `HOME`
  isn't set — makes the Windows path work without forcing users to
  configure HOME globally.
- Three commands registered in `app-tauri/src-tauri/src/main.rs`.
- JS API wrappers in `app-tauri/src/api.js`:
  `appResetPreview()`, `appHardReset()`, `appRelaunch()`.
- Settings UI (`app-tauri/src/screens/settings.js`):
  - Existing Danger Zone card extended to span `grid-column:1/-1`
    and gained a third button: **Reset UI state (keep data + keys)**.
  - Inside that card, a separated block at the bottom for the
    Hard Reset action — visually distinct so the most-destructive
    button isn't lost in the row of softer ones.
  - New `openHardResetModal()` helper renders the preview modal,
    gates the confirm button on `input.value === 'DELETE'`, handles
    Esc / backdrop-click / Enter, and orchestrates the
    Rust reset → localStorage clear → relaunch sequence with
    proper partial-failure handling.

## Files Created

- `changelogs/2026-05-28_10_app-hard-reset-danger-zone.md`

## Files Modified

- `app-tauri/src-tauri/src/commands.rs` — `app_reset_preview`,
  `app_hard_reset`, `app_relaunch`, `walk_dir_size`,
  Windows-friendly `byok_env_path`.
- `app-tauri/src-tauri/src/main.rs` — registered 3 new commands.
- `app-tauri/src/api.js` — `appResetPreview` / `appHardReset` /
  `appRelaunch` wrappers.
- `app-tauri/src/screens/settings.js` — Danger Zone card extended;
  `#btn-reset-ui-state` + `#btn-hard-reset` handlers wired;
  `openHardResetModal()` appended.
- Version bumped 0.1.2 → 0.1.3:
  - `app-tauri/src-tauri/Cargo.toml`
  - `app-tauri/src-tauri/tauri.conf.json`
  - `app-tauri/package.json`
  - `app-tauri/src-tauri/Cargo.lock` (auto by cargo)

## Verification

- `cargo check` clean (0 errors, 1 unrelated JWT_DESKTOP_SECRET warning).
- `npm test` 37/37 passed.
- `node --check src/screens/settings.js` clean.
- `node --check src/api.js` clean.
- **GUI runtime verification deferred** — user will test on a separate
  device. The modal flow + preview rendering should be observed before
  pressing the red button on any machine that has work-in-progress
  topics.

## Manual Test Notes (for the other device)

1. Install the v0.1.3 build, run the welcome wizard, collect 1 topic,
   add an LLM key, optionally license.
2. Go to **Settings → Danger Zone**.
3. Try **Reset UI state (keep data + keys)** first — confirms a soft
   reset works without losing topics.
4. Click **Delete & reset** → modal appears showing the topic count,
   license email (if any), and BYOK provider list.
5. Try clicking the red button without typing — it should stay disabled.
6. Type `delete` (lowercase) — button should stay disabled (case-
   sensitive).
7. Type `DELETE` — button enables.
8. Click → app restarts into a clean welcome wizard with no topics, no
   license, no keys.
9. Confirm `~/Library/Application Support/com.shantanu.gapmap/gapmap/`
   is empty (or whatever the equivalent path is on Windows/Linux).
10. Confirm `~/.config/gapmap/.env` is gone.
