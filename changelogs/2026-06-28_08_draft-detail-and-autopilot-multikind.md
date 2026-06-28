# Recent-draft detail (date/freshness/topic/tags) + auto-pilot multi-kind fix

**Date:** 2026-06-28
**Type:** Feature + Fix

## Summary

Two Compose improvements: (1) the **Recent drafts** cards now show creation
date + freshness, the topic, and tags so each draft is identifiable at a glance;
(2) fixed the auto-pilot so selecting multiple content kinds actually generates
**one of each** (it was treating the per-day count as a total and emitting only
a single post), and "Run now" now saves the current selection first.

## Changes

- `or/dynamic.js` `contentCard`: added a relative-time stamp (`_ago`) + full-date
  tooltip (`_dateStr`, new helper), a **NEW** badge for drafts <24h old, the
  draft **title**, and a **tags** row (#topic, angle, follow-up, scheduled time,
  word count). Both callers (generate output + Recent drafts list) pass the
  agent's niche/name as the topic.
- `reply/scheduler.py` `run_autopilot_if_due`: content loop now generates `count`
  of **each selected kind** (was `count` total, cycling kinds → only 1 item).
- `or/dynamic.js` auto-pilot panel: extracted `saveAP()`; **Run now** persists the
  current panel selection before running (so kinds apply without a separate Save);
  count label clarified to "Each selected kind, per day".

## Files Modified

- `app-tauri/src/or/dynamic.js` — contentCard detail + `_dateStr` + autopilot Run-saves-first
- `src/openreply/reply/scheduler.py` — per-kind content generation

## Verification

- Per-kind: `run_autopilot_if_due(force)` with kinds `[post, thread]` generated
  **one post + one thread** (was only a post).
- `node --check` clean. Pure JS + Python (no Rust) — JS hot-reloads; daemon
  refreshed so the scheduler change is live.
