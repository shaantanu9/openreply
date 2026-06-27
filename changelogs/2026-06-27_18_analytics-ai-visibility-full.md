# Analytics + AI Visibility (GEO) — full features

**Date:** 2026-06-27
**Type:** Feature

## Summary

Turned the two thin dashboards into real, working features. **AI Visibility
(GEO)** now runs an **automated citation check** through the configured BYOK
provider — it asks the model the tracked query, captures the answer, and
classifies the brand as cited / competitor / absent (previously status was set
manually). **Analytics** gained server-side aggregation with a 30-day activity
trend, content performance, visual inline-SVG charts, and subreddit/keyword
breakdowns.

## Changes

- `reply/geo.py`: added `check_query` (LLM answer + tolerant JSON parse +
  cited/competitor/absent classification), `check_all`, `query_history`; new
  `answer`/`competitors` columns (guarded migration) + `geo_checks` history
  table.
- `reply/analytics.py` (new): `analytics_summary(agent_id, days)` rolls up
  `reply_opportunities` + `content_items` + geo citation rate into KPIs, a
  daily time series, content-by-kind, draft→scheduled→posted funnel, and
  subreddit/platform/keyword drivers.
- CLI `reply_cmds.py`: `geo-check`, `geo-check-all`, `geo-history`, `analytics`.
- Rust `commands.rs`: `geo_check`, `geo_check_all`, `geo_history`,
  `analytics_summary`; all registered in `main.rs`.
- Frontend `api.js`: `geoCheck`, `geoCheckAll`, `geoHistory`, `analyticsSummary`.
- Frontend `dynamic.js`:
  - `renderAnalytics` rewritten — KPI grid, `sparkChart` (multi-series SVG
    trend), `barList` charts for content-by-kind / funnel / subreddits /
    keywords. Empty + non-Tauri fallbacks.
  - `renderGeo` — per-query **Check** button (spinner → status + expandable AI
    answer + competitor chips + "checked Nm ago"), header **Check all**,
    competitor KPI; manual "Mark cited" kept as override.

## Files Created

- `src/gapmap/reply/analytics.py`
- `docs/superpowers/specs/2026-06-27-analytics-ai-visibility-design.md`
- `changelogs/2026-06-27_18_analytics-ai-visibility-full.md`

## Files Modified

- `src/gapmap/reply/geo.py` — automated checking + history + migration
- `src/gapmap/cli/reply_cmds.py` — geo-check/-all/-history + analytics commands
- `app-tauri/src-tauri/src/commands.rs` — 4 new commands
- `app-tauri/src-tauri/src/main.rs` — registered the 4 commands
- `app-tauri/src/or/api.js` — 4 new API methods
- `app-tauri/src/or/dynamic.js` — Analytics + GEO renderers rebuilt with charts

## Verification

- `geo.check_query` ran a real check: "best note app for students" → status
  **competitor** (brand absent; Evernote/OneNote/Simplenote/Bear detected),
  history row appended.
- `analytics_summary` returns reconciling KPIs + N daily buckets (verified via
  CLI `reply analytics --days 7`).
- `cargo check` — 0 errors. `node --check` clean on `dynamic.js` / `api.js`.
