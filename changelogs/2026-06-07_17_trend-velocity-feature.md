# Feature 3 — Trend velocity (rising/falling/new)

**Date:** 2026-06-07
**Type:** Feature

## Summary

OpenReply now shows direction, not just presence: each gap (and the whole topic) gets a recent-vs-prior posting-rate comparison so users can tell a rising/new gap from a fading one (Exploding-Topics style). Computed purely from `created_utc` — no LLM, no new table. Per-gap velocity matches the topic's posts against the gap title's keywords. Verified on "calari tracking app": topic velocity +31.2% rising over a 90-day window; per-gap keyword matching returns 70–919 posts per gap.

## Changes

- New core module `research/trend_velocity.py`: `compute_topic_velocity()`, `compute_gap_velocity()`, pure `_window_velocity()` (recent [now-W,now] vs prior [now-2W,now-W] → posts/day + velocity_pct + direction new/rising/falling/flat) and `_keywords()` (stopword-filtered title tokens).
- CLI: `openreply research gap-velocity --topic … [--gap-id] [--window] [--topic-level]`.
- MCP: `openreply_gap_velocity(topic, gap_id, window_days, topic_level)` tool.
- Tauri: `gap_velocity` + `topic_velocity` commands (registered), `gapVelocity` / `topicVelocity` in `api.js`.
- UI: velocity merged into the Pain Scores board as a "Trend" column (▲ rising / ▼ falling / NEW), fetched best-effort so it never blocks the board.
- Tests: `tests/test_trend_velocity.py` — 6 tests (rising, new-no-baseline, falling, keyword stopwords, topic counts, gap keyword match). All pass. `cargo check` clean; JS syntax checked.

## Files Created

- `src/openreply/research/trend_velocity.py`
- `tests/test_trend_velocity.py`

## Files Modified

- `src/openreply/cli/main.py`, `src/openreply/mcp/server.py`
- `app-tauri/src-tauri/src/commands.rs`, `app-tauri/src-tauri/src/main.rs`
- `app-tauri/src/api.js`, `app-tauri/src/screens/pain_scores.js`
