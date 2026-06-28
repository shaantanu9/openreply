# Paper research — cited Q&A, semantic search UI, and the topic-filter fix that unblocked both

**Date:** 2026-06-07
**Type:** Feature + Fix

## Summary

Completed the "proper AI for paper research" flow end-to-end: ask questions about a topic's papers and get answers grounded in the papers' **full text** with deterministic, section-level citations — plus a passage-search mode — surfaced in the Papers tab and exposed across CLI / MCP / Tauri. While wiring it, found and fixed a core bug: **topic-filtered paper-chunk search returned 0 for every topic**, which silently broke all paper search and any future paper chat.

## The unblocking fix (P0)

`palace.search_paper_chunks(topic=…)` filtered chunks on a stamped `{"topic": …}` metadata field, but the ingest/auto-index path (`paper_chunks.chunk_paper`) embeds chunks **without** a topic field (and a paper can belong to several topics anyway). So every topic-scoped search matched 0 chunks despite 852 being indexed.

Fix: resolve `topic → its paper post_ids` from `topic_posts` (the source of truth) and filter chunks with `{"post_id": {"$in": ids}}`, falling back to the legacy stamped-topic clause when a topic resolves to no posts. Works for already-embedded chunks with **no re-embedding**. Verified: topic search went 0 → 6 hits.

## New: cited Q&A over papers

New module `src/openreply/research/paper_chat.py`:
- `paper_qa(topic, question, …)` / `paper_qa_stream(…)` — retrieve section-aware chunks via palace, ground an LLM (reuses `chat.llm_dispatch` BYOK provider resolution + streaming), return `{answer, citations:[{n,title,author,year,url,sections}], used_chunks, sources_markdown}`.
- Citations are built **deterministically** from retrieved chunks (never invented); answer instructed to refuse rather than hallucinate when papers don't cover the question (verified: it correctly declined an unsupported question, then answered a supported one with `[1, §abstract]`-style cites).
- **Noise-section filter**: over-fetches and drops `references / acknowledgments / appendix / supplementary` chunks (a bibliography was scoring 0.99 on keyword overlap) so grounding stays on Methods/Results/Discussion.

## Surfaces wired

- **CLI**: `openreply research paper-ask "<q>" --topic … [--sections methods,results] [--post-id …] [--no-stream] [--json]`.
- **MCP**: `openreply_paper_ask(question, topic, sections, post_id, k, provider)`.
- **Tauri**: new commands `paper_ask` and `paper_chunk_search` (`commands.rs` + registered in `main.rs`; `cargo check` clean).
- **api.js**: `paperAsk(question, {topic,sections,postId,k,provider})` and `paperChunkSearch(query, {topic,sections,k,rollup})`.
- **UI**: "Ask the papers" panel in the Papers tab (`papers.js`) with an Ask/Search toggle, section-scope chips, answer + numbered Sources rendering, and passage-hit rendering for Search mode.

## Also verified (was reported as gaps, found already working)

- **Auto-index on download**: `paper_fulltext._finalize_text` already calls `_auto_index_after_download` (sections → chunks → embed → references), gated by `PAPER_FULLTEXT_AUTO_INDEX` (default on). Verified: fetching one arXiv paper auto-produced 6 sections + 24 chunks.
- **Paper-finding adapters**: arXiv/OpenAlex/PubMed/Crossref return real papers (Semantic Scholar 0 without an API key — expected rate-limit).

## Files Created

- `src/openreply/research/paper_chat.py` — cited Q&A engine.
- `changelogs/2026-06-07_03_paper-cited-qa-and-search.md`

## Files Modified

- `src/openreply/retrieval/palace.py` — `_paper_post_ids_for_topic` helper; topic filter now resolves to post_id set.
- `src/openreply/cli/main.py` — `research paper-ask` command.
- `src/openreply/mcp/server.py` — `openreply_paper_ask` tool.
- `app-tauri/src-tauri/src/commands.rs` — `paper_ask`, `paper_chunk_search`.
- `app-tauri/src-tauri/src/main.rs` — registered both handlers.
- `app-tauri/src/api.js` — `paperAsk`, `paperChunkSearch`.
- `app-tauri/src/screens/papers.js` — Ask/Search panel + wiring.
