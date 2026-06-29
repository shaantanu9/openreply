# Merge X Account + Watch accounts into a single X Accounts screen

**Date:** 2026-06-29
**Type:** UI Enhancement

## Summary

The separate **X Account** and **Watch accounts** screens are now a single **X
Accounts** screen. Every handle appears in one list, posts fetched for an account
render inline under that account card, and posts are sorted newest-first.

## Changes

- **Sidebar** (`app-tauri/src/or/shell.js`): replaced the two nav items with one
  **X Accounts** entry (`#/x-accounts`). Old routes `#/x-account` and `#/watch`
  still render the merged screen.
- **New merged screen** (`app-tauri/src/or/dynamic.js` → `renderXAccounts`):
  - Lists both connected X accounts and watched accounts, merged by handle.
  - Each account card shows `Connected` / `Watched` badges, post count, last
    fetched time, and per-account actions: Fetch posts, Save to Library, Reply,
    Watch/Untrack, Connect/Remove connection.
  - Clicking **Fetch posts** expands an inline post list for that account.
  - Add form lets you add a handle as watched, connected, or both; browser
    cookie import is available for connected accounts.
- **Post sorting**: frontend helper `_sortPosts` sorts by parsed `created_at` /
  `created_utc` descending. Backend also sorts results newest-first in
  `fetch_posts` and `fetch_x_user`.
- **Watch-account sample** (`src/openreply/reply/accounts.py`): sample now
  includes `id`, `created_at`, and `created_utc` so the merged UI can display
  dates and links.
- **Remove connection** (`app-tauri/src-tauri/src/commands.rs`, `main.rs`,
  `app-tauri/src/or/api.js`): new `x_account_remove` bridge command so connected
  accounts can be removed from the merged screen.

## Verification

- `node --check` clean on `dynamic.js`, `api.js`, `shell.js`.
- `python -m py_compile` clean on modified Python files.
- `cargo check` clean (only pre-existing warnings).
- Imports of modified Python modules succeed under `uv run`.

## Files Modified

- `app-tauri/src/or/shell.js`
- `app-tauri/src/or/dynamic.js`
- `app-tauri/src/or/api.js`
- `app-tauri/src-tauri/src/commands.rs`
- `app-tauri/src-tauri/src/main.rs`
- `src/openreply/x_account/fetch.py`
- `src/openreply/reply/accounts.py`
- `src/openreply/sources/x_twitter.py`

## Files Created

- `changelogs/2026-06-29_01_merge-x-accounts.md`
