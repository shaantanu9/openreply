# AI Visibility (GEO) — scheduled re-checks + citation trend

**Date:** 2026-06-27
**Type:** Feature

## Summary

Two additions that make the AI Visibility page self-updating. GEO citation
checks now run automatically on the existing launchd scheduler (throttled to
~once a day so they don't burn BYOK/Perplexity tokens every tick), and each
tracked query gets a lazy-loaded **citation trend** built from its check
history.

## Changes

- `reply/geo.py`: `due_for_scheduled_check(min_hours)` — true only when the
  agent's queries haven't been auto-checked within the window (uses the newest
  `geo_checks.checked_at` as the throttle, no new state table). `check_all_if_due()`
  runs `check_all` only when due, else returns `{skipped}`.
- `cli/main.py`: `schedule-tick` now calls `geo.check_all_if_due(min_hours=20)`
  alongside the reply poster (best-effort; `geo_checked` in the tick result).
- `or/dynamic.js`: `geoTrendDots()` renders one colored dot per past check
  (cited=green · competitor=amber · absent=rose, oldest→newest). Each GEO card
  gets a **📈 Trend** toggle that lazy-loads `api.geoHistory(id)` and renders it
  (one CLI spawn per opened card, not per visible card).

## Files Created

- `changelogs/2026-06-27_19_geo-scheduled-checks-trend.md`

## Files Modified

- `src/openreply/reply/geo.py`, `src/openreply/cli/main.py`, `app-tauri/src/or/dynamic.js`

## Verification

- Python (`.venv`): throttle logic — no-queries→not due, never-checked→due,
  checked-1h-ago→not due (20h)/due (0.5h), `check_all_if_due` skips when throttled.
- Frontend: `vite build` clean.

## Notes

- Cost-safe by design: the daily throttle means a fast launchd interval still
  re-checks GEO at most once/20h. Manual "Check" / "Check all" are unaffected.
- Scheduler + the underlying notification path remain macOS-only (launchd).
