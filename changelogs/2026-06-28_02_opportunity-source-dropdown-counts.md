# Opportunities source dropdown — per-source post + opportunity counts

**Date:** 2026-06-28
**Type:** Feature

## Summary

The Opportunities source filter showed a flat "All sources" + each platform name with
no numbers. Now every option shows **how many opportunities** that source has produced
and **how many posts** were fetched into the corpus from it — so you can see at a glance
which source has the most signal. Discovery-only sources (HN, Dev.to, Stack Overflow,
YouTube, DuckDuckGo, Google News) now also appear, not just reply-capable ones.

Example (live): `All sources (66 opp · 337 posts)` · `Reddit — 44 opp · 14 posts` ·
`Hacker News — 16 opp · 4 posts` · `YouTube — 273 posts` · `DuckDuckGo — 26 posts`.

## Changes

- **Backend** `reply/opportunity.py::source_counts()` — two grouped queries on the shared
  DB: opportunities per `platform` (active brand, excluding dismissed) and corpus posts
  per `source_type` (joined through `topic_posts` for the agent's topic). Returns
  `{opportunities:{src:n}, posts:{src:n}, total_opportunities, total_posts}`; never raises.
- **CLI** `openreply reply source-counts --json`.
- **Rust** `reply_source_counts` (+ `main.rs` registration).
- **JS** `api.replySourceCounts()`.
- **UI** (`renderOpportunities`): the `#op-src` dropdown is built from the UNION of the
  platform catalogue and every source that has data, **sorted by total signal**, each
  option labelled `<source> — <N> opp · <M> posts`; the "All sources" option shows totals.

## Verification

- `opportunity.py` + `reply_cmds.py` parse; `reply source-counts` returns real counts
  (66 opportunities / 337 posts across sources). `vite build` passes (328 KB).
  `cargo check` 0 errors.

## Files Modified

- `src/openreply/reply/opportunity.py`, `src/openreply/cli/reply_cmds.py`,
  `app-tauri/src-tauri/src/commands.rs` + `main.rs`, `app-tauri/src/or/api.js`,
  `app-tauri/src/or/dynamic.js`.
