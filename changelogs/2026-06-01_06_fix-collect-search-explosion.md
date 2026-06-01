# Fix: collect "stuck on query expansion" — cap + parallelize Reddit search, timebox external sources

**Date:** 2026-06-01
**Type:** Fix

## Summary

Collects were taking 15+ minutes and appearing frozen at the
`query expansion: N keywords → M unique queries` log line. The line is the
*start* of the Reddit search stage, not keyword discovery — and that stage was
the real bottleneck. It ran every `(query template × keyword × target sub)`
combination **sequentially on the main thread with a hardcoded 2 s sleep after
each call**. With 24 templates × 6 keywords = 144 unique queries, and
`sub_scope_search=True` (the default, never disabled by aggressive mode)
multiplying by every discovered sub (~12), that is ~1,700 sequential Reddit
searches × ~4 s ≈ over an hour for any topic where subs are found. Separately,
the parallel external-source pool (16 sources) was drained with no timeout, so
a single slow provider (yt-dlp YouTube, pytrends, pubmed) could hang the whole
collect for minutes.

Fix is the "Balanced" option: search r/all instead of per-sub (kills the
×N-subs multiplier — r/all already covers every sub), cap the total executed
queries to a budget chosen round-robin across keywords + categories,
parallelize the search through a bounded thread pool with light per-request
pacing, and timebox the external-source drain. Expected wall-time on a normal
topic drops from ~15 min (or ~1 hr worst case) to ~1–2 min, with minimal recall
loss. All limits are env-configurable.

## Changes

- **Capped query budget**: new `_build_search_worklist()` picks up to
  `GAPMAP_MAX_SEARCH_QUERIES` (default 24) distinct `(category, query)` pairs
  round-robin across keywords AND categories, so a small budget keeps breadth
  (pain/features/complaints/diy across all keywords) instead of front-loading
  one category.
- **Search r/all by default**: `targets` is now `[None]` (r/all) unless
  `sub_scope_search` is set AND `GAPMAP_SEARCH_SUB_CAP > 0`, in which case it
  scopes to the top N subs only. Removes the catastrophic ×(all subs) multiplier.
- **Parallelized search stage**: searches now run through a
  `ThreadPoolExecutor` (`GAPMAP_SEARCH_WORKERS`, default 4) with a light 1.0 s
  per-request pace inside each worker (PRAW self-throttles in auth mode),
  replacing the per-iteration 2 s serial sleep.
- **Timeboxed external-source drain**: the `as_completed` drain now uses an
  overall `GAPMAP_SOURCE_TIMEOUT_SEC` budget (default 90 s); sources that don't
  finish are logged as timed-out and the pool is shut down with
  `wait=False, cancel_futures=True` so stragglers can't hang the collect.
- Updated the module step-3 docstring + added an env-knob reference comment.

## Env knobs (new, all optional)

| Var | Default | Effect |
|---|---|---|
| `GAPMAP_MAX_SEARCH_QUERIES` | 24 | Max distinct search queries executed |
| `GAPMAP_SEARCH_WORKERS` | 4 | Concurrent Reddit search workers |
| `GAPMAP_SEARCH_SUB_CAP` | 0 | Extra top-N subs to scope to (0 = r/all only) |
| `GAPMAP_SOURCE_TIMEOUT_SEC` | 90 | Overall wait budget for external-source pool |

## Files Modified

- `src/gapmap/research/collect.py` — imports (`itertools`,
  `TimeoutError as FuturesTimeout`); new `_env_int` / `_env_float` /
  `_build_search_worklist` helpers + `_SEARCH_PACING`; rewrote stage-3 search
  loop to be budgeted + parallel; timeboxed the external-source drain; docstring.

## Verification

- `ast.parse` + `importlib` import of the module: OK.
- Isolated `_build_search_worklist` test: budget 24 → 24 distinct queries,
  6 per category, all 6 keywords represented.
- `pytest tests/ -k "collect or search"`: 3 passed.

## Notes

- Sidecar rebuild required for the bundled DMG to pick this up
  (`pyinstaller <spec>` → copy → `codesign --force --deep --sign -`). Dev mode
  (`.venv/bin/python`) reflects it immediately.
