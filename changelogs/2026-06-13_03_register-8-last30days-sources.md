# Register 8 last30days Sources in Collect Pipeline

**Date:** 2026-06-13
**Type:** Feature

## Summary

Wired the 8 Phase-1 social and prediction-market source adapters into the
collect pipeline so they are reachable from the `SOURCES` dispatch map. This
unlocks them for `--sources` flag routing and the UI source picker. The
`_run_simple_list` helper pattern was used for all 8, matching the existing
miroclaw-derived adapter convention exactly.

## Changes

- Added `run_polymarket`, `run_truthsocial`, `run_digg`, `run_tiktok`,
  `run_instagram`, `run_threads`, `run_pinterest`, `run_x` wrapper functions
  in `collect_adapter.py` (after `run_acled`, before the `SOURCES` dict)
- Registered all 8 in the `SOURCES` dict with inline key-requirement comments
- Added corresponding imports and `__all__` entries in `sources/__init__.py`
- Added `tests/test_new_sources_registered.py` (TDD: RED then GREEN)

## Files Created

- `tests/test_new_sources_registered.py`
- `changelogs/2026-06-13_03_register-8-last30days-sources.md`

## Files Modified

- `src/gapmap/sources/__init__.py` — 9 new import lines + 8 new `__all__` entries
- `src/gapmap/sources/collect_adapter.py` — 8 `run_*` functions + 8 `SOURCES` entries
