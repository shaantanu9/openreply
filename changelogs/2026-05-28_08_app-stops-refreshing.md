# Stop the "app keeps refreshing" feel during background DB writes

**Date:** 2026-05-28
**Type:** UX Fix

## Summary

While a background process was writing to `gapmap.db` (MCP daemon serving tool calls from Claude Code, enrichment worker chewing through painpoint extraction, scheduled collects, etc.) the GUI felt like it was reloading itself every few seconds. Sidebars flickered. Scroll positions reset. Open accordions snapped shut. Tabs the user was in the middle of typing into reset.

Root cause: the 5s DB-mtime poller fires `gapmap:db-changed` on every detected write. The window handler called `route()` which fully re-runs the active screen's render — typically a `main.innerHTML = …` reassignment that destroys the entire DOM tree. During an active enrichment / collect, every 5s tick saw a write, so every 5s the user got a hard remount. Existing `NO_REMOUNT_ROUTES` skip list only covered `collect`, `topic`, `settings`, `welcome`, `activate`, `license` — every other screen was vulnerable.

Two-part fix:

1. **Expanded `NO_REMOUNT_ROUTES`** to cover screens that have their own internal refresh / polling / interactive state and don't benefit from a forced remount: `/audience/:topic` (now owns live build polling), `/personas`, `/tasks`, `/collects`, `/activity` (own 4s db-mtime poller), `/database`, `/find`, `/search`, `/watch`, `/iterate`, `/improve`. Home / Topics / Products / Competitors / Reports / Ingest / Science / Playbook / OST / Empathy / Interviews / PMF / Pricing / Launch still remount — these are list-of-everything views where fresh data matters and they don't own a polling loop.

2. **Debounced the `gapmap:db-changed` remount** with a 2s quiet-period coalesce. A burst of writes (e.g. enrichment worker landing a batch every 800ms) now triggers ONE remount after the burst settles, not one per write. Sidebar counters still refresh immediately on every event — only the heavy full-screen remount is debounced. The extraction worker poke is also coalesced (fires once per debounce window, idempotent on the Rust side).

## Verified

- `node --check main.js` clean.
- Pattern matches the user's explicit instruction: "the app should not feel like refreshing and reloading the screen … we want to add data to the listing … without refresh and reloading the screen."

## Files Modified

- `app-tauri/src/main.js` — extended `NO_REMOUNT_ROUTES`, added debounce around the `gapmap:db-changed` listener.

## Follow-ups (not in this changeset)

- Replace the remaining list-of-everything full remounts with incremental DOM updates (append new rows / cards, update counts in place) so even those screens don't reload. This would require each screen to register an opt-in `gapmap:data-update` handler. Out of scope for this fix; the debounce + skip-list combo dramatically reduces user-visible churn already.
