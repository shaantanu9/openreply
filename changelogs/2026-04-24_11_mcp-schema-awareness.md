# MCP — Schema-Aware `gapmap_query_db` + `gapmap_describe_schema`

**Date:** 2026-04-24
**Type:** Fix + UX

## Problem

The MCP `gapmap_query_db` tool accepts raw SQL but its description only
listed table names, not columns. Claude / any LLM client fell back to
industry-default column names (`published_at`, `body`, `created_at`,
`indexed_at`) which don't exist in this schema — the real names are
`created_utc` (FLOAT unix), `selftext`, `fetched_at`, etc. Every
academic-papers query failed with `no such column: p.published_at`.

## Fix

Two changes in `src/reddit_research/mcp/server.py`:

1. **Expanded docstring on `gapmap_query_db`.** FastMCP emits the
   function docstring as the tool's JSON-Schema `description`, so it
   ends up in the model's context every time the tool is offered.
   The new description documents every table (posts, comments,
   topic_posts, graph_*, topic_insights, products, etc.) with the
   gotcha columns called out: `created_utc FLOAT (NOT "published_at")`,
   `selftext (NOT "body")`, `fetched_at (NOT "indexed_at")`. Also
   documents the date formatting pattern:
   `datetime(created_utc, 'unixepoch')`.

2. **New tool `gapmap_describe_schema(table=None)`.** Runtime
   introspection via `PRAGMA table_info()`. Useful when the docstring
   is stale after a migration, or when the model wants exact column
   types before composing a complex join. Returns the full schema map
   when called without args, or a single table's columns when called
   with `table="posts"`. Alphanumeric-underscore validation on the
   table name prevents SQL injection through this parameter.

## Verified

```
Python syntax check: ✓ parses
gapmap_query_db defined
gapmap_describe_schema defined
Old MCP server pid 74970 killed — next MCP call will restart with new tools.
```

The running MCP process is spawned on demand by the Tauri app + any
external MCP client. Killing the pid file's process is enough; the
next tool call triggers a fresh spawn picking up the new docstrings
and the new `gapmap_describe_schema` endpoint.

## Files Modified

- `src/reddit_research/mcp/server.py` — expanded `gapmap_query_db`
  description (~85 lines of schema reference), added
  `gapmap_describe_schema` tool (~40 lines).

## For future similar bugs

This pattern — embedding schema hints inside the tool description and
offering an introspection sibling tool — should be the default for
any MCP tool that accepts free-form queries against a structured
backend. Schema docs go stale fast, but the combination of:
- hand-maintained description (read first, fixes most guesses)
- live PRAGMA / introspection tool (covers drift)
gets you the best of both worlds without forcing a schema-mgmt workflow.
