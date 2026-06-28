# Mandatory MCP logging + unified cross-table search (normal + aggressive)

**Date:** 2026-04-24
**Type:** Feature

## Summary

Two coupled changes so every LLM/MCP output is preserved and searchable, and so older pipelines can consume that accumulated context.

1. **Mandatory save to `mcp_analyses`** from every GUI-invoked Python pipeline (previously only MCP-server tools did this). Insights, concepts, solutions, sentiment, chat, quick-extract, temporal-gaps, and report-pro now each append a best-effort row at completion.
2. **Unified cross-table search** — a new `search_all(query, topic, aggressive)` primitive hits posts / graph nodes / analyses / papers / hypotheses / feedback with SQL LIKE in normal mode, and adds LLM query expansion plus palace semantic search in aggressive mode. Every run persists a compact summary to `mcp_analyses` (`kind='search'`) so downstream pipelines can seed prompts with "recently searched-for things" without a second lookup. Exposed via CLI (`research search-all`), Rust command (`search_all`), MCP tool (`openreply_search_all`), and GUI Search tab.

Together: the AI Analyses tab becomes the true unified log of every LLM touchpoint, and the new Search tab lets users (and pipelines) pull any row from any table through one input — with the answers saved back so they compound.

## Changes

### Phase 1 — mandatory saves
Appended guarded `save_mcp_analysis(source='app', kind=..., tool=..., content=..., content_type=..., provider=..., model=..., topic=..., params=...)` at the tail of every GUI-invoked Python pipeline. Each call is wrapped in `try/except` so logging never blocks the pipeline.

- `research/insights.py::synthesize_insights` → `kind='insights'`
- `research/insights.py::synthesize_insights_chunked` → `kind='insights'`
- `research/concept.py::concepts_for_topic` → `kind='concepts'`
- `research/solutions.py::solutions_pipeline` → `kind='solutions'`
- `research/sentiment_by_source.py::sentiment_for_topic` → `kind='sentiment'`
- `cli/main.py::cmd_research_chat` (covers both RAG + agent modes) → `kind='chat'`
- `cli/main.py::cmd_research_gaps` (covers quick-extract + full gaps) → `kind='quick_extract'`
- `cli/main.py::cmd_research_temporal` → `kind='temporal_gaps'`
- `cli/main.py::cmd_research_report_pro` → `kind='report'`

### Phase 2 — unified cross-table search
New `search_all` primitive:
- **Normal mode** — SQL LIKE across `posts.title`/`selftext`, `graph_nodes.label`/`metadata_json`, `mcp_analyses.content`, `paper_analyses.summary`/`takeaway`, `hypothesis_tests.card_json`, `finding_feedback.finding_title`/`note`. Offline, <100 ms typical.
- **Aggressive mode** — normal + LLM-assisted query expansion (3-4 paraphrases, union'd), + palace semantic search (`search_posts`) when the retrieval extras are installed. ~1-5 s, higher recall.
- Returns `{ok, query, topic, mode, expansions, buckets{posts, graph_nodes, analyses, paper_analyses, hypotheses, feedback, semantic?}, counts, persisted}`.
- Persists a compact summary (top post/finding/analysis IDs, query, expansions, counts) to `mcp_analyses` with `kind='search'`.

### Phase 3 — AI Analyses tab upgrade
Reads `mcp_analyses` with a 200-row cap (up from 100), groups by kind + source, renders clickable filter chips. Empty state now includes a "Run all analyses" CTA that switches to the Actions tab. Chip toggle hides non-matching cards client-side — no refetch.

### Phase 4 — GUI Search tab
New `Search` tab between Chat and Actions. Text input + aggressive toggle + Enter-to-run. Groups results by bucket, shows expansions inline when aggressive, links to posts, and confirms "saved to AI Analyses" on success. Freshness badge on the tab shows how many persisted searches this topic has.

## Files Created

- `src/reddit_research/research/search_all.py` — the cross-table search primitive + aggressive-mode helpers.
- `changelogs/2026-04-24_07_mcp-mandatory-save-and-unified-search.md` — this file.

## Files Modified

- `src/reddit_research/research/insights.py` — save row after `synthesize_insights` + `synthesize_insights_chunked`.
- `src/reddit_research/research/concept.py` — save row after `concepts_for_topic`.
- `src/reddit_research/research/solutions.py` — save row after `solutions_pipeline`.
- `src/reddit_research/research/sentiment_by_source.py` — save row after `sentiment_for_topic`.
- `src/reddit_research/cli/main.py` — save rows after `research chat`, `research gaps`, `research temporal-gaps`, `research report-pro`. New `research search-all` subcommand.
- `src/reddit_research/mcp/server.py` — new `openreply_search_all(query, topic, aggressive)` MCP tool.
- `app-tauri/src-tauri/src/commands.rs` — new `search_all(query, topic, aggressive)` Tauri command.
- `app-tauri/src-tauri/src/main.rs` — register `commands::search_all` in the invoke_handler.
- `app-tauri/src/api.js` — `api.searchAll(query, {topic, aggressive})` client wrapper.
- `app-tauri/src/screens/topic.js` — new Search tab button + `loadSearch` inline loader + loader registration + primary-tabs set + freshness badge. AI Analyses tab rewritten to include kind/source filter chips and a "Run all analyses" empty-state CTA.

## Verification

- `npm run build` — clean build, 1492 kB bundle.
- `cargo check` on `src-tauri` — compiles clean.
- `uv run python -c "from ...search_all import search_all; r = search_all('test'); ..."` against the real local DB — returns `ok=True, mode=normal, total=63` across 6 buckets.
