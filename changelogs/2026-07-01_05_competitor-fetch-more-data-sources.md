# Competitor opportunity fetch now pulls from many more data sources

**Date:** 2026-07-01
**Type:** Fix

## Summary

The Competitor Intelligence "fetch opportunity" (competitor sweep) was only
returning data from 3 databases (App Store, Play Store, Reddit) even though the
default pack listed 8. Diagnosis found three distinct root causes: a silent
key mismatch that dropped Hacker News from every sweep, a redirect bug that made
Google News return nothing, and a default pack loaded with credential-gated /
Cloudflare-blocked sources. Fixed all three and added a source health-check so
the failure reason is now explicit instead of a silent zero. For the same hard
test term ("Notion"), working sources went from **3 → 6**, and the pack now
reliably fans out to 12 databases.

## Root causes found (per-source diagnosis)

- **Hacker News — silently dropped.** `DEFAULT_SOURCE_PACK` used the id
  `"hackernews"`, but the collect adapter registers it as `"hn"`. `collect()`
  logged it as an "unknown source" and skipped it on every sweep.
- **Google News — 302 with empty body.** `gnews` called `httpx.get` without
  `follow_redirects`, so Google News RSS's regional/consent redirect returned an
  empty body → 0 entries every time.
- **Default pack was poorly chosen.** It shipped `alternativeto` (Cloudflare
  403-blocks unauth clients), `trustpilot` (Cloudflare 403 from most IPs), and
  `producthunt` (needs `PH_TOKEN`) — three of eight slots that reliably return 0
  — while omitting the fast/free/reliable sources the main `collect()` already
  uses (Dev.to, DuckDuckGo, Google News, RSS bundles).
- **Frozen configs.** Competitors added before the fix have the stale 8-source
  pack (with the broken `hackernews` key + `alternativeto`) baked into
  `source_config_json`, so fixing the default alone wouldn't heal them.

## Changes

- Added a `"hackernews" → run_hn` alias in `sources.collect_adapter.SOURCES` so
  the id resolves everywhere, including already-frozen competitor configs.
- Fixed `gnews.fetch_gnews` to pass `follow_redirects=True` (verified: 0 → 10
  rows).
- Rebuilt `DEFAULT_SOURCE_PACK` (8 → 12) into two tiers: high-signal customer
  feedback (appstore, playstore, trustpilot, producthunt) + fast-free-reliable
  (hn, reddit_free, stackoverflow, devto, gnews, duckduckgo, rss_products,
  rss_listings). Dropped `alternativeto` from the default (kept opt-in).
- Added `sweep._resolve_sources()` which auto-upgrades competitors still carrying
  the exact legacy default pack, and filters any unregistered id so it can't be
  dropped as "unknown source".
- Added `competitor_intel/health.py` with a typed status vocabulary
  (ok / empty / needs_credential / blocked / unregistered / error), borrowed from
  the last30days-skill `health.py`, so each source reports why it returned what
  it did.
- Exposed the check via CLI (`competitor sources-health`) and MCP
  (`openreply_competitor_sources_health`).

## Verified (live probe, keyword "Notion")

working 6/12 — appstore(41), playstore(6), hn(22), reddit_free(6), gnews(20),
duckduckgo(20) return data; producthunt=needs_credential(PH_TOKEN),
trustpilot=blocked(403); stackoverflow/devto/rss_* return 0 for this specific
English-word term (relevance-gated / off-domain), not broken.

## Files Created

- `src/openreply/research/competitor_intel/health.py` — per-source health check
- `tests/test_competitor_sources.py` — source-resolution + health regression tests

## Files Modified

- `src/openreply/sources/collect_adapter.py` — `hackernews` alias in SOURCES
- `src/openreply/sources/gnews.py` — `follow_redirects=True`
- `src/openreply/research/competitor_intel/registry.py` — rebuilt DEFAULT_SOURCE_PACK
- `src/openreply/research/competitor_intel/sweep.py` — `_resolve_sources()` + healing
- `src/openreply/research/competitor_intel/__init__.py` — export health helpers
- `src/openreply/cli/competitor_cmds.py` — `sources-health` command
- `src/openreply/mcp/tools/competitor_tools.py` — `openreply_competitor_sources_health` tool
