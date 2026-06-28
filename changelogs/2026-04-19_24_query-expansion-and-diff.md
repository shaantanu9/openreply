# Query expansion + time-windowed diff

**Date:** 2026-04-19
**Type:** Feature

## Summary

Two related features closing the loop on the "calari tracking" thread:

1. **Query expansion.** The single LLM call that canonicalizes the topic
   now also returns 5-8 scored search keywords (canonical + synonyms +
   product names + category terms). `collect.py` fans out per-source
   queries across the high-relevance keywords; all 16 source adapters
   (Reddit, HN, arXiv, OpenAlex, PubMed, Scholar, Dev.to, App Store,
   Play Store, Lemmy, Mastodon, GitHub, Stack Overflow, Google News,
   Google Trends, YouTube) accept either a single string (legacy) or a
   keyword list. Recall 3-5× vs. the single canonical query.

2. **Time-windowed diff (Part B of the quick-wins sprint).** New
   `graph/diff.py::diff_findings(topic, window_days)` buckets findings
   into `recent` / `prior` / `stable` by the node's creation timestamp.
   Surface on the Map tab as a gold-tinted "Since last week — N new
   painpoints · N new DIY · N new products · N new feature wishes"
   banner. Distinct from the static May-2025 CHRONIC/EMERGING/FADING
   classification — this one follows each user's own re-collect cadence.

## Changes

### Query expansion
- `discover.py::_canonicalize_topic` prompt extended to also return
  `search_keywords: [{keyword, relevance}, …]`. max_tokens bumped to 400.
- Malformed keyword entries dropped silently (non-dict, empty, bad
  relevance, duplicates). Canonical auto-prepended if the LLM omits it.
- `topic_canonicalizations` table gains a `keywords_json` column via
  lazy migration. Stale cache rows (keywords missing) force a re-LLM
  so existing canonicalizations get enriched on next access.
- `collect.py` extracts `search_keywords` filtered by relevance
  (`high` by default, `high+medium` in aggressive mode). `OPENREPLY_MAX_KEYWORDS`
  caps at 5 (default) — back-compat escape hatch to reduce to single-query.
- Reddit search stage fans out: `render_queries(kw)` for each keyword,
  merged + dedup'd. Logs "query expansion: N keywords → M unique queries".
- Extra-sources stage passes keyword list to each adapter; `TypeError`
  fallback keeps compat with any adapter still on the single-string contract.
- `collect_adapter.py` rewritten with a shared `_as_keywords()` helper
  and a `_KW_SLEEP=1.0s` politeness delay between keywords inside each
  adapter. Dedup guards on appstore/playstore/youtube (track_id / app_id /
  video_id) prevent re-fetching the same app/video across similar keywords.

### Time-windowed diff
- `core/db.py::init_schema` — `graph_nodes` gains a `ts` column, plus a
  lazy ALTER TABLE migration for pre-2026-04-19 installs (existing rows
  get empty ts → stable bucket).
- `graph/build.py::_upsert_node` — sets `ts` on first insert, preserves
  existing `ts` on update so re-extractions don't flicker as "new".
- `graph/diff.py` (new) — `diff_findings(topic, window_days)` splits
  nodes into recent / prior / stable buckets + summary counts.
- `cli/main.py` — new `research diff` subcommand.
- `commands.rs` + `main.rs` — new `diff_findings` Tauri command.
- `api.js` — `diffFindings(topic, windowDays)` with 30 s cache.
- `topic.js` — gold-tinted banner above Map toolbar when any counter
  is non-zero.
- `style.css` — `.diff-banner` styling.

## Files Created

- `src/reddit_research/graph/diff.py`
- `docs/superpowers/specs/2026-04-19-query-expansion-design.md`
- `docs/superpowers/plans/2026-04-19-query-expansion.md`

## Files Modified

- `src/reddit_research/core/db.py` — `graph_nodes.ts` + migration;
  `topic_canonicalizations.keywords_json` + migration.
- `src/reddit_research/research/discover.py` — prompt extension + keyword
  parsing + cache roundtrip for keywords.
- `src/reddit_research/research/collect.py` — keyword extraction,
  Reddit search fanout, extra-sources keyword forwarding.
- `src/reddit_research/sources/collect_adapter.py` — all 16 adapters
  accept str | list[str].
- `src/reddit_research/graph/build.py` — `ts` set/preserve in `_upsert_node`.
- `src/reddit_research/cli/main.py` — `research diff` subcommand.
- `app-tauri/src-tauri/src/commands.rs` — `diff_findings` command.
- `app-tauri/src-tauri/src/main.rs` — handler registration.
- `app-tauri/src/api.js` — `diffFindings` JS wrapper.
- `app-tauri/src/screens/topic.js` — "since last week" banner.
- `app-tauri/src/style.css` — `.diff-banner` styles.
- `tests/test_integration.py` — 4 new tests (2 keyword, 2 diff).

## Commits (in order)

- `564a101` feat(discover): LLM also returns scored search keywords
- `78b15ab` feat(collect): query expansion — fan out per-source across keywords
- `c1bedb7` feat(diff): time-windowed diff + 'since last week' banner

## Still pending (after this changelog)

- **Part C — Scheduled runs** (launchd + schedule-tick subcommand +
  Settings UI + per-topic toggle + "new since last viewed" banner).
  Plan ready at `docs/superpowers/plans/2026-04-19-quick-wins-sprint.md`
  Part C. Estimated ~1 day.
