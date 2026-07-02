# Fix "no knowledge yet" when the agent's corpus exists (topic canonical read-key drift)

**Date:** 2026-07-01
**Type:** Fix

## Summary

Agent chat replied *"I don't have any knowledge yet for this agent…"* — and the
Agents card showed **posts = 0**, Library was blank, and learning distilled from
an empty corpus — even though thousands of posts had been collected for the
agent. Root cause: `collect()` writes `posts` / `topic_posts` / `graph_nodes` /
`findings` under the **LLM-canonical** form of the agent's topic (and records a
`topic_aliases` binding), but the agent row keeps the **user-typed** topic for
display. Every reply-side READ keyed its query on the raw typed topic, so a
canonicalized/drifted topic matched zero rows.

Concrete case from the live DB: agent `logiciel` has
`topic = "AI-powered software development and engineering services"`, but its
8,629 posts live under the canonical `"AI-powered software development services"`
(alias binding present). Reads found nothing → the empty-knowledge gate fired.

Fix: a single resolver, `agent_corpus_topic(a)`, that maps the agent's typed
topic to its canonical read key via the existing `canonical_for_read()` (returns
the input unchanged when no alias exists — un-canonicalized agents are
unaffected). Applied at every corpus/graph read site, and at the watched-account
tag-write so account posts land in the same partition as `collect()`.

## Changes

- Added `agent_corpus_topic(a)` in `reply/agent.py` — canonical corpus/graph read
  key for an agent, resolving typed→canonical via `canonical_for_read()`.
- Routed all reply-side reads through it: chat corpus + graph fetch + knowledge
  context, agent-list stats, `knowledge_summary`, Library, relevance, learn,
  brain, unified brain, and content knowledge blend.
- Watched-account post tagging (`accounts.py`) now tags under the canonical key
  so account-sourced posts join the same corpus partition `collect()` writes to.
- Write/`collect()` paths (`refresh_agent`, `digest`) left untouched — `collect()`
  canonicalizes the topic internally on write.

## Verification

- Against the live app DB, `logiciel` now resolves typed → canonical, corpus
  fetch returns rows (was 0), the "no knowledge yet" gate no longer fires, and
  `knowledge_summary` reports 8,629 posts (was 0).
- `pytest tests/test_reply_chat.py tests/test_reply_knowledge_blend.py
  tests/test_topic_merge.py tests/test_agent_goal.py` — 17 passed (the
  genuinely-empty-agent "no knowledge yet" path still works).

## Files Modified

- `src/openreply/reply/agent.py` — new `agent_corpus_topic()`; `list_agents`
  stats and `knowledge_summary` use it.
- `src/openreply/reply/chat.py` — `_fetch_corpus_rows`, `_fetch_graph_findings`,
  and `build_knowledge_context` call use the canonical key.
- `src/openreply/reply/content.py` — knowledge blend corpus topic.
- `src/openreply/reply/library.py` — Library corpus browse.
- `src/openreply/reply/relevance.py` — relevance classification corpus scope.
- `src/openreply/reply/learn.py` — learning corpus scope.
- `src/openreply/reply/brain.py` — graph build/read topic (both sites).
- `src/openreply/reply/brain_unified.py` — unified brain topic (both sites).
- `src/openreply/reply/accounts.py` — watched-account post tagging key.
