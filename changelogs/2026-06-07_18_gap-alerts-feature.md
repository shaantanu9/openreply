# Feature 4 — Saved alerts / monitoring

**Date:** 2026-06-07
**Type:** Feature

## Summary

OpenReply can now watch a topic and fire when a gap moves — turning a one-off research tool into a recurring habit (and a subscription path). Three alert types: `spike` (velocity ≥ threshold and rising), `new` (a gap with no prior baseline appears), and `score_threshold` (pain score ≥ threshold). Conditions are evaluated against the existing pain-score + velocity passes (no LLM). Two new tables: `gap_alerts` (the watches) and `gap_alert_events` (fired history). Verified on "calari tracking app": a score_threshold alert fired ("Unusual flight routes pain 69.0 ≥ 60.0").

## Changes

- New core module `research/gap_alerts.py`: `create_alert / list_alerts / update_alert / delete_alert / check_alerts / list_events`, with `_evaluate()` reusing `trend_velocity` + `gap_scores`. UUID alert ids, env-default thresholds.
- CLI: `openreply research gap-alerts --action list|create|update|delete|check|events …`.
- MCP: `openreply_gap_alerts(action, topic, alert_type, gap_id, threshold, …)` tool.
- Tauri: 5 commands (`gap_alerts_list`, `gap_alert_create`, `gap_alert_delete`, `gap_alerts_check`, `gap_alert_events`) registered; JS wrappers in `api.js`; new `gap_alerts.js` screen routed at `#/alerts/<topic>` (create watches, "Check now", fired-event feed, delete).
- Scheduling: `docs/manual-todo/gap-alerts-scheduling.md` — launchd/cron/Task-Scheduler recipes for unattended checks.
- Tests: `tests/test_gap_alerts.py` — 6 tests (CRUD, invalid type, score fires/not-below, spike on rising topic, disabled skipped). All pass. `cargo check` clean; JS syntax checked.

## Files Created

- `src/openreply/research/gap_alerts.py`
- `app-tauri/src/screens/gap_alerts.js`
- `tests/test_gap_alerts.py`
- `docs/manual-todo/gap-alerts-scheduling.md`

## Files Modified

- `src/openreply/cli/main.py`, `src/openreply/mcp/server.py`
- `app-tauri/src-tauri/src/commands.rs`, `app-tauri/src-tauri/src/main.rs`
- `app-tauri/src/api.js`, `app-tauri/src/main.js`
