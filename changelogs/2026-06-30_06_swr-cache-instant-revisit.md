# Instant page revisits — widen the SWR read cache

**Date:** 2026-06-30
**Type:** Performance

## Summary

Revisiting a screen (open page → go elsewhere → come back) took just as long as
the first load on several screens. The app already has a stale-while-revalidate
(SWR) cache in `api.js` whose whole purpose is "return the last-known result
instantly and refresh in the background," but its `SWR_READS` allow-list was
incomplete. Any screen whose primary read wasn't listed bypassed the cache and
re-spawned the Python sidecar (cold spawn ≈ seconds) on **every** visit. This
adds the missing primary reads so every screen's data returns instantly on
revisit, with the background refresh keeping it current.

## Changes

- Added the following commands to `SWR_READS` in `api.js`:
  - `agent_corpus` (Library), `agent_task_list` (Tasks), `agent_playbook_get`
  - `reply_source_counts`
  - `creds_list` (Connections), `x_account_list` (X Account)
  - `schedule_status`, `mcp_clients`, `mcp_status`, `publish_status`,
    `notify_get`, `palace_model_status`, `palace_stats`, `export_prefs_get`,
    `extraction_prefs_get` (Settings sub-cards)
  - `cli_info`, `cost_model_get` (immutable — no setter)
- Verified each newly-cached read's write family matches its read family
  (`creds_`/`x_account_`/`schedule_`/`mcp_`/`publish_`/`notify_`/`palace_`/
  `export_`/`extraction_`, and `agent_` for the agent-scoped reads), so
  `_invalidateForWrite` busts them automatically — no stale-after-write.
  Deliberately left freshness-sensitive ops uncached: `today_token_spend`,
  `agent_digest`, and the explicit "check now" ops (`sub_intel`, `geo_check`).
- Extended `prewarm()` in `main.js` to warm `creds_list`, `agent_task_list`,
  `agent_corpus`, and `x_account_list` after the landing screen paints, so the
  *first* visit to those screens after launch is also instant.
- Verified with `vite build` (clean).

## Files Modified

- `app-tauri/src/or/api.js` — expanded the `SWR_READS` set.
- `app-tauri/src/main.js` — added the four full-screen reads to `prewarm()`.
