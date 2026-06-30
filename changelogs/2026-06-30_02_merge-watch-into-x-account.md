# Merge "Watch accounts" into a single unified "X Account" screen

**Date:** 2026-06-30
**Type:** Refactor | UI Enhancement

## Summary

The app had two separate X/Twitter surfaces that did overlapping things and
showed up as two distinct sidebar entries: **"Watch accounts"** (`#/watch`,
under *Intelligence*, backed by the `agent watch-*` CLI) and **"X Account"**
(`#/x-account`, under *Account*, backed by the `x-account` CLI / `x_account`
Python module). Because they used two different backends, an account added in
one never appeared in the other — divergent state, not just visual duplication.

They are now merged into a single **"X Account"** screen on the `x_account`
backend. The richer Watch UX (track list, "Fetch all + learn", repurpose to
Compose) is folded into the X Account screen alongside its existing connection
management (cookie import), profile/timeline/thread browsing, and inline reply.
The duplicate "Watch accounts" sidebar entry is removed; `#/watch` now redirects
to `#/x-account` so any saved link still resolves.

## Changes

- Removed the "Watch accounts" item from the sidebar (Intelligence section).
- `renderWatch` is now a thin redirect to `#/x-account` (no second screen).
- Rewrote `renderXAccount` as the unified screen:
  - Account list upgraded from plain pills to action cards (Browse / Save to
    Library / Remove).
  - New **"Fetch all → Library + learn"** header action: iterates every tracked
    account calling `xAccountSaveToLibrary`, then runs `agentLearn()`.
  - Added a per-post **"Create post →"** repurpose action that hands the tweet
    text to Compose via the existing `or-repurpose-ctx` sessionStorage key.
  - Kept profile/posts/thread browsing and inline reply intact.
- Added the missing **`x_account_remove`** Tauri command (the Python
  `x-account remove` existed but was never exposed to the UI), registered it in
  the invoke handler, and added the `xAccountRemove` API method.

## Verification

- `vite build` — succeeds (1717 modules).
- `cargo check` — succeeds (only pre-existing unrelated warnings).
- `node --check` — clean on dynamic.js, api.js, shell.js.

## Files Modified

- `app-tauri/src-tauri/src/commands.rs` — added `x_account_remove` command.
- `app-tauri/src-tauri/src/main.rs` — registered `x_account_remove` in `generate_handler!`.
- `app-tauri/src/or/api.js` — added `xAccountRemove`.
- `app-tauri/src/or/dynamic.js` — unified `renderXAccount`; `renderWatch` → redirect; account cards, fetch-all+learn, repurpose action.
- `app-tauri/src/or/shell.js` — removed duplicate "Watch accounts" sidebar entry.
