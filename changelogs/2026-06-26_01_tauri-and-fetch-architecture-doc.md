# Tauri & Reddit/Multi-Source Fetch Architecture Guide

**Date:** 2026-06-26
**Type:** Documentation

## Summary

Authored a deep, from-scratch architecture guide explaining (1) how the Tauri 2
desktop app is wired (frontend ↔ Rust ↔ Python sidecar, daemon/streaming/one-shot
spawn strategies, the api.js caching layer, SQLite data flow) and (2) how subreddits
and posts get fetched without the official Reddit API (the PRAW→cookie→RSS tier
cascade, subreddit discovery + LLM canonicalization, the collect orchestrator, and
the two-phase foreground/background collect). The doc closes with a concrete plan for
repurposing this fetch-and-bridge architecture into a social-media content-creation
tool (adding an outbound `publish/` half mirroring the inbound `sources/` adapters).

Built by mapping the codebase with three parallel Explore agents (Tauri Rust/JS,
Reddit fetch pipeline, and source catalog/CLI/credentials), with all claims cited to
`path:line`.

## Changes

- Documented the command registration triangle (commands.rs ↔ main.rs generate_handler ↔ api.js invoke)
- Documented the three sidecar execution strategies (warm daemon, one-shot, streaming) and the dev `.venv` Gatekeeper bypass
- Documented api.js: in-flight dedup, TTL + localStorage SWR cache, timeout wrapper, mutation invalidation, db_mtime freshness poller
- Documented the Reddit tier cascade, reddit_free.py cookie/RSS path, discover_subs + topic canonicalization, and collect() phases
- Documented the ~61-source adapter contract and the Reach Connections credential store
- Added a "Repurposing for a social-media content-creation tool" section (reuse map, outbound publish layer, content model, generation loop, first milestone, relevant skills)

## Files Created

- `docs/architecture/TAURI_AND_FETCH_ARCHITECTURE.md` — the architecture guide
- `changelogs/2026-06-26_01_tauri-and-fetch-architecture-doc.md` — this entry
