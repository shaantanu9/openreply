# Add 9 miroclaw-derived data sources (pure-httpx, posts-row)

**Date:** 2026-06-07
**Type:** Feature

## Summary

Added the 9 external data sources miroclaw_jyotish has that Gap Map lacked —
GDELT, DuckDuckGo, Tavily, World Bank, FRED, BIS, Yahoo Finance, Open-Meteo, and
ACLED — re-implemented natively in Gap Map's source pattern. All are pure-`httpx`
(no `gdeltdoc`/`yfinance`/`wbgapi`/pandas), so **zero new dependencies** and no
PyInstaller-sidecar risk. Web/news sources map cleanly to the common `posts` row;
the numeric/macro sources (World Bank, FRED, BIS, yfinance, Open-Meteo) render each
datum as a text-summary post (miroclaw-style) so dedup/graph/sentiment/audience and
the future forecast engine read them unchanged. Key-gated sources (Tavily, FRED,
ACLED) degrade to `[]` cleanly when their env vars are unset. Skipped the 3 that
duplicate existing Gap Map sources (Google Trends → `fetch_trends`, Google News →
`fetch_gnews`, India RSS → `fetch_rss`).

Verified end-to-end: all 9 import; keyless sources return live rows and persist into
the `posts` table via the collect dispatch (worldbank 10, bis 6, openmeteo 6,
duckduckgo 6, yfinance 5 in a smoke run); GDELT works with a throttle retry. Topic
tagging correctly respects the relevance gate — off-domain macro/weather rows persist
but only attach to economically/market-relevant topics, so they don't pollute
unrelated corpora. Test data cleaned up afterward.

## Changes

- New shared row builder `text_row()` for the external sources (posts-row contract,
  `permalink=None`, real `created_utc`).
- 9 new fetchers: `fetch_gdelt`, `fetch_duckduckgo`, `fetch_tavily`, `fetch_worldbank`,
  `fetch_fred`, `fetch_bis`, `fetch_yfinance`, `fetch_openmeteo`, `fetch_acled`.
- GDELT throttle handling: one-shot 5s retry on empty/non-JSON (HTTP-200 throttle).
- Registered each in `sources/__init__.py`, the `collect_adapter.SOURCES` dispatch
  (with `run_*` wrappers), and as `@mcp.tool() gapmap_fetch_*` tools.
- Updated CLI `--sources` help to list the new sources + their key requirements.

## Files Created

- `src/gapmap/sources/_extra_common.py`
- `src/gapmap/sources/gdelt.py`, `duckduckgo.py`, `tavily.py`, `worldbank.py`,
  `fred.py`, `bis.py`, `yfinance_src.py`, `openmeteo.py`, `acled.py`
- `changelogs/2026-06-07_09_add-miroclaw-derived-sources.md` (this file)

## Files Modified

- `src/gapmap/sources/__init__.py` — import + `__all__` for the 9 fetchers.
- `src/gapmap/sources/collect_adapter.py` — 9 `run_*` wrappers + `SOURCES` entries.
- `src/gapmap/mcp/server.py` — 9 `gapmap_fetch_*` MCP tools.
- `src/gapmap/cli/main.py` — `--sources` help string updated.

## Fast vs aggressive placement (benchmarked)

Measured per-source latency to decide bucket placement:
- **DuckDuckGo** — 1.35s, 1 call, keyless, domain-relevant (web) → **added to the
  fast/quick default source set** (alongside hn/arxiv/devto/so/github/gnews).
- **GDELT** — 27–37s and 429-throttle-prone; tuned to fail-fast (10s timeout + one
  3s retry → ~12s typical, capped) → **added to the aggressive (slow) sweep only**,
  where sources run in parallel threads so its latency can't pin the pool. Returns
  [] gracefully on throttle.
- **worldbank (4s) / bis (5.7s) / openmeteo (2.4s) / yfinance (0.8s)** — multi-call
  and off-domain (relevance-gated out of normal topics) → **opt-in only via
  `--sources`**, not in any default sweep. Will be auto-added per finance/market
  topic once the topic→source router lands.
- **tavily / fred / acled** — key-gated → **opt-in only**.

## Known limitations / follow-ups

- Numeric sources use stable IDs (per country/series/symbol), so re-fetches
  update-in-place rather than accumulate history. For the forecast engine's
  time-series needs, switch to date-stamped IDs later.
- DuckDuckGo HTML and Yahoo chart endpoints are best-effort (anti-bot / rate-limit
  prone) → return `[]` on failure by design.
- Tavily/FRED/ACLED require env keys (`TAVILY_API_KEY`, `FRED_API_KEY`,
  `ACLED_EMAIL`+`ACLED_PASSWORD`); documented in CLI help.
