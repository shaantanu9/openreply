# Multi-source corpus visibility — Library + Opportunities source filter

**Date:** 2026-06-28
**Type:** Feature

## Summary

Fixed the core complaint: "I can only see Reddit content." The app already had
69 source adapters and the knowledge blend already used the multi-source corpus
internally — but two things hid it: (1) `refresh_agent` only collected the
agent's *reply* platforms (mostly auth-gated → empty), and (2) there was no UI
to actually *see* the collected content. Now agents collect a broad corpus and
you can browse, search, filter, and learn from everything — and Opportunities
can be filtered by source.

## Changes

- **`reply/library.py`** (new):
  - `list_corpus()` — browse the agent's whole collected corpus across every
    source (Reddit, Hacker News, Google News, DuckDuckGo, Dev.to, Stack
    Overflow, Lemmy, Mastodon, YouTube, …) with per-source counts + text search.
  - `corpus_sources()` — the broad collect set: picked reply platforms + free
    discovery sources (HN, Dev.to, Stack Overflow, Product Hunt, Lemmy,
    Mastodon, Google News, RSS tech-news, DuckDuckGo) + connected Reach sources.
- **`reply/agent.py`** — `refresh_agent` now collects `corpus_sources(a)` instead
  of only `a["platforms"]`, so the brain learns from news/web/forums/communities,
  not just reply targets.
- **CLI** `agent corpus [--source --query --limit]`; **Tauri** `agent_corpus`;
  **api.js** `agentCorpus`.
- **UI** — new **Library** screen (`renderLibrary`) + sidebar nav: read every
  collected item, filter by source chips, search, `Open ↗` / `Use in Compose →`.
- **Opportunities source filter** — `platform` param threaded through
  `list_opportunities` / `_list_where` → `reply list --platform` →
  `reply_list` Tauri cmd → `replyList` → a new **"All sources"** `<select>` on
  the Opportunities screen.

## Verification

- Broad refresh on TestNotes fetched **55 posts in one pass** across HN(4),
  Google News(14), Stack Overflow(2), DuckDuckGo(30), Reddit(5); auth-gated
  sources (X/LinkedIn/Threads/Bluesky) returned 0 without credentials (graceful).
- Corpus now **337 items across 7 sources**; `agent corpus --source gnews` →
  13 filtered; `reply list --platform reddit_free` → only Reddit.
- `cargo check` clean; `test_reply_knowledge_blend` + `test_reddit_free` 13 pass.

## Files Created

- `src/openreply/reply/library.py`
- `changelogs/2026-06-28_01_multi-source-corpus-visibility.md`

## Files Modified

- `src/openreply/reply/agent.py`, `src/openreply/reply/opportunity.py`,
  `src/openreply/cli/agent_cmds.py`, `src/openreply/cli/reply_cmds.py`,
  `app-tauri/src-tauri/src/commands.rs`, `app-tauri/src-tauri/src/main.rs`,
  `app-tauri/src/or/api.js`, `app-tauri/src/or/dynamic.js`,
  `app-tauri/src/or/shell.js`

## Notes

- Nothing was removed from the multi-source repo — all 69 adapters are intact;
  this surfaces them. Auth-gated platforms (X, Instagram, TikTok, LinkedIn,
  Threads) need a Connections cookie/key to return live data; public sources
  work anonymously.
- `agent corpus` is intentionally uncached (always fresh) so a refresh shows new
  content immediately.
- The Opportunities source `<select>` is populated from the reply-capable
  platform catalog; the filter is server-side so it works across pagination.
