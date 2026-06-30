# Fix agent-switch hang and stale per-agent content

**Date:** 2026-06-30
**Type:** Fix

## Summary

Switching the active agent from the sidebar dropdown had two bugs: (1) the
currently-visible screen kept showing the *previous* agent's data, and (2) the
app would freeze. Both stemmed from the dropdown's `onchange` handler. It ran a
blocking `await api.agentUse(...)` and then dispatched a `hashchange` — but the
hash doesn't change on an agent switch, so `main.js`'s `needsRender` guard
skipped the refresh (stale content). Worse, the forced re-render rebuilt the
sidebar (`side.innerHTML = …`) and destroyed the very `<select>` element that
was mid-`change`; on macOS WKWebView, replacing a `<select>` while its native
popup is dismissing wedges the UI (the freeze).

The fix defers all backend work and DOM rebuilds past the native popup
dismissal, disables the picker for instant feedback, and signals `main.js` to
re-fetch the active screen (and mark other tabs stale) for the newly-active
agent via a dedicated `or-agent-switched` event.

## Changes

- `hydrateAgents()` dropdown `onchange` no longer awaits inside the change
  handler. It captures the id, disables the `<select>`, and runs the switch in a
  `setTimeout(…, 0)` so the WKWebView native menu fully closes before any
  `agent_use` call or sidebar rebuild — eliminating the freeze.
- After `api.agentUse(id)` resolves it dispatches a new `or-agent-switched`
  CustomEvent instead of a bare `hashchange`.
- `main.js` listens for `or-agent-switched`: it deletes `dataset.loaded` on every
  open tab's portal (so each re-renders with the new agent's data when next
  shown) and calls `render()` immediately for the visible tab. Because
  `agent_use` already busts the SWR cache families (agent/persona/reply/content),
  these renders fetch authoritative per-agent data.
- Re-rendering also runs the screen's `__orCleanup`, tearing down any dangling
  streaming listeners (e.g. an in-flight Opportunities scan) on switch.
- The Agents-screen card actions (`data-use` "Make active", `data-go` "Find
  replies/Open", `data-edit`) now emit the same `or-agent-switched` event, so
  switching from the grid re-scopes every screen and re-hydrates the sidebar
  dropdown/label in lockstep with the dropdown path (previously they only
  refreshed the Agents grid locally and left the sidebar label stale).

## Files Modified

- `app-tauri/src/or/shell.js` — deferred, non-blocking dropdown `onchange` that
  emits `or-agent-switched`.
- `app-tauri/src/main.js` — `or-agent-switched` listener that marks all tab
  portals stale and re-renders the active tab.
- `app-tauri/src/or/dynamic.js` — Agents-screen card actions route their agent
  switch through `or-agent-switched` for app-wide re-scoping consistency.
