# Feature 5 — Evidence-weighted answers

**Date:** 2026-06-07
**Type:** Feature

## Summary

Ask a claim about a topic and OpenReply returns a Consensus-style verdict — supported / contradicted / mixed / insufficient — with the count of supporting vs contradicting sources, a confidence, and a per-source breakdown (what users say vs what papers say). Evidence posts are retrieved by keyword from the topic corpus, then an LLM classifies each excerpt's stance. Cached per (topic, claim) in the new `evidence_verdicts` table. Verified on "calari tracking app": claim "users have problems with flight tracking accuracy" → supported (5 support / 0 contradict, confidence 1.0, 24 excerpts analyzed).

## Changes

- New core module `research/evidence_verdicts.py`: `answer()` (retrieve → LLM stance classification → aggregate verdict/confidence/breakdown → persist), `get()` (cached list). Verdict thresholds: supported needs ≥2× support and >contradict; insufficient if <3 decisive; mixed otherwise. Reuses `gaps._parse_json` for tolerant parsing.
- CLI: `openreply research gap-verdict --topic … [--claim] [--limit]`.
- MCP: `openreply_gap_verdict(topic, claim, limit)` tool.
- Tauri: `gap_verdict` command (registered), `gapVerdict` / `gapVerdictList` in `api.js`, new `gap_verdict.js` screen routed at `#/verdict/<topic>` (ask box → verdict card with support/contradict bar, confidence, source breakdown, past-verdicts list).
- Tests: `tests/test_evidence_verdicts.py` — 5 tests (supported, mixed, insufficient, no-evidence, cached read) with a mocked provider. All pass. `cargo check` clean; JS syntax checked.

## Files Created

- `src/openreply/research/evidence_verdicts.py`
- `app-tauri/src/screens/gap_verdict.js`
- `tests/test_evidence_verdicts.py`

## Files Modified

- `src/openreply/cli/main.py`, `src/openreply/mcp/server.py`
- `app-tauri/src-tauri/src/commands.rs`, `app-tauri/src-tauri/src/main.rs`
- `app-tauri/src/api.js`, `app-tauri/src/main.js`
