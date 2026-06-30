# Agents card — per-agent stats row + full action set (restore rich card)

**Date:** 2026-06-29
**Type:** Feature

## Summary

Rebuilt the Agents page cards to match the intended design: each card now shows a
**stats row** (posts collected · brain nodes · open opportunities) and the full
action set — **Make active** (inactive only), **Find replies**, **Create
content**, **Open →** — with Edit/Delete preserved as compact icon buttons in the
card header.

## Forensic note (why it was "missing")

Pickaxe across all branches showed the stats row and the "Open" button were never
present in any committed `agentCard` (and `list_agents()` never returned per-agent
counts) — so they weren't removed by a PR; they were a design that was never
wired. The one genuine regression: commit `977d16b` had a **Create content**
button on the card that commit `abe55ef` replaced with Edit/Delete. This change
restores Create content and adds the never-wired stats + Open.

## Changes

- **Backend:** `list_agents()` now attaches per-agent `posts`
  (`topic_posts`), `graph_nodes`, and `opps` (`reply_opportunities` where
  `brand_id = agent id AND status='new'`) via a local `_count` helper.
- **Frontend:** rewrote `agentCard` — stats row with lucide icons + `fmtCount`
  (k-formatting), action buttons, and icon Edit/Delete in the header. The three
  nav actions (Find replies / Create content / Open →) use `data-go`/`data-to`:
  they make the card's agent active first, then navigate, so the destination
  screen always operates on the right agent.

## Stats delivery fix (SWR staleness)

`agent_list` is an SWR-cached read, so the Agents page painted a cached response
saved *before* the stats fields existed — rendering 0s and never repainting.
Fixed by adding a cache-busting `_freshRead` in `api.js` and an
`agentList(fresh)` flag; `renderAgents.load()` now paints the cached list
instantly, then repaints with a fresh fetch so per-agent stats are always
current. (Backend verified: seeded agent returns `posts:5, graph_nodes:5,
opps:1`.) Note: a packaged build must rebuild the PyInstaller sidecar to pick up
the `list_agents()` change; dev runs the live `.venv` CLI per invocation.

## Files Modified

- `src/openreply/reply/agent.py` — `list_agents()` returns `posts`/`graph_nodes`/`opps`.
- `app-tauri/src/or/dynamic.js` — `agentCard` rebuilt + `fmtCount` helper + `data-go` nav wiring; `load()` split into `paintAgents()` + cached-then-fresh repaint.
- `app-tauri/src/or/api.js` — `_freshRead` cache-busting read + `agentList(fresh)` flag.

## Verification

- `python -m py_compile src/openreply/reply/agent.py` → OK.
- Functional: `list_agents()` returns `posts`/`graph_nodes`/`opps` (verified on a fresh agent).
- `npm run build` (vite) → built, no JS errors.
