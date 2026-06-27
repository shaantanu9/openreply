# Agent purpose (goal + product) + growth plan

**Date:** 2026-06-28
**Type:** Feature

## Summary

The agent now knows **why it exists** and **what it's growing**, and can turn
that into a strategy. Agent creation captures a **Goal** (what to achieve) and
**Product** (what you offer) alongside a rebuilt, sectioned form; drafts are
written toward the goal; and a new **Growth plan** generator produces a concrete
Reddit-first strategy (target communities, angles, cadence, KPIs, first steps).

## Changes

- **agent.py:** `goal` + `product` columns (+ migration); threaded through
  `create_agent`/`update_agent`. Also fixed `website` being dropped on create and
  a duplicate `platforms_json` key.
- **cli/agent_cmds.py:** `agent create/update` gain `--goal` / `--product`.
- **commands.rs / main.rs:** `agent_create`/`agent_update` accept goal + product;
  new `reply_growth_plan` / `reply_growth_get` commands (registered).
- **generate.py:** the draft prompt states the agent's growth goal + product, so
  replies advance the goal by being genuinely helpful first (never salesy).
- **reply/growth.py (new):** `generate_growth_plan()` — LLM turns goal + product +
  niche + keywords + tracked subs into a plan (summary, target_communities,
  angles, cadence, kpis, first_steps); persisted in `reply_growth`;
  `get_growth_plan()`.
- **cli/reply_cmds.py:** `reply growth-plan` / `growth-get`.
- **or/api.js:** `replyGrowthPlan` / `replyGrowthGet`; agentCreate/Update pass
  goal+product (already pass-through).
- **or/dynamic.js:** rebuilt `renderOnboarding` (Identity / Purpose / Voice /
  Targeting sections; Website + Goal + Product fields; selectable platform tiles
  with a live count; name + ≥1-platform validation). New `renderGrowth` screen
  (`#/growth`) — Generate plan → renders the strategy.
- **or/shell.js:** Growth nav link.

## Files Created

- `src/gapmap/reply/growth.py`
- `changelogs/2026-06-28_02_agent-purpose-growth-plan.md`

## Files Modified

- `src/gapmap/reply/agent.py`, `src/gapmap/reply/generate.py`,
  `src/gapmap/cli/agent_cmds.py`, `src/gapmap/cli/reply_cmds.py`
- `app-tauri/src-tauri/src/commands.rs`, `app-tauri/src-tauri/src/main.rs`
- `app-tauri/src/or/api.js`, `app-tauri/src/or/dynamic.js`, `app-tauri/src/or/shell.js`

## Verification

- Python (`.venv`): goal/product/website persist + update; growth plan returns
  all 6 sections from the configured LLM; graceful errors when no agent / no LLM.
- Rust: `cargo check` 0 errors (twice). Frontend: `vite build` clean.

## Notes

- A concurrent session was rewriting the shared files throughout; the contended
  `dynamic.js`/`shell.js` edits were applied atomically (splice + guard + commit
  in one step) after the Edit tool was repeatedly clobbered.
- The growth plan is a generated artifact persisted per agent — regenerate as the
  agent learns. It's strategy guidance, not auto-executed.
