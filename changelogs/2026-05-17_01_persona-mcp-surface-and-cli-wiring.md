# Persona MCP sub-server, CLI wiring, and deliberation integration

**Date:** 2026-05-17
**Type:** Feature

## Summary

The `persona/` module (single-lens learning agents — store, ingest, chat,
conclude, graph, teach, share) was fully built but only partially surfaced.
This change exposes the complete persona feature through both the MCP server
and the CLI, and wires persona-distilled conclusions into the 5-persona
deliberation engine so collected-post beliefs influence finding tiers.

## Changes

- Added `mcp/tools/persona_tools.py` — the first MCP **sub-server**, mounted
  into the main server via `mcp.mount()` with no namespace prefix so tool
  names keep the `gapmap_persona_*` convention.
- Exposed 16 `gapmap_persona_*` MCP tools total:
  - CRUD: `create`, `list`, `get`, `update`, `delete`
  - Memory: `memories`, `ingest`, `chat`
  - Conclusions: `conclusions_build`, `conclusions_get`
  - Graph: `graph`, `graph_backfill`
  - Teaching: `teach_youtube`
  - Peer learning: `ingest_peers`
  - Cross-persona: `share`, `rejections`
- Wired the orphaned `cli/persona_cmds.py` Typer sub-app into `cli/main.py`
  via `app.add_typer(persona_app, name="persona")` — the persona CLI command
  group (`reddit-cli persona list|create|ingest|chat|graph|share|...`) was
  previously unreachable.
- Integrated persona conclusions into `research/deliberate.py`: conclusions
  whose memories cover the topic are read, formatted into the persona-vote
  prompt as "PERSONA LENSES", and counted as endorsements — `≥2` endorsing
  conclusions add +1 confirm-equivalent to a finding's consensus tier and a
  +0.04 score boost. New `persona_grounded` flag on the deliberation result.

## Files Created

- `src/reddit_research/mcp/tools/__init__.py`
- `src/reddit_research/mcp/tools/persona_tools.py`

## Files Modified

- `src/reddit_research/mcp/server.py` — mount the persona sub-server
- `src/reddit_research/cli/main.py` — register the `persona` Typer sub-app
- `src/reddit_research/research/deliberate.py` — read persona conclusions,
  format them into the vote prompt, count endorsements in consensus tiering
