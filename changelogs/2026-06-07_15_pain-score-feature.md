# Feature 1 — 0-100 Pain Score per gap

**Date:** 2026-06-07
**Type:** Feature

## Summary

Added a PainOnSocial-style 0-100 pain score for every gap (painpoint) in a topic, so users can rank what to build first. Each gap is scored `frequency × intensity × recency`, where intensity blends the LLM severity with real post engagement and recency is an exponential decay on the newest evidence post. Scores are cached in a new `gap_scores` table (LLM-free read path) and surfaced across all four product surfaces (Core, CLI, MCP, Tauri desktop). Verified end-to-end on the "calari tracking app" topic (11 painpoints scored, top 69.0).

## Changes

- New core module `research/pain_scoring.py`: `score_gaps()` (build, LLM), `get()` / `export_csv()` (read), env-tunable weights (`PAIN_W_FREQ/INTENSITY/RECENCY`) and half-life (`PAIN_RECENCY_HALFLIFE_DAYS`). Auto-creates the `gap_scores` table.
- CLI: `openreply research gap-pain-scores --topic … [--build] [--limit] [--force] [--csv]`.
- MCP: `openreply_gap_pain_scores(topic, build, limit, force)` tool.
- Tauri: `gap_pain_scores` + `gap_pain_scores_build` commands (registered in `main.rs`), `gapPainScores` / `gapPainScoresBuild` in `api.js`, and a new `pain_scores.js` screen routed at `#/pain-scores/<topic>` (ranked board with score colour bands red≥70 / amber 40-69 / grey<40, sort, filter, CSV export).
- Tests: `tests/test_pain_scoring.py` — 4 tests (ranking, recency decay, cached read path, empty-corpus graceful). All pass. `cargo check` clean; JS syntax checked.

## Files Created

- `src/openreply/research/pain_scoring.py`
- `app-tauri/src/screens/pain_scores.js`
- `tests/test_pain_scoring.py`

## Files Modified

- `src/openreply/cli/main.py` — `gap-pain-scores` command.
- `src/openreply/mcp/server.py` — `openreply_gap_pain_scores` tool.
- `app-tauri/src-tauri/src/commands.rs` — two commands.
- `app-tauri/src-tauri/src/main.rs` — handler registration.
- `app-tauri/src/api.js` — JS wrappers.
- `app-tauri/src/main.js` — screen import + route.
