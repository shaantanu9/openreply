# Fix redundant agent-listing screen on card "Open →"

**Date:** 2026-06-30
**Type:** Fix

## Summary

The Agents listing (`#/agents`, rendered by `renderAgents`) showed a grid of
agent cards. Clicking a card's **Open →** button navigated to `#/overview` —
but `#/overview` is not a registered route. The SPA router (`main.js`) resolves
an unknown route by falling back to `"agents"`, so the click re-rendered the
**same agent-listing screen** under a different hash. The result looked like two
identical agent-listing screens where one click opened the redundant other.

The real Overview screen (`renderOverview`) is registered under the `agent` key
(`#/agent`) and is reachable from the sidebar ("Overview"). Only the in-card
"Open →" target was wrong. Repointing it to `#/agent` removes the redundant
duplicate render and sends the user to the actual per-agent Overview.

## Changes

- Repointed the agent card's **Open →** action from the unregistered
  `#/overview` to the real Overview route `#/agent`.
- Updated the `data-go` click handler's default destination from `#/overview`
  to `#/agent` for the same reason.
- Verified no `#/overview` references remain anywhere in `app-tauri/src/`.

## Files Modified

- `app-tauri/src/or/dynamic.js`
  - `agentCard()` — `data-to="#/overview"` → `data-to="#/agent"` on the Open
    button (line ~214).
  - `paintAgents()` `data-go` handler — default `to` fallback `"#/overview"` →
    `"#/agent"` (line ~110).
