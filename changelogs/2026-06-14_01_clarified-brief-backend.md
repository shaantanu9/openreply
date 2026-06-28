# Clarified-Brief Backend (2A Slice 1)

**Date:** 2026-06-14
**Type:** Feature

## Summary

Adds per-topic research brief storage and LLM prompt injection. Users can now
set a goal, constraints, success criteria, and audience for any topic; these
are prepended to every synthesis prompt so the LLM output is scoped to the
stated intent rather than producing a generic analysis.

## Changes

- `topic_prefs` gains four nullable TEXT columns: `brief_goal`, `brief_constraints`, `brief_success`, `brief_audience` — added via the existing lazy-migration pattern, idempotent on existing databases
- New `src/openreply/research/brief.py` module: `set_brief`, `get_brief`, `brief_preamble`, `suggest_clarifications`
- `synthesize_insights` (one-shot path): brief preamble prepended to `user_prompt` before the feedback block
- `synthesize_insights_chunked` (map-reduce path): brief preamble prepended to `_chunk_system` (the system prompt passed to every chunk call) via closure capture
- CLI: `research brief set` / `research brief get` subcommands under a new `brief_app` Typer sub-app
- MCP: `openreply_brief_get` and `openreply_brief_set` tools registered via `@mcp.tool()`, accessible via `_TOOL_REGISTRY` without a live server

## Files Created

- `src/openreply/research/brief.py`
- `tests/test_brief_schema.py`
- `tests/test_brief.py`
- `tests/test_synthesis_brief.py`
- `tests/test_brief_mcp.py`
- `changelogs/2026-06-14_01_clarified-brief-backend.md`

## Files Modified

- `src/openreply/core/db.py` — brief column lazy-migrations in `init_schema`
- `src/openreply/research/insights.py` — preamble injection in both synthesis paths
- `src/openreply/cli/main.py` — `brief_app` Typer sub-app + `set`/`get` commands
- `src/openreply/mcp/server.py` — `openreply_brief_get` and `openreply_brief_set` tools
