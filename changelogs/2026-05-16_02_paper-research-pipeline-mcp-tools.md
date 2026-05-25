# Paper Research Pipeline MCP Tools

**Date:** 2026-05-16
**Type:** Feature

## Summary

Added two new MCP tools to the FastMCP server that complete the paper research pipeline. `gapmap_paper_research_pipeline` is the orchestrating tool that chains all the existing paper tools (search → rank → fulltext → analyze → store) into a single MCP call. `gapmap_papers_for_topic` is a fast read-only companion that returns all analyzed papers for a topic from cache. Together these make the MCP server a first-class academic research surface.

## Changes

- Added `gapmap_paper_research_pipeline` to `src/reddit_research/mcp/server.py`
  - Searches all 6 academic sources in parallel (arXiv, PubMed, OpenAlex, Semantic Scholar, Crossref, Scholar)
  - Dedupes by post_id, persists to `posts` and `topic_posts` tables
  - Ranks by citation count, fetches PDF fulltext for top `max_fulltext` papers
  - Runs `analyze_paper` LLM analysis for each paper with content
  - Returns structured `{ok, topic, query, search_total, by_source, fulltext_fetched, fulltext_ok, analyzed, analyses, errors}`
  - Wrapped in `_run_with_timeout(timeout=120.0)` — slow LLM calls never hang the MCP session
- Added `gapmap_papers_for_topic` to `src/reddit_research/mcp/server.py`
  - Fast read-only JOIN of `paper_analyses` and `posts`
  - Returns all analyzed papers ranked by citation count with `year` derived from `created_utc`
  - Returns `{ok, topic, count, papers: [{post_id, title, url, source_type, citation_count, year, created_utc, summary, relevance, takeaway, provider, model, ts}]}`

## Files Modified

- `src/reddit_research/mcp/server.py` — added two tools (~170 lines) before the graph analysis section
