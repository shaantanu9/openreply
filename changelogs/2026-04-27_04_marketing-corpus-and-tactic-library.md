# 2026-04-27 — Marketing Corpus + Tactic Library

## Summary

Implemented the marketing corpus expansion and tactic recommendation pipeline:
new RSS categories, book ingest, tactic library seeding/matching, gap/insight
suggestions persistence, and UI surfacing.

## Added

- `scripts/ingest_marketing_books.py`
- `src/reddit_research/research/tactic_library.py`
- `data/tactics_seed.json`

## Changed

- `src/reddit_research/sources/rss_catalog.py`
- `src/reddit_research/sources/collect_adapter.py`
- `src/reddit_research/cli/main.py`
- `src/reddit_research/research/insights.py`
- `src/reddit_research/graph/semantic.py`
- `src/reddit_research/research/sentiment_by_source.py`
- `src/reddit_research/graph/build.py`
- `src/reddit_research/research/report_pro.py`
- `app-tauri/src/screens/topic.js`
- `app-tauri/src/screens/insights.js`
- `app-tauri/src/style.css`

## Validation Notes

- RSS categories: `marketing=15`, `persuasion=6`, `swipe=3`
- Adapter source IDs: `rss_persuasion`, `rss_swipe` present in `SOURCES`
- Tactic seed count: `32`
- Book ingest writes stable `reference_url` for user-facing links
