# AI-derived search keywords for opportunity discovery (no more literal-name search)

**Date:** 2026-06-29
**Type:** Feature

## Summary

Opportunity discovery used to search the agent's literal `keywords`, falling
back to the **agent name** when none were set. So an agent named "TestNotes"
searched the literal string "testnotes" and surfaced irrelevant junk instead of
the conversations its audience actually has. Discovery now derives the search
terms from the agent's **identity** (niche, product, goal, audience) using the
configured BYOK LLM — the topics/problems the audience really discusses — and
blends them with any explicitly-set keywords. The result is cached per-agent so
it costs one LLM call until the identity changes, and the bare agent name is
never used as a standalone search term.

## Changes

- New module `src/openreply/reply/keywords.py` with `agent_search_keywords()`:
  - LLM-expands the agent identity into 8–14 scored audience search terms
    (high/medium/low relevance), keeping explicit keywords as a high-signal seed.
  - Caches the LLM output in `reply_state` keyed `kwexp:<agent_id>:<identity_hash>`
    — refreshes automatically when the identity changes.
  - Provider-less fallback derives topical terms from the identity text (short
    phrases + de-stopped words), still never the bare agent name.
- `find_opportunities` (`opportunity.py`) now calls `agent_search_keywords(brand)`
  instead of `brand["keywords"] or [brand["name"]]`.
- `refresh_agent` (`agent.py`) surfaces the same expanded keywords (collect
  already canonicalizes the topic internally via the LLM).

## Verification

- TestNotes (niche "note-taking apps for students"): explicit keywords kept and
  augmented with `note organization, study tips, digital notes, student
  struggles, class notes, homework help, study habits, …`.
- "test" agent (no keywords, niche "python"): expands to `python error, python
  tutorial, python beginner, python library, …` — confirmed **no literal "test"**
  term leaks into the search set.
- Cache populated and re-read on the second call. `py_compile` clean.

## Files Created

- `src/openreply/reply/keywords.py`

## Files Modified

- `src/openreply/reply/opportunity.py` — `find_opportunities` uses AI keyword expansion.
- `src/openreply/reply/agent.py` — `refresh_agent` surfaces expanded keywords.
