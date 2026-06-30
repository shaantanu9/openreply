# Daily Update — product + persona aware, all sources, true daily delta

**Date:** 2026-06-30
**Type:** Fix/Feature

## Summary

The Overview **Daily Update** now fetches and surfaces updates that are:

1. **Product- and persona-aware** — the daily source sweep folds in the agent's
   `product`, `brand`, `persona`, and `keywords`, and the LLM briefing prompt
   includes the persona/voice, so the digest is about *your* product, not just
   the niche topic.
2. **From all relevant sources** — the digest collector now uses the full
   categorized source set (news, articles, community, research, plus product
   signals like App/Play Store, Trustpilot, Product Hunt, RSS listings) plus any
   connected Reach sources (X, LinkedIn, Mastodon, YouTube, etc.).
3. **A true daily delta** — feed items are filtered to "new since yesterday /
   since the last digest", and anything already shown in the previous day's
   digest is excluded. If the fresh delta is thin, it gracefully widens to the
   last 3 days but still skips yesterday's items.
4. **No stale localStorage paint** — the cached client digest is only used if
   its `day` matches today, so users never see yesterday's briefing after
   midnight.

## Changes

- `src/openreply/research/collect.py` — new `extra_keywords` parameter. Caller-
  supplied terms are merged into the per-source keyword fan-out without
  interfering with canonical topic discovery.
- `src/openreply/reply/digest.py`:
  - Expanded `CATEGORY_SOURCES` with product/review/launch signals.
  - Added `_agent_extra_keywords()` to inject product/brand/persona/keywords
    into the daily collect.
  - Added `_digest_sources_for_agent()` to include connected Reach sources.
  - Added daily-delta bookkeeping: previous-day digest lookup, `exclude_ids`,
    and `fresh_since`.
  - Rewrote `_fresh_items()` with `since_utc`, `exclude_ids`, and a 3-day
    fallback, guaranteeing the feed is fresh-first but never empty.
  - `_goal_block()` now includes the agent's `persona` / `tone`.
  - `build_digest()` passes the extra keywords and per-agent source list to
    `collect`, records `fresh_since` and `expanded` in `sources_json`.
- `src/openreply/reply/relevance.py` — the relevance-gate prompt now includes
  the agent's product/brand, goal, persona/voice, and keywords, so future
  fetched items are judged against the *agent*, not just the raw topic.
- `app-tauri/src/or/dynamic.js` — `loadCachedDigest()` now discards any cached
  digest whose `day` is not today.

## Verification

- `.venv/bin/python -m pytest tests/test_digest.py -v` → 6 passed.
- `.venv/bin/python -m pytest tests/test_cli_collect_growth.py -v` → 3 passed.
- `node --check app-tauri/src/or/dynamic.js && node --check app-tauri/src/or/api.js` → clean.
- `openreply reply digest --no-collect --json` returns a valid cached digest.
