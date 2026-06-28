# Compose Auto-pilot — daily content + opportunity reply on a schedule

**Date:** 2026-06-28
**Type:** Feature

## Summary

Added a **scheduler in Compose** so the app delivers standing daily value: each
day it auto-drafts content from the agent's brain/knowledge AND finds fresh
opportunities + drafts the top reply — both default **daily 1**, configurable.
Drafts are waiting in the Queue/Inbox when the user opens the app. Builds on the
existing launchd `schedule-tick` backbone (which already re-collects, learns into
the brain, finds opportunities, posts due replies, runs GEO checks).

## Changes

- `reply/scheduler.py` (new): per-agent auto-pilot config in `reply_state`
  (`autopilot:<id>`), defaults **content daily-1 [post]** + **opportunity daily-1**.
  `get_autopilot` / `set_autopilot` / `run_autopilot_if_due` — the latter, when
  due (per-feature throttle), generates `count` content items of the chosen kinds
  via `content.generate_content` (which blends beliefs + memories + graph +
  corpus) and drafts the top `count` new opportunities via `generate.generate_reply`.
- `cli/main.py` `schedule-tick`: now calls `scheduler.run_autopilot_if_due()` each
  tick (best-effort).
- CLI `agent_cmds.py`: `agent autopilot` / `autopilot-set` / `autopilot-run`.
- Rust `commands.rs`/`main.rs`: `agent_autopilot`, `agent_autopilot_set`,
  `agent_autopilot_run`.
- Frontend `api.js`: `agentAutopilot` / `agentAutopilotSet` / `agentAutopilotRun`.
- Frontend `dynamic.js` `renderCompose`: an **Auto-pilot panel** — Daily content
  (kind toggles + per-day count) and Daily opportunity reply (per-day count), a
  **Save** (persists config + installs the OS scheduler via `scheduleInstall(24)`)
  and **Run now** button, plus scheduler-on/off status.

## Files Created

- `src/openreply/reply/scheduler.py`
- `changelogs/2026-06-28_07_compose-autopilot-daily-schedule.md`

## Files Modified

- `src/openreply/cli/main.py` — autopilot in schedule-tick
- `src/openreply/cli/agent_cmds.py` — autopilot CLI commands
- `app-tauri/src-tauri/src/commands.rs`, `main.rs` — 3 autopilot commands
- `app-tauri/src/or/api.js`, `app-tauri/src/or/dynamic.js` — API + Compose panel

## Verification

- `get/set_autopilot` on the real app DB: defaults daily-1 content [post] +
  daily-1 opportunity; set persists.
- `agent autopilot-run` end-to-end: generated **1 post draft** (from the brain)
  + drafted **1 opportunity reply** — both succeeded.
- `cargo check` 0 errors; `node --check` clean.

## Notes / follow-ups

- Auto-pilot defaults ON at daily-1 but only runs once the OS scheduler is
  installed (the Save button does that). It's throttled (~20h) so a frequent tick
  can't over-spend tokens.
- Runs for the active agent (matches the existing `find_if_due` scope); per-agent
  fan-out is a later option.
