# Wire OpenReply Tauri UI to the backend (live data + new DB)

**Date:** 2026-06-27
**Type:** Feature

## Summary

Made the OpenReply Tauri UI actually work: the core screens now render live data from
the new reply_* SQLite DB via the command bridge (UI → invoke → commands.rs → openreply
reply/agent/content). Verified visually — the Agents screen renders the real agents from
the app DB.

## Changes

- `src/or/api.js` — frontend invoke wrappers (agent/reply/content + creds/byok/feeds);
  no-op fallback in a plain browser so the static prototype still renders.
- `src/or/dynamic.js` — dynamic screens with live data + handlers:
  - **Agents**: agent_list cards, create-agent form (agent_create), make-active (agent_use).
  - **Overview**: agent_get + agent_knowledge KPIs, refresh (agent_refresh).
  - **Opportunities**: reply_find (RRF-ranked) / reply_list, per-item Draft (reply_draft)
    with subreddit-compliance flag; score tooltip shows relevance/intent/fit/engagement/freshness.
  - **Compose**: kind picker + content_generate, recent drafts (content_list).
- `src/main.js` — routes wired screens to dynamic renderers (live) when in Tauri; static
  prototype views otherwise; per-view loading + error states.
- `src/or/shell.js` — sidebar agent switcher now lists real agents (agent_list) and
  switches via agent_use; active agent name reflected in the AGENT section label.

## Verified
- Dynamic Agents screen renders real agents from the app's reply_* DB (screenshot).
- JS modules syntax-clean; sidebar agent switcher live (real "Acme Notes").

## Files Created
- `src/or/api.js`, `src/or/dynamic.js`, `changelogs/2026-06-27_09_wire-openreply-ui-to-backend.md`

## Files Modified
- `src/main.js`, `src/or/shell.js`
