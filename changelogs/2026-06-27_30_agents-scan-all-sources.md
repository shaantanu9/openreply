# Agents scan & reply across all sources, not just Reddit

**Date:** 2026-06-27
**Type:** Feature

## Summary

Made OpenReply agents fetch/scan from as many sources as possible and use that
corpus to both write new posts and reply to older content — across all social
media, not only Reddit. The fetch layer already supports **69 sources**
(`sources/collect_adapter.py:SOURCES`) and the knowledge blend
(`reply/knowledge.py:build_knowledge_context`) already draws on the full
multi-source corpus for both compose and reply. The real gaps were defaults and
discovery scope: agents defaulted to Reddit-only and opportunity discovery
scanned just the picked list. Fixed.

## Changes

- **`reply/platforms.py`** — `DEFAULT_AGENT_PLATFORMS`
  (reddit_free, hn, lemmy, mastodon, devto, stackoverflow, producthunt — all
  free, reply-capable, no-auth) + helpers `can_reply()`, `engage_keys()`,
  `discovery_keys()`.
- **`reply/agent.py`** + **`cli/agent_cmds.py`** — new agents now default to the
  multi-source set instead of `["reddit_free"]` (CLI `--platforms` default is
  blank so the engine default applies).
- **`reply/opportunity.py`** — `_scan_platforms()` = the agent's picked
  platforms ∪ reply-capable sources connected via Reach Connections ∪
  reply-capable sources that already have posts in the corpus (Reddit always
  included as baseline). `find_opportunities` now scans that union, so
  connecting X/Instagram/LinkedIn — or simply having HN/Dev.to/etc. in the
  corpus — makes the agent reply there automatically. Added
  `_connected_engage()` and `_corpus_engage()` helpers.
- **`app-tauri/src/or/dynamic.js`** — the agent-create picker pre-checks the
  multi-source defaults (was Reddit-only).

## How it works (for the user)

- **Create an agent** → it's multi-source from day one (7 communities
  pre-selected; pick more in the form — all 16 reply platforms are offered).
- **Connect accounts** (Connections) → X, Instagram, LinkedIn, TikTok, Bluesky,
  etc. become live and are auto-added to the scan.
- **Find opportunities** → scans every available reply-capable source, not just
  the picked list, and ranks across all of them.
- **Compose / Reply** → both already pull the blended multi-source corpus
  (beliefs → memories → corpus excerpts from all collected sources).

## Verification

- New agent → `['reddit_free','hn','lemmy','mastodon','devto','stackoverflow','producthunt']`.
- TestNotes (picked Reddit + a few social) → `_scan_platforms` resolved an
  8-platform scan set by unioning connected (devto/mastodon/youtube) + corpus
  (reddit_free/youtube).
- `tests/test_reply_knowledge_blend.py` + `tests/test_reddit_free.py`: 13 passed
  on the committed (HEAD-based) change.

## Files Created

- `changelogs/2026-06-27_30_agents-scan-all-sources.md`

## Files Modified

- `src/gapmap/reply/platforms.py`
- `src/gapmap/reply/agent.py`
- `src/gapmap/cli/agent_cmds.py`
- `src/gapmap/reply/opportunity.py`
- `app-tauri/src/or/dynamic.js`

## Notes

- Auth-gated platforms (X, Instagram, TikTok, LinkedIn, Threads) need a
  connection/key to return live data; without it they degrade gracefully (no
  rows) rather than erroring. Public sources (HN, Lemmy, Mastodon, Dev.to, SO,
  Product Hunt, Reddit-RSS) work anonymously.
- Scanning more sources makes "Find opportunities" do more network work; it's an
  explicit action with a progress indicator. A per-source fetch cache is a
  sensible future optimization.
