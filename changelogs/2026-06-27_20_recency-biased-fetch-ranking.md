# Recency-biased Reddit fetch so freshness ranking works

**Date:** 2026-06-27
**Type:** Fix

## Summary

Verified the data-source fetch for Overview, Opportunities, and AI Visibility
(GEO) end-to-end, and fixed a ranking dead-weight in Opportunities. All three
backends were already functional (Overview refresh fetched 13 posts + learned;
`reply find` pulled real Reddit threads; `geo-check-all` ran a real BYOK LLM
query and detected competitors). The bug: the engagement-weighted RRF gives
**freshness 10%** of the final score, but the fetch used Reddit's default
*relevance* sort, which returns months-old threads. With a 30-day freshness
lookback, every candidate scored `freshness = 0`, so that 10% was dead on the
free/anonymous path — and stale, unreplyable threads outranked timely ones.

## Changes

- `sources/reddit_free.py`: `fetch_reddit_free` now takes a `sort` param
  (default `"new"`), threaded through both the cookie `search.json` tier
  (`_authed_search`) and the RSS fallback (`public_search`). Recency-biased by
  default so outreach surfaces fresh, still-replyable threads.
- `reply/opportunity.py`: `_fetch_reddit` blends two passes — `"new"` (fresh
  threads, so freshness contributes) + `"relevance"` (strongest topical
  matches) — deduped by id.
- `tests/test_reddit_free.py`: updated the `public_search` mocks for the new
  signature; added an assertion that the default sort is `"new"`.

## Verification

- Recent posts now score `freshness = 1.000` (was `0.0`).
- Full `reply find` with LLM scoring: top lead "How Do You Actually Use Obsidian
  Every Day?" → score 0.680 (rel 0.8 / intent 0.9 / fit 0.7), freshness mix
  0.00–1.00 now fused into ranking.
- `tests/test_reddit_free.py` 4 passed; reddit_free + cascade + reply suites
  19 passed.

## Notes

- **Engagement** still requires a connected Reddit cookie (Connections) — RSS
  exposes no upvote/comment counts, so engagement stays 0 on the anonymous
  path. This is graceful and documented; the cookie tier returns full
  `score`/`num_comments`/`created_utc` and engagement then contributes.
- Overview's `graph_nodes`/`findings` KPIs read from the deeper graph/analyze
  build, which `refresh` doesn't run — they show 0 until a graph build runs.

## Files Modified

- `src/openreply/sources/reddit_free.py`
- `src/openreply/reply/opportunity.py`
- `tests/test_reddit_free.py`

## Files Created

- `changelogs/2026-06-27_20_recency-biased-fetch-ranking.md`
