# Collect source pipeline — fix 0-posts / mass-timeout throughput

**Date:** 2026-06-07
**Type:** Fix

## Summary

After the historical-crash fix, an aggressive `--skip-reddit` collect still tagged **0 posts** with 12–13 sources timing out at 90 s, even though every adapter returns data when run directly. Root causes were a cold-embedding-model stampede and a too-small total pool budget. After the fixes the same run tags **344 posts** with only the two genuinely-slow providers (Play Store, YouTube) falling off the tail.

## Root causes & fixes

1. **Embedding-model cold-load stampede.** The relevance gate embeds every persisted batch via a shared ONNX model cached in `embedder._EF_CACHE`. With 6 source workers starting cold, all 6 saw an empty cache and each loaded its own model simultaneously — turning a ~5 s cold start into 60–90 s of CPU/memory thrash that blew the per-pool timeout.
   - Added **double-checked locking** (`_EF_LOCK`) around the cache miss so exactly one thread pays the cold-load cost.
   - **Pre-warm** the embedder once on the main thread in `collect()` before any parallel pool starts (warms in ~1.1 s; verified in logs).

2. **Pool budget was a total wall-clock ceiling, not per-source.** `as_completed(ext_futures, timeout=90)` gives the WHOLE ~18-source pool 90 s; slow providers pinned workers and the valuable consumer sources (HN, App Store, Google News) were killed before persisting.
   - Raised default `OPENREPLY_SOURCE_TIMEOUT_SEC` 90 → **240** s.
   - Raised external-pool width 6 → **10** workers (new env `OPENREPLY_PARALLEL_SOURCES`), since these are I/O-bound.
   - Trimmed `run_playstore` default `reviews_per_app` 100 → **50** (the google-play scraper paginates ~1.4 s/review; 5×100 ran ~11 min and pinned a worker).

3. **`.env` parse noise.** Commented the free-text vision line in the root `.env` so `python-dotenv` stops emitting "could not parse statement" on every sidecar spawn.

## Verification

Same command (`research collect --topic "Brainwave meditation app…" --aggressive --skip-reddit`): before = 0 posts / 13 timeouts; after = **344 posts tagged / 2 timeouts** (playstore, youtube). Embedder logged "warmed in 1.1s".

## Files Modified

- `src/openreply/retrieval/embedder.py` — `_EF_LOCK` + double-checked locking in `get_embedding_function`.
- `src/openreply/research/collect.py` — pre-warm embedder before pools; `_PARALLEL_SOURCES` 6→10 (env-tunable); `OPENREPLY_SOURCE_TIMEOUT_SEC` default 90→240.
- `src/openreply/sources/collect_adapter.py` — `run_playstore` `reviews_per_app` 100→50.
- `.env` — commented the prose vision line.

## Known follow-up (P2)

The external `ThreadPoolExecutor` uses non-daemon threads, so after the 240 s logical budget the CLI process can linger until a slow in-flight adapter (e.g. Play Store) returns naturally. The Tauri sidecar isn't affected (it's killed), but a CLI-only daemon-thread / hard-cancel pass would tidy this.
