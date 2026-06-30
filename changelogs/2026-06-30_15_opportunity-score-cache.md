# Warm-cache LLM opportunity scores

**Date:** 2026-06-30
**Type:** Performance

## Summary

LLM scoring was the dominant cost of "Find opportunities" (~one LLM call per
post, up to 30, re-scored on every run — ~40s of the wait). This adds a per-post
score cache so a warm re-run reuses scores it already computed instead of paying
the LLM round-trips again, cutting repeat runs toward near-instant scoring. The
cache invalidates correctly: a `content_hash` guards each post's text and a
`brand_sig` (name + description + keywords) guards the agent's scoring identity,
so an edited post or a changed agent re-scores automatically.

## Changes

- **Schema** (`schema.py`): new idempotent `reply_score_cache` table
  (id = the opportunity oid; columns: score/relevance/intent/fit/reason +
  `content_hash`, `brand_sig`, `scored_at`) with a `brand_id` index.
- **Scoring** (`opportunity.py`):
  - Added `_content_hash(post)` and `_brand_sig(brand)` fingerprints.
  - `find_opportunities` pre-loads cached scores for the capped candidate set in
    one query **on the main thread** (SQLite isn't thread-safe; the parallel
    `_build` workers only read the in-memory dict — no DB access in threads).
  - `_build` reuses a cached score when both `content_hash` and `brand_sig`
    match; otherwise it calls `_score` and tags the row as fresh.
  - After the parallel scoring pass, freshly-computed scores are written back to
    the cache (main thread). Temp fields (`_chash`, `_cached`) are stripped
    before the `reply_opportunities` upsert.
  - The `scoring` progress event now carries a `cached` count.
- **Frontend** (`dynamic.js`): the live scan panel shows "· N reused" on the
  scoring row so a warm re-run visibly communicates the speedup.

## Files Modified

- `src/openreply/reply/schema.py` — `reply_score_cache` table.
- `src/openreply/reply/opportunity.py` — fingerprints, cache pre-load, cache-aware `_build`, write-back.
- `app-tauri/src/or/dynamic.js` — show reused-count in `scanPanel`.

## Notes

- Cache lookup is a single `IN (...)` query bounded by `SCORE_CAP` (30) — well
  under SQLite's parameter limit.
- Gather (platform fetch, ~35s budget) is unchanged; this targets only the
  scoring half. Cold first runs are unaffected; warm re-runs of the same posts
  skip the LLM entirely.
