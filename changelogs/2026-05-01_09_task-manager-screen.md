# Task Manager — single-screen runtime view (Windows Task Manager analog)

**Date:** 2026-05-01
**Type:** Feature

## Summary

The user reported many things in queue with no single place to see what's
happening — collects, extraction queue, MCP jobs, sweeps, watch streams,
and LLM token spend were spread across `/collects`, `/activity`, the
status bar, and Settings. Built a unified `/tasks` screen that pulls
every queue/job table in one round-trip and renders them as a Windows-
style Task Manager: 4 stat tiles, Active section, Queued section,
Resource-usage card, Recent section. Auto-refreshes every 2 s with a
pause toggle.

Verified live: pulled 41,972 pending extraction rows + recent activity
from the real DB on first call.

## Architecture

`runtime_snapshot()` is a single Python function that reads:
  • `fetches` (collects — running + recent)
  • `streams` (active watch streams)
  • `extraction_queue` (synthesized to one-row-per-topic backlog)
  • `mcp_jobs` (MCP queue + running + recent)
  • `product_sweeps` (recent sweeps)
  • `extraction_daily_usage` (today + 7-day rollup, by provider/model)

Returns a stable shape so the UI doesn't fan out 5+ invokes per refresh.
Cancellable rows expose `cancellable: true`; the UI wires cancel buttons
on those.

Polling cadence: UI ticks every 2 s while visible; cachedInvoke window
is 1.5 s so refreshes coalesce. The screen stops polling when the user
navigates away (route-gen guard + MutationObserver on the data-route-gen
attribute).

## Files Created

- `src/reddit_research/runtime/__init__.py`
- `src/reddit_research/runtime/snapshot.py` — 250-line read-only snapshot helper
- `app-tauri/src/screens/tasks.js` — 220-line Task Manager screen
- `changelogs/2026-05-01_09_task-manager-screen.md`

## Files Modified

- `src/reddit_research/cli/main.py` — `research runtime-snapshot` command
- `app-tauri/src-tauri/src/commands.rs` — `runtime_snapshot` Tauri command
- `app-tauri/src-tauri/src/main.rs` — handler registration
- `app-tauri/src/api.js` — `api.runtimeSnapshot()` wrapper
- `app-tauri/src/main.js` — `/tasks` route
- `app-tauri/src/lib/tabs.js` — tab icon for `/tasks`
- `app-tauri/index.html` — sidebar nav entry "Task Manager" above
  "Active collects" (Collects becomes a detail view; Task Manager is
  the new single-screen overview)
- `app-tauri/src/style.css` — `.tm-*` styles for the screen
