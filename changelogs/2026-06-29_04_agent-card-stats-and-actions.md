# Agent card redesign — knowledge stats + new actions

**Date:** 2026-06-29
**Type:** UI Enhancement

## Summary

Reworked the agent card on the Agents screen to match the target design. The card
now shows a real knowledge-stats row (posts / brain nodes / opportunities), renders
source platforms with human-readable labels (with Reddit accented as the primary
source), and replaces the old `Edit` / `Delete` buttons with `Find replies`,
`Create content`, and `Open →`. Per-agent delete was moved to the agent Overview
page so no capability is lost.

## Changes

- `list_agents()` now returns per-agent `posts`, `graph_nodes`, and `opps` counts.
  Posts/nodes are topic-scoped (`topic_posts`, `graph_nodes`); opps are brand-scoped
  (`reply_opportunities.brand_id` == agent id). Counts are resilient (return 0 on error).
- New `agentCard()` layout: keyword chips → source chips → divider → stats row → actions.
- Added `SOURCE_LABELS` map + `_srcLabel()` so raw keys (`reddit_free`, `hn`, `devto`,
  `x`, …) render as `Reddit`, `Hacker News`, `Dev.to`, `X`, etc. Reddit is accented.
- Added `_compact()` number formatter (`5800` → `5.8k`, `142` → `142`).
- Card actions `Find replies` / `Create content` / `Open →` now set the card's agent
  active before navigating (these screens act on the active agent).
- Removed the card's `Edit` / `Delete` buttons; added a `Delete agent` action to the
  agent Overview header (`renderOverview`) with the same confirm modal, redirecting to
  `#/agents` after deletion. Editing remains available via `Open →` (Keywords/Settings).

## Files Modified

- `src/openreply/reply/agent.py` — `list_agents()` enriched with posts/graph_nodes/opps counts.
- `app-tauri/src/or/dynamic.js` — rewrote `agentCard()`, added `SOURCE_LABELS`/`_srcLabel`/`_compact`,
  replaced card action wiring with a single `data-go` handler, added `ov-delete` button + handler in `renderOverview`.
