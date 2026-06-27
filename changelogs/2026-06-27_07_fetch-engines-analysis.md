# Fetch engines analysis — last30days-skill + web-edge-engine vs OpenReply

**Date:** 2026-06-27
**Type:** Research | Documentation

## Summary

Analyzed two external research/fetch engines in detail and verified both run keyless,
then documented how they relate to OpenReply's current gapmap fetch layer with a
keep/adopt recommendation.

## Changes

- `docs/research/FETCH_ENGINES_ANALYSIS.md` — detailed analysis of last30days-skill
  (Python: 18 sources, planner→fetch→RRF+LLM rerank→cluster→brief, engagement scoring,
  cookie/binary desktop sources, SQLite store/watchlist, Go MCP) and its web-edge-engine
  (portable TS, 4 keyless sources, Next.js + Supabase Edge SSE, Tauri port guide), a
  head-to-head vs gapmap, and the recommendation: keep gapmap as the backbone; adopt
  last30days' engagement-weighted RRF ranking + cross-source clustering + desktop sources
  (X bird/yt-dlp via the Tauri port guide); use web-edge-engine as the blueprint for a
  future hosted/web OpenReply.

## Verified
- Python skill ran keyless (HN + Reddit, ranked clusters with engagement).
- web-edge-engine ran keyless via `node --experimental-transform-types driver.ts` (Reddit + DuckDuckGo).

## Files Created
- `docs/research/FETCH_ENGINES_ANALYSIS.md`
- `changelogs/2026-06-27_07_fetch-engines-analysis.md`
