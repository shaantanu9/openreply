# Unified MCP analyses surface (`mcp_analyses` table + GUI tab + new tools)

**Date:** 2026-04-24
**Type:** Feature

## Summary

Made the MCP server the primary "brain" for interleaved fetch → analyze
workflows, and made every LLM-driven conclusion (from MCP tools or the
app's own pipelines) land in one table the GUI can render. The client
LLM in the MCP client (Claude Desktop / Cursor / Claude Code) drives
the analysis; the app's configured provider is only used when an MCP
tool itself needs to call an LLM (e.g. `openreply_synthesize_insights`),
and those calls are persisted with their provider/model so the user
can see what ran. Also loosened `openreply_query_db` to accept read-only
PRAGMAs so the client LLM can introspect the schema without hitting
the write-guard (which was why the user saw
`PRAGMA table_info(...)` fail earlier).

Streaming collect + rolling enrichment in the Tauri app was captured
in `docs/FUTURE_SCOPE.md` as Appendix Z — deferred, not implemented
here.

## Changes

- Added `mcp_analyses` table: `(id, topic, kind, source, tool,
  params_json, content, content_type, provider, model, tokens_in,
  tokens_out, created_at)` with indexes on `(topic, created_at)`,
  `(topic, kind, created_at)`, `(source)`.
- Added `save_mcp_analysis()` helper in `core/db.py`.
- `openreply_query_db` now accepts read-only PRAGMAs (`table_info`,
  `table_list`, `index_info`, `index_list`, `index_xinfo`,
  `foreign_key_list`, `database_list`, `function_list`). SELECT/WITH
  plus destructive-keyword guard unchanged.
- `openreply_discover_subs` now persists the ranked subs list to
  `mcp_analyses` (kind=`subreddit_ranking`).
- `openreply_analyze_paper` mirrors its analysis (summary/relevance/takeaway)
  into `mcp_analyses` (kind=`paper_analysis`).
- `openreply_analyze_papers_bulk` writes a single rollup row
  (kind=`conclusion`) so the GUI list stays readable.
- **New MCP tool** `openreply_synthesize_insights` — exposes
  `research.insights.synthesize_insights()`. Writes to `mcp_analyses`
  (kind=`insights`).
- **New MCP tool** `openreply_find_gaps` — exposes `research.gaps.find_gaps()`.
  Writes the 4-part report (painpoints / feature_wishes /
  product_complaints / diy_workarounds) to `mcp_analyses` (kind=`gaps`).
- **New MCP tool** `openreply_mcp_analyses_list` — read tool a client LLM
  can call to see what's already been concluded for a topic/kind
  before running a fresh synthesis. Filters on topic + kind.
- Topic page: added **AI Analyses** tab that lists `mcp_analyses`
  rows for the current topic (newest first), with MCP / app source
  chips, kind tag, tool / provider / model meta, and markdown or JSON
  rendering per `content_type`.

## Files Created

- `changelogs/2026-04-24_13_mcp-analyses-unified-surface.md` (this file)

## Files Modified

- `src/reddit_research/core/db.py` — added `mcp_analyses` table to
  `init_schema()`, added `save_mcp_analysis()` helper, exported it.
- `src/reddit_research/mcp/server.py` — loosened `openreply_query_db`
  guard for read-only PRAGMAs; wired persistence into
  `openreply_discover_subs`, `openreply_analyze_paper`,
  `openreply_analyze_papers_bulk`; added
  `openreply_synthesize_insights`, `openreply_find_gaps`,
  `openreply_mcp_analyses_list`; updated schema doc in `openreply_query_db`
  docstring to mention `mcp_analyses`.
- `app-tauri/src/screens/topic.js` — added `ai_analyses` tab button,
  `loadAiAnalyses()` loader, and included it in the primary-tabs,
  persisted-cacheable-tabs, and loaders map.
- `docs/FUTURE_SCOPE.md` — Appendix Z (streaming collect + rolling
  enrichment in the app, deferred) and Appendix Y (MCP intelligence
  surface design, shipped partially here).
