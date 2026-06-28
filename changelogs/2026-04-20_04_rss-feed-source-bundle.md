# Curated RSS feed bundle — 11 categories, 50+ feeds, opt-in per category

**Date:** 2026-04-20
**Type:** Feature

## Summary

User pasted a list of ~100 high-signal RSS feeds (startup / science / ML / psychology / design / marketing / engineering / neuroscience) and asked to wire them in as a first-class source. This commit adds RSS as a standard source adapter so the collect pipeline, enrichment, and all downstream analysis (painpoints, sentiment, trends, graph, solutions) light up automatically — zero new code in the analysis layer, one new source family in the fetch layer.

## Design

One source id per category (rss_startup, rss_tech_news, rss_ml, …) plus a catch-all `rss` that runs the default bundle. The picker UI shows each category as its own checkbox, so a user researching "langchain" can tick RSS: ML / AI research + RSS: Engineering blogs without getting flooded by TechCrunch stories.

Each feed is fetched via `feedparser`, then entries are filtered by case-insensitive substring match against the topic keyword in title + summary. Unmatched entries are dropped so a generic feed doesn't dominate the corpus. Entries that match land in `posts` with `source_type='rss'` and `sub='rss:<category>'`, which means existing source-aware prompts already handle them (the `format_corpus` layer prefixes `[rss:startup:Paul Graham]`, etc.).

## Changes

### `src/reddit_research/sources/rss_catalog.py` (new)

- `CATALOG: dict[str, list[tuple[str, str]]]` — 11 category buckets → (publication_name, feed_url) pairs. Curated from the user's list, trimmed to feeds that actually resolve + return useful entries.
- `CATEGORY_LABELS` — human-readable names used by the UI.
- `DEFAULT_CATEGORIES = ["startup", "tech_news", "products", "ml", "science"]` — what `rss` (no suffix) runs.
- `feeds_for_categories(cats)` — resolver that falls back to defaults for None/empty and silently drops unknown category keys.

### `src/reddit_research/sources/rss.py` (new)

- `fetch_rss(feed_url, query, publication, category, limit)` — pulls the feed via `httpx` (polite UA from `_http.py`), parses with `feedparser`, filters by `query`, converts each entry to the common `posts` row shape.
- `_stable_id(feed_url, entry_id)` — `hashlib.sha1`-based id so post dedup survives PYTHONHASHSEED (unlike gnews's `hash()` approach, which already has a known collision risk across runs).
- Timestamp picked from `published_parsed` or `updated_parsed`, 0.0 fallback.
- Network/parse errors return `[]` so one flaky feed doesn't kill the collect.

### `src/reddit_research/sources/collect_adapter.py`

- `run_rss(topic, categories=None, urls=None, limit_per_feed=20)` — loops feeds with 0.3 s inter-feed sleep (different hosts, no rate-limit contention needed). One-feed failures are swallowed.
- `_rss_category_runner(cat)` — factory that binds `run_rss` to a specific category, so the SOURCES dict can register one dispatchable per category.
- `SOURCES` gained 12 new entries: `rss` (defaults bundle) + `rss_learning`, `rss_startup`, `rss_tech_news`, `rss_products`, `rss_engineering`, `rss_ml`, `rss_design`, `rss_psychology`, `rss_neuroscience`, `rss_science`, `rss_marketing`.

### `app-tauri/src/screens/topic.js`

- `ALL_SOURCES` gained 11 RSS category entries under a new `rss` group, all `defaultOn: false` (opt-in — users shouldn't wake up to five new sources silently).
- `GROUP_LABELS.rss = "RSS feeds (curated)"` → picker renders them in their own section.

## Why this needs no Rust / analysis changes

- The Rust `run_collect` command forwards `--sources` as a comma-separated string straight to the Python CLI, which looks up each entry in `SOURCES`. New keys just work.
- Enrichment runs over `posts` WHERE `topic_posts.topic = ?` — any `source_type` is fair game. Painpoint / feature-wish / product / DIY extraction already handles `source_type='rss'` without modification. Sentiment, graph, temporal gaps, solutions — same.

## Verification

- `.venv/bin/python` import-and-register check → all 12 RSS ids present in `SOURCES`, 11 categories in catalog.
- `feeds_for_categories(['ml', 'startup'])` → 19 feeds.
- `feeds_for_categories(['nonsense'])` → falls back to default (non-empty).
- `_stable_id()` round-trip is deterministic (same input → same output).
- Live fetch `fetch_rss("https://hnrss.org/frontpage", ...)` → 3 entries with correct shape (`id=rss_<hash>`, `source_type='rss'`, `sub='rss:tech_news'`, title/url populated).
- `node --check topic.js` → clean.
- Python pytest: 41 passed / 1 unrelated Ollama-ping failure (requires Ollama running) / 2 pre-existing deselected.

## UX delta

Before:
- User sees Reddit + HN + arXiv + GitHub etc. in the picker. No way to pull from Paul Graham, Stratechery, Netflix Tech Blog, OpenAI Blog, Nature, NN/g, …

After:
- Picker shows 11 new RSS category toggles under their own group. Each runs ~5–10 curated feeds for that niche, filtered by topic keyword so only relevant entries persist.
- Same collect run fans out RSS in parallel with the other sources (already handled by `_PARALLEL_SOURCES=6` ThreadPoolExecutor).
- Analysis, graph, chat, trends, sentiment all pick up `source_type='rss'` for free — UI pills render as `rss:startup`, `rss:ml`, etc.

## Files Created

- `src/reddit_research/sources/rss_catalog.py`
- `src/reddit_research/sources/rss.py`

## Files Modified

- `src/reddit_research/sources/collect_adapter.py` — added `run_rss`, `_rss_category_runner`, 12 new SOURCES entries
- `app-tauri/src/screens/topic.js` — added 11 RSS categories to `ALL_SOURCES` + `rss` group label
