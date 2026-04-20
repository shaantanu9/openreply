# Phase 4 — Monitoring Mode + Weekly Delta View

**Date:** 2026-04-20
**Type:** Feature
**Spec:** `docs/ROADMAP.md` §Phase 4

## Summary

Ships Phase 4 of the retention roadmap: **the single biggest DAU
driver available.** Every topic refresh now records a delta vs. the
prior run, and the Dashboard surfaces "What's changed this week" as
the top card. Combined with Phase 3 Bets tab, this creates the weekly
return ritual: open app Monday → see delta digest → act on signals →
update tracked bets.

Also wires every Insights-tab Regenerate button through the monitor
engine, so users who regenerate a topic automatically populate the
dashboard delta digest without realizing it.

## Changes

- New `topic_runs` SQLite table:
  - `id`, `topic`, `run_at`, `ended_at`, `trigger`
    (manual | scheduled | post-collect), `corpus_size`,
    `findings_count`, `delta_json`, `report_hash` (stable), `error`
  - Added to `init_schema` in `core/db.py` with indexes on topic + run_at
- New `research/monitor.py` engine:
  - `compute_delta(prev_report, cur_report)` — diffs two Insight Engine
    reports. Returns findings added/removed, score changes ≥ 1.0,
    competitors added/removed, new academic papers count, corpus-size
    change, total_change_magnitude (drives Dashboard ranking).
  - `record_run(topic, trigger, report, error=, prev_report=)` — persists
    a `topic_runs` row with computed delta.
  - `run_topic_refresh(topic, trigger='manual', skip_collect=True)` —
    re-runs collect (optional) + synthesize, records delta. First-run
    case (no prev report) treats everything as added with magnitude 999.
  - `tick(skip_collect=True)` — processes all `topic_prefs.scheduled=1`
    topics. Called by launchd cron (existing infra).
  - `list_recent_runs(topic, limit)` — topic-scoped run history
  - `dashboard_deltas(limit=10, since_days=7)` — cross-topic top-N by
    magnitude, deduped to most-recent-run-per-topic.
- 3 new CLI commands:
  - `research monitor-run --topic T [--skip-collect|--with-collect]`
  - `research monitor-tick [--skip-collect|--with-collect]`
  - `research monitor-deltas [--topic T] [--limit N] [--since-days D]`
- 3 new Tauri commands:
  - `monitor_run_topic(topic, skipCollect)`
  - `monitor_tick(skipCollect)`
  - `monitor_deltas(topic?, limit?, sinceDays?)`
- `api.js` — 3 new bindings with cache invalidation on mutations.
- Dashboard "What's changed this week" card:
  - Renders in new `#weekly-deltas-slot` above hero stats
  - Populated by `loadWeeklyDeltas(root)` — async, silent when nothing
    meaningful changed (keeps dashboard clean for fresh installs)
  - Each row: topic name + delta summary + time-ago + click → topic page
  - "first run" chip for initial seed runs
  - Dismiss button (per-session hide)
- Insights tab `runSynth`: now routes through `monitor_run_topic`
  instead of raw `synthesize_insights`. Every regenerate records a
  delta. Toast flashes on completion if changes detected ("✨ N changes
  this run — see Dashboard for delta digest").
- CSS: `.weekly-deltas-card`, `.delta-row`, `.delta-chip-new`.

## Files Created

- `src/reddit_research/research/monitor.py`
- `changelogs/2026-04-20_09_phase4-monitoring-weekly-delta.md`

## Files Modified

- `src/reddit_research/core/db.py` — `topic_runs` table
- `src/reddit_research/cli/main.py` — 3 monitor commands
- `app-tauri/src-tauri/src/commands.rs` — 3 Tauri commands
- `app-tauri/src-tauri/src/main.rs` — registered new handlers
- `app-tauri/src/api.js` — 3 new bindings
- `app-tauri/src/screens/home.js` — delta slot + `loadWeeklyDeltas`
- `app-tauri/src/screens/insights.js` — `runSynth` routes via monitor
- `app-tauri/src/style.css` — delta card styles

## Testing

Unit-tested `compute_delta` end-to-end:
- First-run case: 2 findings → 2 added, magnitude 999
- Real diff: 1 added / 1 removed / 1 score change / 1 competitor churn
  → magnitude 9.8

CLI smoke:
- `reddit-cli research monitor-deltas --json` returns `[]` on fresh DB (correct)
- `reddit-cli research monitor-run --topic X` runs end-to-end

## Integration with existing features

- **Scheduled topics** (`topic_prefs.scheduled`): already exists. `monitor-tick`
  respects this — runs only flagged topics. launchd plist needs updating to
  invoke `reddit-cli research monitor-tick` on schedule (deferred to a
  manual step for now; see `schedule.rs`).
- **Hypothesis tracking** (Phase 3): delta digest doesn't yet tie into bet
  states, but the infrastructure is there — future phase can surface "3
  running bets now have fresh evidence" cards.
- **Chat** (existing): unchanged.
- **Native notifications**: deferred to a follow-up — `tauri_plugin_notification`
  not yet added. Current UX is: user opens app, sees delta card. Good enough
  for Phase 4; notifications are a Phase 4.5 enhancement.

## What this unlocks for the user

**Before Phase 4:** open app → see topic grid → click topic → generate insights → read brief → close. One-shot research loop.

**After Phase 4:** open app → see "What's changed this week" card at top with 3 topics showing fresh signals → click → review delta → (optionally) update a Bets state → close. **Weekly ritual formed.**

This is the retention surface that `docs/PRODUCT_GAPS.md` identified as
the single biggest gap. With Phase 3 + 4 shipped, Gap Map has crossed
from "research tool" into "research practice tool."
