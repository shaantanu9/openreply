# Scheduled runs (Part C of the quick-wins sprint)

**Date:** 2026-04-19
**Type:** Feature

## Summary

Closes the quick-wins sprint with local scheduled re-runs — per-topic
opt-in, macOS-native launchd integration (Linux/Windows degrade to a
platform-not-supported response without breaking the UI), and an
in-app "Auto-refresh" toggle on each topic's header. Pairs with
yesterday's time-windowed diff banner so the "since last viewed"
loop is now closed: schedule fires overnight → diff picks up what
appeared → user sees a gold banner next time they open the topic.

## Changes

### Python
- `core/db.py` — new `topic_prefs(topic, scheduled, last_run_seen, last_run_ts)` table.
- `cli/main.py` — three new subcommands:
  - `research schedule-enable --topic T --enabled/--disabled`
  - `research schedule-seen    --topic T` (records the user's most-recent view)
  - `research schedule-tick --json` (walks every `scheduled=1` topic and re-runs collect; skips any topic with an in-flight collect in the last 5 min).

### Rust
- New `src-tauri/src/schedule.rs`:
  - `install(interval_hours, data_dir)` — writes `~/Library/LaunchAgents/com.shantanu.gapmap.schedule.plist` with the resolved sidecar path, `REDDIT_MYIND_DATA_DIR`, and `PYTHONUNBUFFERED=1`; `launchctl load -w` loads it.
  - `uninstall()` — `launchctl unload -w` + removes the plist.
  - `status()` — reports `installed`, `loaded`, `path`.
  - Sidecar binary path resolved at install time (walks up from `current_exe()` looking for `src-tauri/binaries/reddit-cli-aarch64-apple-darwin`) so the plist works regardless of install location.
  - Non-macOS builds return `{"installed": false, "reason": "not supported on this platform"}`.
- `commands.rs` — 5 new Tauri commands: `schedule_install`, `schedule_uninstall`, `schedule_status`, `schedule_enable_topic`, `schedule_mark_seen`.
- `main.rs` — module declaration + handler registration.

### Frontend
- `api.js` — `scheduleStatus / Install / Uninstall / EnableTopic / MarkSeen`.
- `screens/settings.js` — new "Scheduled runs" card with Off / 6h / Daily / Weekly select. Greys out with the platform reason on non-macOS. Live status: "Enabled · every Nh", "Off", etc.
- `screens/topic.js`:
  - New "Auto-refresh" toggle in the topic header (next to Rerun collect). Persists via `schedule_enable_topic`. Initial state pulled from `topic_prefs.scheduled`.
  - `scheduleMarkSeen(topic)` fired (fire-and-forget) on Map load.

## Files Created

- `app-tauri/src-tauri/src/schedule.rs`

## Files Modified

- `src/reddit_research/core/db.py` — new `topic_prefs` table.
- `src/reddit_research/cli/main.py` — 3 new subcommands.
- `app-tauri/src-tauri/src/commands.rs` — 5 new Tauri commands.
- `app-tauri/src-tauri/src/main.rs` — `mod schedule` + handler registration.
- `app-tauri/src/api.js` — 5 new JS wrappers.
- `app-tauri/src/screens/settings.js` — "Scheduled runs" card.
- `app-tauri/src/screens/topic.js` — "Auto-refresh" toggle + mark-seen on load.

## Commit

- `f8cbfff` feat(schedule): Part C — scheduled runs via launchd + in-app wiring

## How to verify

1. `cd app-tauri && npm run tauri dev`.
2. Settings → **Scheduled runs** → select "Every day" → status reads "Enabled · every 24h".
3. Check `launchctl list | grep com.shantanu.gapmap.schedule` — should show the agent.
4. Open any topic → toggle **Auto-refresh** → `reddit-cli research query "SELECT * FROM topic_prefs"` should show `scheduled=1`.
5. Flip the Settings select to "Off" → plist + agent removed.
