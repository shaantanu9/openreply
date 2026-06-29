# Daily Update 2.0 — multi-source categorized feed + news search + daily brain learning

**Date:** 2026-06-29
**Type:** Feature

## Summary

Upgraded the Overview "Daily Update" from a flat 6-item card into a proper daily
learning surface: a two-column card (goal-framed briefing on the left, a
scrollable categorized feed on the right) that pulls fresh items across four
buckets — **News, Articles, Community, Research** — every day, learns them into
the agent's brain, and supports on-demand free news search. The card stays
height-bounded (internal scroll) so it never hijacks the Overview page. The first
open each day builds + caches; "Refresh now" forces a rebuild.

## Changes

- **Categorized sources.** Replaced the flat `NEWS_SOURCES` with
  `CATEGORY_SOURCES` (news: gnews/rss_tech_news/rss_products/duckduckgo · articles:
  devto/hn/github · community: lemmy/mastodon · research: arxiv/pubmed/scholar).
  Reddit deliberately stays on the Opportunities surface.
- **Per-item category.** Added `_category_of(source_type)` (prefix-tolerant) and
  tag every feed item with its category; `_fresh_items` now reads a wider corpus
  window (240, 7-day freshness), bumps the feed to 40 items, and guarantees each
  category's top items appear so the pills are never empty.
- **Daily brain learning.** `build_digest` now runs `learn_for_agent()` after the
  fresh collect so the agent ingests the new items into memories + beliefs
  (fail-soft; skip with `--no-learn`). `sources_json` records `by_category` and
  `learned` counts.
- **On-demand news search.** New `search_news()` over free, key-less sources
  (Google News + DuckDuckGo) — read-only, returns mapped feed items.
- **Frontend.** Rewrote the Overview digest renderer into the two-column layout
  with category pills (client-side filter), a fixed-height internal scroll feed,
  a header search box (Enter to search, Clear to exit), and "+ Task" on both
  briefing themes and feed items. SWR localStorage paint preserved.
- **Plumbing.** CLI `reply digest-search`; Rust `agent_digest_search` command
  (registered in `main.rs`); JS `api.agentDigestSearch` + long-command entry.

## Files Created

- `changelogs/2026-06-29_15_daily-update-multi-source-feed.md`

## Files Modified

- `src/openreply/reply/digest.py` — `CATEGORY_SOURCES`/`DIGEST_SOURCES`/`NEWS_SEARCH_SOURCES`, `_category_of`, `_to_feed_item`, rewritten `_fresh_items` (category + balanced fill), `build_digest` (learn pass, by_category/learned in sources_json, n=40), new `search_news`.
- `src/openreply/cli/reply_cmds.py` — `digest` defaults (n=40, `--no-learn`, progress) + new `digest-search` command.
- `app-tauri/src-tauri/src/commands.rs` — new `agent_digest_search` Tauri command.
- `app-tauri/src-tauri/src/main.rs` — registered `agent_digest_search`.
- `app-tauri/src/or/api.js` — `agentDigestSearch` wrapper + long-command entry.
- `app-tauri/src/or/dynamic.js` — rewrote the Overview Daily Update renderer (two-column, pills, scroll, search).
- `app-tauri/src/styles.css` — `.feed-scroll` thin scrollbar.
- `tests/test_digest.py` — tests for `_category_of`, empty-query search, and feed-item categories.

## Verification

- `pytest tests/test_digest.py` → 6 passed.
- `cargo check` (app-tauri/src-tauri) → clean (pre-existing dead-code warnings only).
- `npm run build` (vite) → built, no JS errors.
