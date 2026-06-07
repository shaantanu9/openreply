# Fix: historical backfill crash when Reddit is skipped (`'NoneType' object is not subscriptable`)

**Date:** 2026-06-07
**Type:** Fix

## Summary

A collect run with no Reddit credentials (frontend sends `skip_reddit=True`) plus the aggressive preset (which forces `include_historical=True`) crashed with `TypeError: 'NoneType' object is not subscriptable` at `collect.py:855`. Root cause: the `skip_reddit and not subs` discovery branch set `result.subs = []` but never reassigned the local `subs` variable, leaving it `None`. The step-4 historical/pullpush block is gated only on `include_historical` (not `skip_reddit`), so it ran and evaluated `subs[:_hist_max]` on `None`.

## Changes

- In `collect()`'s `skip_reddit and not subs` branch, normalize the local `subs = []` (in addition to `result.subs = []`) so `subs` is never `None` downstream. With empty subs, the historical loop is a correct no-op (nothing discovered to backfill).
- Defense-in-depth: changed the historical loop to iterate over `(subs or [])[:_hist_max]` so any future path that leaves `subs` falsy cannot reintroduce the crash.

## Files Modified

- `src/gapmap/research/collect.py` — `collect()`: set local `subs = []` in the skip-Reddit branch (~line 638); guarded historical loop with `(subs or [])` (~line 855).
