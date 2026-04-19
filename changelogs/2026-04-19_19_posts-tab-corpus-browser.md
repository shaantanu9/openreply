# Posts Tab — Raw Corpus Browser

**Date:** 2026-04-19
**Type:** Feature

## Summary

Added a "Posts" tab to the topic screen that surfaces the raw collected posts for a given topic. Paginated list (50/page) with toolbar filters (sub name, min score, sort order) and per-row display of title, excerpt, author, score, comment count, and age. Pure SQL via the existing `api.runQuery` helper — no new Tauri command required.

## Changes

- Created `app-tauri/src/screens/posts.js` with `loadPosts(contentEl, topic)` export
- Added import, tab button (`data-tab="posts"` between Sources and Research), and loaders-map entry in topic.js
- Appended `.posts-tab`, `.posts-toolbar`, `.posts-input`, `.posts-list`, `.posts-row`, `.posts-row-head`, `.posts-title`, `.posts-source`, `.posts-excerpt`, `.posts-meta`, `.posts-sub`, `.posts-pager`, `.posts-pager-btns` styles to style.css
- Tab order is now: Map · Report · Evidence · Trends · Sources · Posts · Research · Chat · Solutions · Actions

## Files Created

- `app-tauri/src/screens/posts.js`

## Files Modified

- `app-tauri/src/screens/topic.js` — import, tab button, loaders-map entry
- `app-tauri/src/style.css` — Posts tab styles appended
