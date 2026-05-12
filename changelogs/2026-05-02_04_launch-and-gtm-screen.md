# Launch & GTM screen — target audience, demographics, channels, market requirements

**Date:** 2026-05-02
**Type:** Feature

## Summary

Adds a per-topic Go-to-Market screen at `#/launch/<topic>` that
synthesizes everything the app already collects into one actionable
brief: who the product is for, what their demographics look like,
where to launch (ranked channels + best post window), what to ship
(MVP feature list with RICE/Kano/MoSCoW), pricing recommendations
(VW/PMF/NPS aggregates), and a 3-step launch sequence with success
metrics.

Two-pass design — deterministic SQL produces a usable brief offline
(no LLM key required), then optional LLM augmentation refines
personas, infers demographics, scores channel fit, suggests external
platforms (ProductHunt / HN / Twitter / Discord / dev.to), and writes
the launch sequence. Failures degrade silently — the screen always
renders.

Persisted to `launch_briefs(topic)` so re-opens are instant; an MCP
tool (`reddit_launch_brief`) lets agents trigger and read the same
artefact.

## Changes

### Backend

- **`src/reddit_research/research/launch.py`** (new) — `build_launch_brief(topic, llm=True, provider, persist=True)` and `get_launch_brief(topic)`. Deterministic-first design with optional LLM augmentation. Always returns a stable schema dict; LLM failures degrade silently.
- **`src/reddit_research/cli/main.py`** — two new `research` subcommands: `launch-brief --topic …` and `launch-brief-get --topic …`.
- **`src/reddit_research/mcp/server.py`** — `reddit_launch_brief(topic, llm=True, provider=None)` (timeout-wrapped, async-job-recommending) + `reddit_launch_brief_get(topic)` for cached reads.

### Tauri

- **`app-tauri/src-tauri/src/commands.rs`** — `launch_brief` and `launch_brief_get` commands wrap the Python sidecar.
- **`app-tauri/src-tauri/src/main.rs`** — registered both in `generate_handler!`.

### Frontend

- **`app-tauri/src/api.js`** — `api.launchBrief(topic, {llm, provider})` and `api.launchBriefGet(topic)`.
- **`app-tauri/src/screens/launch.js`** (new) — picker + topic screen using the same primitives as PMF / OST: slash crumbs, `topbar-spacer`, `stat-grid` (top persona / geography / top channel / best post window), `two-col` (personas + demographics, MVP + pricing), `topic-grid` of channel cards (each linkable to the actual sub), external-channels card, launch-sequence list. Build/Re-generate buttons offer offline (deterministic only) and AI (with LLM augmentation) paths.
- **`app-tauri/src/main.js`** — added `renderLaunch` import + two routes (`/launch` picker, `/launch/<topic>` brief) + eye-icon explainer slug.
- **`app-tauri/index.html`** — sidebar entry "Launch & GTM" with rocket icon, immediately after "Pricing Surveys".

## Files Created

- `src/reddit_research/research/launch.py`
- `app-tauri/src/screens/launch.js`

## Files Modified

- `src/reddit_research/cli/main.py`            — 2 new subcommands
- `src/reddit_research/mcp/server.py`          — 2 new tools
- `app-tauri/src-tauri/src/commands.rs`        — 2 new Tauri commands
- `app-tauri/src-tauri/src/main.rs`            — registered both
- `app-tauri/src/api.js`                       — 2 new helpers
- `app-tauri/src/main.js`                      — route + explainer mapping
- `app-tauri/index.html`                       — sidebar entry
