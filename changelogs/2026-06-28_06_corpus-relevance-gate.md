# Corpus relevance gate — LLM-check fetched content, tag & demote off-topic

**Date:** 2026-06-28
**Type:** Feature

## Summary

Fetched content can drag in posts a keyword search matched but that aren't
actually about the agent's topic. Added an **LLM relevance gate** over the
collected corpus: each post is classified on-topic / off-topic (with a score +
one-line reason), the Library shows on-topic items first and **pushes off-topic
to the bottom with a red "not related" tag**, and a clickable relevance filter
lets you view just the on-topic / not-related / unchecked sets. Verified on real
data: a 20-post check found 9 on-topic and 11 not related.

## Changes

- `reply/relevance.py` (new): `check_relevance(agent_id, limit, provider)` batches
  not-yet-checked corpus posts through the BYOK model → verdict
  {relevant, score, reason} stored in new `post_relevance` table;
  `relevance_map()` + `_ensure()` helpers.
- `reply/library.py`: `list_corpus` LEFT JOINs `post_relevance`, returns per-item
  `relevant`/`rel_score`/`rel_reason`, sorts off-topic last (then recency), adds a
  whole-corpus `relevance` tally, and accepts a `relevance` filter
  (on/off/unchecked). Ensures the table exists so the JOIN never errors.
- CLI `agent_cmds.py`: `agent corpus-check`; `agent corpus --relevance`.
- Rust `commands.rs`/`main.rs`: `agent_corpus_check`; `agent_corpus` gains a
  `relevance` arg.
- Frontend `api.js`: `agentCorpusCheck` + `agentCorpus(..., relevance)`.
- Frontend `dynamic.js` `renderLibrary`: per-item on-topic/not-related tag
  (off-topic cards dimmed), a relevance banner with clickable filter pills
  (all / on-topic / not related / unchecked) and a "Check N with AI" button.

## Files Created

- `src/openreply/reply/relevance.py`
- `changelogs/2026-06-28_06_corpus-relevance-gate.md`

## Files Modified

- `src/openreply/reply/library.py` — relevance join + filter + tally
- `src/openreply/cli/agent_cmds.py` — corpus-check + corpus --relevance
- `app-tauri/src-tauri/src/commands.rs`, `main.rs` — corpus_check + relevance arg
- `app-tauri/src/or/api.js`, `app-tauri/src/or/dynamic.js` — API + Library UI

## Verification

- `check_relevance` on the real app DB: checked 20 → 9 on-topic, 11 not related.
- `list_corpus` relevance filter returns the right subsets (on=9, off=11,
  unchecked=317) while the banner tally stays constant.
- `cargo check` 0 errors; `node --check` clean.
- Fixed: `list_corpus` ensures `post_relevance` exists before the LEFT JOIN
  (otherwise the join errored and the corpus showed empty).

## Known gaps / follow-ups

- The check is on-demand (button) over the most-recent unchecked posts; not yet
  auto-run after every fetch (P2 — would add LLM cost to each collect).
