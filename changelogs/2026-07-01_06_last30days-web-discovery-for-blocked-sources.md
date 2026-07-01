# Cloudflare-blocked sources revived via last30days web-search discovery

**Date:** 2026-07-01
**Type:** Fix

## Summary

Two competitor sources — AlternativeTo and Trustpilot — were reliably returning
0 rows because both front-end their data behind Cloudflare bot protection (HTTP
403 to unauthenticated clients). Rather than fight the anti-bot wall, both now
fall back to free web-search discovery, porting the deterministic entity-mining
approach from the `last30days-skill` `competitors.py`. AlternativeTo now surfaces
real peer products (Obsidian, Airtable, Slite, Coda for "Notion"); Trustpilot now
surfaces review/complaint signal (G2, Capterra, PCMag, Forbes review articles).
Both work keyless.

## Changes

- Added `sources/_peer_entities.py` — ported last30days `competitors.py`
  brand-shaped entity extraction: bag-of-phrases frequency scoring over SERP
  titles+snippets, with stopword/self/publisher/domain filtering. Deterministic,
  no LLM, no API key.
- Rewrote `sources/alternativeto.py`: tries the (Cloudflare-blocked) API first
  with a short timeout, then falls back to web-search discovery over
  "{product} alternatives / competitors / vs" using the already-working
  DuckDuckGo + Google News fetchers.
- Added a web-search review fallback to `sources/trustpilot.py`: when the
  Cloudflare-gated site blocks the direct fetch, mine review signal from
  "{brand} reviews / complaints / problems" web searches so the customer-
  complaint signal keeps flowing instead of returning 0.
- Re-added `alternativeto` to `DEFAULT_SOURCE_PACK` (now working) under a new
  competitor-discovery tier; removed both `alternativeto` and `trustpilot` from
  the health check's `_KNOWN_BLOCKED` set (they now have fallbacks).

## Verified

- alternativeto("Notion") → 10 rows incl. Obsidian, Airtable, Slite, Coda
- trustpilot("Notion") → 8 review-article rows (G2, Capterra, PCMag, Forbes)
- deterministic extractor unit tests pass (fixed SERP fixtures)

## Files Created

- `src/openreply/sources/_peer_entities.py` — SERP entity extractor
- `tests/test_peer_entities.py` — deterministic extraction tests

## Files Modified

- `src/openreply/sources/alternativeto.py` — web-search fallback + API best-effort
- `src/openreply/sources/trustpilot.py` — web-search review fallback
- `src/openreply/research/competitor_intel/registry.py` — re-add alternativeto to pack
- `src/openreply/research/competitor_intel/health.py` — shrink `_KNOWN_BLOCKED`
- `tests/test_competitor_sources.py` — update legacy-pack upgrade assertion
