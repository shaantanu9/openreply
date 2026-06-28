# Parallel multi-source collect (Option A)

**Date:** 2026-04-19
**Type:** Feature / Performance

## Summary

The "extra sources" stage of `research collect` (HN / arXiv / GitHub / DevTo / Lemmy / Mastodon / OpenAlex / PubMed / Scholar / StackOverflow / App Store / Play Store / gnews / trends / etc. — 15 provider adapters in total) used to run strictly sequentially with a 2-second sleep between every fetch. Collecting 8 sources took 8 × (fetch + 2s) minimum. That stage now fans out across a `ThreadPoolExecutor(max_workers=6)`, each worker hitting a different provider concurrently. Reddit-facing stages (top-of-month/year, parameterized searches, historical pullpush) stay sequential because Reddit's rate limits are aggressive and public-mode users can be throttled by hitting the API from multiple threads.

Expected real-world speedup for aggressive-mode collects: **4–6× on the extra-sources stage** (from e.g. 120s → 25s for 8 sources averaging 15s each).

## Changes

### Orchestrator (`research/collect.py`)
- Added `ThreadPoolExecutor(max_workers=_PARALLEL_SOURCES=6)` around the `for src in sources:` loop. Each worker emits `[src] starting…` then `[N/M] [src] ✓ n posts (Xs)` on completion.
- Switched progress logging to a `threading.Lock()`-protected closure so parallel workers can't interleave stdout lines mid-message.
- Removed the per-source `time.sleep(_SLEEP)` inside the parallel stage — each thread's rate limit belongs to its own provider, and the pool's bounded concurrency is the new politeness knob.
- Up-front validation of unknown source names — fails fast with a clear error instead of starting a pool of workers that will error late.
- Bounded accumulation onto `result.posts_fetched` / `result.by_source` / `result.errors` under the same lock.
- Unchanged: Reddit top-posts loop, parameterized-search loop, historical-pullpush loop all remain sequential.

### DB layer (`core/db.py`)
- Replaced `@lru_cache(maxsize=1)` on `get_db()` with a `threading.local()` cache. Every worker thread now gets its own `sqlite_utils.Database` instance (raw sqlite3 connections are not thread-safe — they raise "SQLite objects created in a thread can only be used in that same thread" otherwise).
- Set `PRAGMA journal_mode=WAL` + `PRAGMA busy_timeout=5000` on every new connection. WAL lets concurrent readers never block and concurrent writers serialize on a 5-second filesystem lock, absorbing any race between threads inserting into `posts` or `topic_posts` at the same instant.
- `init_schema()` is now gated by a process-wide lock and a module-level flag so it runs exactly once, not once per thread. Worker threads that create their Database after init just get the existing schema.
- Added a `get_db.cache_clear` shim for back-compat with the existing test that monkey-patches `REDDIT_MYIND_DATA_DIR` and expects to invalidate the cached DB.

## Verification

```
$ .venv/bin/python -c "<16-thread parallel upsert>"
rows written by 16 parallel threads: 16
PASS
```

```
$ .venv/bin/python -m pytest -x -q
27 passed, 1 skipped in 2.81s
```

No "database is locked" errors, no "SQLite objects in different thread" errors, no regressions.

## Trade-offs and non-goals

- Reddit fetches stay sequential on purpose (public-mode rate limits are ~60 req/min; splitting that budget across threads causes 429s).
- `max_workers=6` is a soft default; providers that take 30+ seconds individually dominate wall-clock time regardless. The pool only helps when you have ≥2 independent slow providers.
- No per-domain token bucket yet — relies on each provider's adapter to handle its own retries. If one source starts rate-limiting in the future, that adapter is the right place to add backoff, not the orchestrator.

## Files Modified

- `src/reddit_research/research/collect.py` — ThreadPoolExecutor stage, thread-safe `_log`, lock-guarded result mutation, removed in-loop sleep, `_PARALLEL_SOURCES=6` constant
- `src/reddit_research/core/db.py` — thread-local DB instances, per-connection WAL + busy_timeout PRAGMAs, global schema-init lock + flag, `cache_clear` back-compat shim
