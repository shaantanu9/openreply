# Collect: cut 15-min first-collect — tighten aggressive historical backfill

**Date:** 2026-06-02
**Type:** Performance

## Root cause

The New-topic modal defaults Aggressive=ON. Aggressive enabled a pullpush
historical backfill of **3 years × 1000 posts/sub × ALL discovered subs (~10-14)**,
run sequentially on the main thread. Pullpush is one slow, rate-limited host, so
this ~10,000-post backfill was ~80% of the ~15-min first collect — and the
corpus only displays after the whole collect "completes."

## Changes (`src/openreply/research/collect.py`)

- Aggressive historical scope: `historical_days` 1095→**365** (3yr→1yr),
  `historical_limit_per_sub` 1000→**150**.
- Cap historical to the **top 5 discovery-ranked subs** (env `HISTORICAL_MAX_SUBS`).
- Net: historical posts ~10,000 → ~750 (~13× less) → historical stage ~10 min → <1 min.
  With the LLM prewarm (canonicalize cold start) + existing parallel source
  fetch, first collect should land ~15 min → ~3-4 min.

## Still to do (the rest of the user's ask — bigger changes)

- **Stream the corpus into the topic detail live** as posts are tagged
  (`topic_posts` already fills incrementally) instead of waiting for "done."
- **Background "deepen" pass** — kick the full historical/all-sub sweep AFTER
  the fast collect returns, so deep data keeps accruing without blocking.
- Auto-start collect on topic enter + show a live, growing corpus.
