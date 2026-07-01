# Fix: Overview Daily Update (and Library/chat/counts) showing empty

**Date:** 2026-07-01
**Type:** Fix

## Summary

The Overview → Daily Update page rendered blank: `digest-quick` returned
`feed: []` and `item_count: 0` even though hundreds of posts had been collected.
Root cause: collection tags every post under the LLM-**canonicalized** topic (via
`_tag_posts` → `resolve_topic`), but the agent record stores the **raw typed**
topic. Every read that queried `topic_posts WHERE topic = agent.topic` used the
raw string and matched zero rows. Example: agent "Logiciel" stored
`"AI-powered software development and engineering services"` while its 8,629
posts were tagged under the canonical `"AI-powered software development services"`.

This silently emptied not just the Daily Update but every corpus-backed read:
Library, chat knowledge retrieval, content sourcing, learning, brain build, and
the agent post/graph-node counts.

## Changes

- Added `agent_corpus_topic(agent, db=None)` in `reply/agent.py` — resolves an
  agent's stored topic to the canonical topic its posts are actually tagged
  under (with a defensive fallback to the raw topic when the resolved one has no
  posts). Applied across all corpus-read call sites:
  `agent.py` (post/graph counts in `list_agents` + `knowledge_summary`),
  `library.py` (`list_corpus` → Daily Update + Library), `chat.py` (retrieval +
  knowledge context), `content.py` + `knowledge.py` (`_corpus_excerpts`),
  `brain.py`, `brain_unified.py`, `learn.py`.
- `digest.py`: an empty cached digest row is now treated as a cache **miss and
  rebuilt** — but only when the corpus actually has posts (the bug signature).
  A genuinely-empty corpus still serves its empty cache (no rebuild loop). New
  helpers `_corpus_nonempty()` + `_cache_serviceable()`.
- `dynamic.js`: `loadCachedDigest()` no longer trusts an empty-feed localStorage
  row, so the page routes to the fast quick-rank instead of pinning to blank.

## Verified

- `openreply reply digest-quick` for the live agent: **feed 0 → 6 items**.
- `knowledge_summary` / `list_agents`: **posts 0 → 8629, graph_nodes 0 → 16637**.
- New regression test `tests/test_digest_topic_resolution.py` (canonical-topic
  corpus read + cache-serviceable logic). Existing digest tests still pass.

## Files Created

- `tests/test_digest_topic_resolution.py`

## Files Modified

- `src/openreply/reply/agent.py` — `agent_corpus_topic()` + apply to counts
- `src/openreply/reply/library.py` — resolve topic in `list_corpus`
- `src/openreply/reply/digest.py` — serviceable-cache logic
- `src/openreply/reply/chat.py`, `content.py`, `knowledge.py`, `brain.py`,
  `brain_unified.py`, `learn.py` — resolve topic on corpus reads
- `app-tauri/src/or/dynamic.js` — don't trust empty cached digest
