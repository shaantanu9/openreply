# Overview reworked into a proper homepage hub

**Date:** 2026-06-27
**Type:** UI Enhancement

## Summary

The agent Overview is the app's homepage, but it only showed four KPIs, a Voice
card, and three "next step" links — it neither read clearly nor gave access to
the app's features. Reworked it into a real dashboard/hub: clear live status,
one-click reach to every screen, and at-a-glance recent activity.

## Changes

`renderOverview` (`app-tauri/src/or/dynamic.js`) now renders:

- **Header** — agent name, niche, watched sources + primary actions
  (Refresh + learn, Find opportunities) and a new-agent guidance banner.
- **Stat tiles (clickable)** — Posts collected → Knowledge, Brain nodes →
  Knowledge, **New opportunities (live count)** → Opportunities, **Drafts
  (live count)** → Inbox.
- **"Reach everything" grid**, grouped so it's easy to scan:
  - *Workspace*: Opportunities, Inbox, Compose, Queue
  - *Intelligence*: Knowledge & Brain, Keywords, Subreddit Intel, Learning,
    Analytics, AI Visibility
  - *Account*: Connections, Settings, Plans
  Each tile is an icon + title + one-line description linking straight to the
  screen (covers all 13 routes).
- **Live snippets** — top 3 opportunities (platform badge + score) and the 3
  most recent drafts, each linking onward. Best-effort (never blocks the page).
- Kept Voice + Knowledge-personas linking.

## Files Modified

- `app-tauri/src/or/dynamic.js` — `renderOverview` rewritten as the homepage hub

## Files Created

- `changelogs/2026-06-27_28_overview-homepage-hub.md`

## Notes

- All tiles use existing hash routes already in `DYN`, so every link resolves.
- Live counts reuse `replyList`/`contentList`; the two loaders run independently
  and fail silently so a slow/empty backend still renders the full hub.
