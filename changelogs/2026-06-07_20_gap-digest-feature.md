# Feature 6 — Daily/weekly gap digest

**Date:** 2026-06-07
**Type:** Feature

## Summary

A scheduled brief that composes everything moving in a topic — top gaps by pain score, what's rising/new, the people to reach, and recently fired alerts — into one readable, copyable markdown digest (IdeaBrowser-style retention loop). Pure assembly of Features 1–5, no LLM. Verified on "calari tracking app": a full weekly brief with 5 top gaps, 5 people, and a fired alert.

## Changes

- New core module `research/gap_digest.py`: `build_digest(topic, period)` reading cached pain scores, velocity, people-to-reach, and alert events → `{ok, markdown, sections}`.
- CLI: `openreply research gap-digest --topic … [--period daily|weekly] [--out file.md]`.
- MCP: `openreply_gap_digest(topic, period)` tool.
- Tauri: `gap_digest` command (registered), `gapDigest` in `api.js`, new `gap_digest.js` screen routed at `#/digest/<topic>` (period toggle, minimal markdown→HTML renderer, copy-markdown).
- Tests: `tests/test_gap_digest.py` — 3 tests (sections + markdown, period label, graceful empty). All pass. `cargo check` clean; JS syntax checked.

## Files Created

- `src/openreply/research/gap_digest.py`
- `app-tauri/src/screens/gap_digest.js`
- `tests/test_gap_digest.py`

## Files Modified

- `src/openreply/cli/main.py`, `src/openreply/mcp/server.py`
- `app-tauri/src-tauri/src/commands.rs`, `app-tauri/src-tauri/src/main.rs`
- `app-tauri/src/api.js`, `app-tauri/src/main.js`
