# GEO real citation check (Perplexity Sonar) + Analytics instant-load

**Date:** 2026-06-27
**Type:** Feature + Performance

## Summary

Upgraded AI Visibility (GEO) from a model-knowledge proxy to a **real,
search-grounded citation check** using **Perplexity Sonar** (the one major answer
engine with a clean API that returns the live web sources it cited). When a
Perplexity key is configured, a check now classifies the brand as cited /
competitor / absent by matching the agent's **website domain** against the
**actual cited source URLs**, captures those URLs, and computes **Share of
Voice** (you vs. named competitors). Without a key it gracefully falls back to
the existing direct-LLM check. Also fixed the page-loading slowness on the
Analytics screen (it wasn't in the SWR cache, so it re-paid the ~4-5s sidecar
spawn every visit).

## Changes

### GEO real check
- `reply/geo.py`: `_perplexity_sonar` (stdlib `urllib` POST to Sonar) returns
  answer + cited URLs; `_domain`/`_host` helpers; `_check_perplexity`
  (domain-match citation detection) and `_check_llm` (fallback); `check_query`
  routes through Perplexity when `PERPLEXITY_API_KEY` is set, else LLM. New
  `citations` + `engine` columns (guarded migration) on `geo_queries` /
  `geo_checks`. `list_queries` now returns `share_of_voice` + `top_competitors`.
- Agent **website** field: `agents.website` column (migration) + `create_agent`
  / `update_agent` passthrough; CLI `agent create/update --website`; Rust
  `agent_create` / `agent_update` pass `--website`.
- `PERPLEXITY_API_KEY` added to the `byok_set` allowlist (settable from the app).
- Frontend: GEO page shows a **Share of Voice** KPI, an **engine badge**
  (live web vs. model only) per query, **cited source URLs** (click → open), and
  a "Connect Perplexity" inline key form. Keywords page gains a **Website**
  field.

### Loading / performance
- `or/api.js`: added `analytics_summary` + `geo_history` to the SWR read cache;
  any reply/content/geo write now also busts the `analytics` roll-up.
- `main.js`: prewarm now warms `analyticsSummary` + `geoList` after landing.
  (Skeletons for both routes already existed.)

## Files Modified

- `src/openreply/reply/geo.py`, `src/openreply/reply/agent.py`,
  `src/openreply/cli/agent_cmds.py`
- `app-tauri/src-tauri/src/commands.rs` (agent website + byok perplexity)
- `app-tauri/src/or/api.js`, `app-tauri/src/main.js`, `app-tauri/src/or/dynamic.js`

## Verification

- Python: `check_query` falls back to LLM with no key (engine `llm`, citations
  `[]`); agent website set/get works; `_domain` parses hosts; `list_queries`
  returns `share_of_voice` + `top_competitors`.
- CLI `agent create --help` shows `--website`. `cargo check` — 0 errors.
  `node --check` clean on all four JS files.
- Real Perplexity path activates when `PERPLEXITY_API_KEY` is set (needs the
  user's key); ChatGPT-web-search + Google-AI-Overviews surfaces are documented
  follow-ups (need paid keys).
