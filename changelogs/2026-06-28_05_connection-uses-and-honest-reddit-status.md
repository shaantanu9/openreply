# Connections: explain what each unlocks + honest Reddit status

**Date:** 2026-06-28
**Type:** UI Enhancement + Fix

## Summary

Answers "what's the use of connecting an account?" Each Connections card now
states the concrete benefit, and a misleading Reddit log message was corrected to
reflect what actually happens.

## Changes

- **`reach_connections.py`** — added a `USES` map (plain-language benefit per
  source) and surfaced it via `list_connections()` (`uses` field). Honest about
  limits — e.g. the Reddit cookie is best-effort.
- **`app-tauri/src/or/dynamic.js`** — each connection card shows the `uses` line
  (what you get by connecting it).
- **`research/collect.py`** — the Reddit gate previously checked only the Reddit
  API `client_id` and logged "Reddit NOT connected — skipping", even though the
  `reddit_free` source still pulls Reddit via cookie→RSS in the external fan-out.
  Now it reports the actual active path (cookie vs public RSS) and points to API
  keys for full discovery / scores / history.

## Key finding (why a connection can feel useless)

- The **Reddit browser cookie** stored was just `token_v2`; `_authed_search`
  **403s** with it, so `fetch_reddit_free` falls back to anonymous RSS (no
  scores/comments). Reddit aggressively blocks cookie auth — the reliable Reddit
  path is **Reddit API keys** (PRAW), which the native collect stages use.
- **LinkedIn** has the right cookies (`li_at`) but is a **URL reader** — it
  fetches a specific profile/company post you paste, not keyword search.
- **Public sources** (HN, Dev.to, Mastodon, YouTube) need no login and are
  always on.

## What connections are actually for

1. **Fetch** — connected/public sources feed the agent's corpus (Library) and
   opportunity discovery. More/better sources → richer brain, more reply targets.
2. **Post** — X (Twitter) can publish tweets/threads from Compose
   (`publish/x.py`). Other outbound adapters are future work.

## Files Modified

- `src/gapmap/research/reach_connections.py`
- `src/gapmap/research/collect.py`
- `app-tauri/src/or/dynamic.js`

## Files Created

- `changelogs/2026-06-28_05_connection-uses-and-honest-reddit-status.md`

## Highest-value connections to add

- **Reddit API keys** (Settings → Reddit) — full Reddit search, scores, comments,
  historical (the cookie alone won't do this).
- **ScrapeCreators key** — one key unlocks TikTok + Instagram + Threads + Pinterest.
- **X / Twitter** — search + posting.
- **Bluesky** app-password — free, instant, reliable.
