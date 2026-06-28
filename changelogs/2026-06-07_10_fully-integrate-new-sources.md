# Fully integrate the 9 new sources across every surface

**Date:** 2026-06-07
**Type:** Feature / Integration

## Summary

Completed end-to-end integration of the 9 miroclaw-derived sources (GDELT,
DuckDuckGo, Tavily, World Bank, FRED, BIS, Yahoo Finance, Open-Meteo, ACLED) into
every place OpenReply surfaces a source — not just the fetch/dispatch layer. Swept the
whole codebase for source-label maps, the user-facing source picker, the corpus
formatter the LLM reads, sentiment labels, graph node labels/icons, badge colors, and
the FE source-chip mirrors, and added entries for all 9 in each.

## Changes

- **User-facing source picker** (`topic.js` rerun-collect modal): added all 9 with
  groups + defaults — DuckDuckGo (web, on), GDELT/Tavily (web, off), and a new
  **"Macro / economic / market data"** group for World Bank/FRED/BIS/yfinance/
  Open-Meteo/ACLED (all off by default, opt-in). Added the `macro` group label.
- **LLM corpus formatter** (`corpus_format.py`): per-source render strings so the
  extractor reads web/news as articles and macro rows as labelled "(data)" points
  rather than mislabelling them as low-engagement Reddit posts.
- **Source-label maps** updated everywhere: `collect.js` (chip labels + aggressive
  mirror), `posts.js` (filter dropdown), `find.js`, `intent_ladder.js`,
  `topic.js` (graph tooltip), `sentiment_by_source.py`, `report_pro.py`,
  `graph/build.py` (node labels + emoji icons).
- **Badge tints** (`style.css`): `.insight-src-badge` colors for all 9.
- **Collect toggle text** (`collects.js`): count bumped (now "17-source full sweep /
  9-source quick").

## Files Modified

- `app-tauri/src/screens/topic.js` — source picker (ALL_SOURCES + GROUP_LABELS) + graph tooltip map.
- `app-tauri/src/screens/collect.js` — SOURCE_LABELS + AGGRESSIVE_SOURCES mirror.
- `app-tauri/src/screens/posts.js`, `find.js`, `intent_ladder.js` — label maps.
- `app-tauri/src/screens/collects.js` — sweep-count toggle text.
- `app-tauri/src/style.css` — per-source badge tints.
- `src/openreply/research/corpus_format.py` — LLM corpus formatters.
- `src/openreply/research/sentiment_by_source.py`, `report_pro.py`, `graph/build.py` — labels/icons.

## Verification

- All edited JS pass `node --check`; all edited Python pass `py_compile`.
- `corpus_format` renders correct labels for all 9 sources.
- Full import chain (sources, collect_adapter, mcp.server, collect, sentiment,
  report_pro, graph.build) imports clean.
- `postLink.js` already routes non-Reddit sources via `url` (no change needed);
  `source_families.normalize_source_type` passes new source_types through correctly.

## Notes

- The macro/finance sources remain opt-in (off by default in the picker) and are
  relevance-gated per topic, so they enrich finance/market topics without polluting
  unrelated corpora.
