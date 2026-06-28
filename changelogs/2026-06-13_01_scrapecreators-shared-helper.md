# ScrapeCreators Shared Request Helper

**Date:** 2026-06-13
**Type:** Feature

## Summary

Added a shared HTTP helper module for the ScrapeCreators REST API. The four upcoming adapters (TikTok, Instagram, Threads, Pinterest) all authenticate with a single `SCRAPECREATORS_API_KEY` header. Centralising key lookup, error-row generation, and the `GET` wrapper here prevents duplication across all four files.

## Changes

- Created `src/openreply/sources/_scrapecreators.py` with `api_key()`, `error_row()`, and `get()` helpers
- Created `tests/test_scrapecreators_helper.py` with 3 TDD tests covering missing-key, error-row shape, and header injection

## Files Created

- `src/openreply/sources/_scrapecreators.py`
- `tests/test_scrapecreators_helper.py`

## Files Modified

None
