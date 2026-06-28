# Reddit Search Screen

**Date:** 2026-04-19
**Type:** Feature

## Summary

Adds a top-level "Search" route at `#/search` with a sidebar nav link (between Activity and Database). Lets users run ad-hoc PRAW-based Reddit searches with query, optional subreddit, sort mode (relevance/hot/new/top/comments), time filter (all/year/month/week/day/hour), and result limit — without needing a curated topic.

## Changes

- New `run_reddit_search` Tauri command bridges `reddit-cli search QUERY [--sub X] [--sort X] [--time X] [--limit N] --json`
- New `renderSearch` screen renders a form + result cards (title, excerpt, sub link, score, comments, author, age)
- Route registered at `/search`, import added to main.js
- Sidebar nav link added between Activity and Database
- CSS classes `.search-tab`, `.search-form`, `.search-input`, `.search-row`, `.search-title`, `.search-excerpt`, `.search-meta`, `.search-sub`, `.search-results-meta`, `.search-list` added

## Files Created

- `app-tauri/src/screens/search.js`
- `changelogs/2026-04-19_20_reddit-search-screen.md`

## Files Modified

- `app-tauri/src-tauri/src/commands.rs` — added `run_reddit_search` command
- `app-tauri/src-tauri/src/main.rs` — registered `commands::run_reddit_search`
- `app-tauri/src/api.js` — added `runRedditSearch` wrapper (uncached, fresh query each time)
- `app-tauri/src/main.js` — import + route entry for `renderSearch`
- `app-tauri/index.html` — Search nav link in sidebar
- `app-tauri/src/style.css` — search screen CSS appended
