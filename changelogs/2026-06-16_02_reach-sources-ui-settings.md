# Reach sources in collect picker + Settings + LinkedIn cookie forwarding

**Date:** 2026-06-16
**Type:** Feature

## Summary

Surfaced the Agent Reach sources and the Reach Connections credential flow across
the app's UI: the keyword-searchable new sources are now selectable in the topic
collect source-picker, all new sources have friendly labels in the collect
progress chips, and a **Reach Connections** card was added to the Settings screen
(reusing the dedicated screen's logic). LinkedIn now forwards a stored `li_at`
cookie to Jina so login-gated LinkedIn pages read too.

## Changes

- **Collect source picker** (`app-tauri/src/screens/topic.js`): added a new
  `reach` group with v2ex, bilibili, xueqiu, xiaohongshu, exa (off by default;
  login-gated ones need a Connections login first) + a `GROUP_LABELS` entry.
- **Collect progress chips** (`app-tauri/src/screens/collect.js`): friendly
  labels for all 9 new sources in both the live-chip and filter-summary maps.
- **Settings** (`app-tauri/src/screens/settings.js`): a "Reach Connections" card
  under Data & sources that mounts the connection cards inline (open login →
  import cookie → verify) and links to the full `#/connections` screen.
- **Reusable mount** (`app-tauri/src/screens/reachConnections.js`): extracted
  `mountReachConnections(host, { intro })` so the dedicated screen AND the
  Settings card share one implementation (DRY).
- **LinkedIn cookie forwarding** (`sources/web_reader.py`, `sources/linkedin.py`):
  `_jina_read` accepts a `cookie` arg sent via Jina's `x-set-cookie`; LinkedIn
  passes the stored `li_at` so gated pages read.

## Coverage note

GitHub / RSS / YouTube were intentionally NOT re-added from Agent Reach — Gap Map
already has full native equivalents, so duplicating them would only add UI
clutter. Audio→text transcription (Xiaoyuzhou podcasts, Bilibili subtitles) and
LinkedIn deep profile/company search remain follow-ups: they need heavy deps
(Whisper) or an external MCP server, so they were not shipped untested here.

## Files Modified

- `app-tauri/src/screens/{topic,collect,settings,reachConnections}.js`
- `src/gapmap/sources/{web_reader,linkedin}.py`
- `tests/test_linkedin.py`
