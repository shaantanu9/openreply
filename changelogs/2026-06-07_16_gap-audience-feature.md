# Feature 2 — Real people to reach per gap

**Date:** 2026-06-07
**Type:** Feature

## Summary

For every scored gap, OpenReply now lists the actual people voicing the pain — author, the post permalink to reply to, their engagement, the gaps they voiced, and their audience-persona cluster. Turns an insight into outreach (WorthBuild-style). Built from the evidence posts already linked to each gap by the pain-score pass, deduped by author, and cached in a new `gap_evidence_users` table. Verified on "calari tracking app": 12 people across 11 gaps, ranked by engagement.

## Changes

- New core module `research/gap_audience.py`: `build()` (rollup from scored gaps + persona tagging, skips `[deleted]`/AutoModerator), `get_gap_users()` (one gap), `get_topic_reachout()` (deduped topic-wide), `export_csv()`. Auto-creates `gap_evidence_users`.
- CLI: `openreply research gap-audience --topic … [--build] [--gap-id] [--limit] [--csv]`.
- MCP: `openreply_gap_audience(topic, gap_id, build, limit)` tool.
- Tauri: `gap_audience` + `gap_audience_build` commands (registered), `gapAudience` / `gapAudienceBuild` in `api.js`, new `gap_audience.js` screen routed at `#/people/<topic>` (outreach board with persona chips + clickable absolute Reddit permalinks + CSV export).
- Tests: `tests/test_gap_audience.py` — 4 tests (dedup + skip-deleted, engagement ranking, cross-gap topic rollup, graceful no-scores). All pass (8 total with F1). `cargo check` clean; JS syntax checked.

## Files Created

- `src/openreply/research/gap_audience.py`
- `app-tauri/src/screens/gap_audience.js`
- `tests/test_gap_audience.py`

## Files Modified

- `src/openreply/cli/main.py`, `src/openreply/mcp/server.py`
- `app-tauri/src-tauri/src/commands.rs`, `app-tauri/src-tauri/src/main.rs`
- `app-tauri/src/api.js`, `app-tauri/src/main.js`
