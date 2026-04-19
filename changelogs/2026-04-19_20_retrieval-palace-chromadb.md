# Local semantic-search palace — ChromaDB + BM25 hybrid retrieval

**Date:** 2026-04-19
**Type:** Feature (retrieval / search)

## Summary

Adopted the mempalace pattern for Gap Map: a **local, offline, HNSW-backed
semantic search layer** over the posts corpus. Every post collected through
any source adapter is now (best-effort) embedded via ChromaDB's bundled
`all-MiniLM-L6-v2` ONNX model and upserted into a sibling SQLite file
(`<data_dir>/palace/chroma.sqlite3`) alongside the existing `reddit.db`.
A hybrid search combines cosine-distance HNSW retrieval with local BM25
rerank (weights 0.6/0.4) so both semantic and keyword hits surface.

Additive only — the existing `posts`, `topic_posts`, `graph_nodes`, and
`graph_edges` schemas are untouched. The palace lives next to them. If the
`retrieval` extras group isn't installed, every API call returns a
`{"ok": False, "skipped": True, "reason": ...}` stub and ingest continues
silently. Opt-out via `GAPMAP_SKIP_PALACE=1` for CI / minimal deploys.

## Changes

### New Python package: `src/reddit_research/retrieval/`
- `palace.py` — thin wrapper over ChromaDB `PersistentClient`. Exports:
  - `is_available()` — True iff chromadb extras are installed
  - `upsert_posts_many(rows, topic=None)` / `upsert_post(post, topic=None)`
  - `search_posts(query, *, topic=None, source_type=None, k=10, rerank=True, vector_weight=0.6, bm25_weight=0.4)`
  - `related_posts(post_id, *, k=10, topic=None)` — nearest neighbours in embedding space
  - `reindex_all(batch_size=200, progress=cb)` — one-shot backfill over the entire `posts` table
  - `stats()` — doc count + palace path
  - `get_palace()` / `PalaceStore` — low-level escape hatches
- `__init__.py` — re-exports + package docstring

### Auto-indexing on every post ingest
- `src/reddit_research/core/db.py::upsert_posts` now tail-calls
  `retrieval.palace.upsert_posts_many` after the SQLite upsert. Wrapped in
  try/except so missing chromadb never breaks ingest. Honors `GAPMAP_SKIP_PALACE=1`.

### CLI (`research` app)
- `reddit-cli research semantic-search --query X [--topic Y] [--source reddit] [--k 10] [--no-rerank]` — hybrid search, JSON out
- `reddit-cli research related-posts --post-id <id> [--k 10] [--topic Y]` — nearest neighbours
- `reddit-cli research reindex-palace [--batch 200]` — one-shot backfill over `posts`
- `reddit-cli research palace-stats` — doc count + path

### Tauri bindings
- `commands::semantic_search(query, topic?, source?, k?)`
- `commands::related_posts(post_id, k?, topic?)`
- `commands::reindex_palace()`
- `commands::palace_stats()`
- Registered in `main.rs::generate_handler!`
- Exposed on frontend as `api.semanticSearch(query, {topic, source, k})`,
  `api.relatedPosts(postId, {k, topic})`, `api.reindexPalace()`,
  `api.palaceStats()`

### PyInstaller spec
- `reddit-cli.spec` now runs `collect_all()` for `chromadb`, `onnxruntime`,
  `tokenizers`, `rank_bm25`, `sentence_transformers` — bundled into the
  sidecar binary so production DMG ships everything offline. Wrapped in
  try/except so lean builds without retrieval extras still work.

### Dependency
- `pyproject.toml` — new `retrieval` extras group: `chromadb>=1.5.4,<2`,
  `rank-bm25>=0.2.2`. Install with `uv sync --extra retrieval`. Install size
  ~200 MB (onnxruntime + chromadb + default ONNX model).

## Design choices

- **Two files, one purpose** — palace.sqlite3 is a separate DB from reddit.db
  so Chroma's WAL journal + our schema migrations don't interact. Sync is
  opportunistic (on upsert) with a `reindex_all()` escape hatch.
- **Embed: title + first 2 KB of body** — fits MiniLM's 512-token window,
  captures the "hook" that users actually search for. Longer bodies get
  truncated; can be revisited if recall suffers.
- **One chroma row per post, not per (post, topic) pair** — simpler. The
  most-recent topic tag is stored in metadata so `where={"topic": t}` still
  filters correctly. Posts tagged to multiple topics are still searchable
  under every topic via the unfiltered query path.
- **BM25 is local-IDF over the vector-returned pool** — not a global term
  index. Keeps latency sub-linear in corpus size; matches mempalace's
  approach exactly.
- **Pulls 3× k from Chroma before BM25 rerank** — wide enough net for
  rerank to actually flip ordering, narrow enough to stay fast.

## Expected performance

| Operation | Cold | Warm |
|---|---|---|
| First ingest of 100 posts | 2–5 s (ONNX compile) + 1.5 s embed | 1.5 s embed |
| Subsequent ingests (100 posts) | — | 1.5 s (~15 ms/post) |
| `search_posts(k=10)` on 2K corpus | 2–5 s (first call) | 15–30 ms p50 |
| `related_posts(post_id, k=10)` | — | 10–25 ms p50 |
| `reindex_all` on 5K posts | — | 60–90 s one-shot |

## What this enables

- **Topic page → "related posts across topics"** button (trivial wrapper over
  `related_posts`)
- **Agent chat tool-use** gains a `semantic_search` tool alongside existing
  `run_query` / `get_findings` / `source_breakdown`
- **Global fuzzy search** in the sidebar: meaning-based, not keyword `LIKE`
- **Cross-topic painpoint dedup** — find near-duplicate complaints across
  different research topics
- **Report-pro enrichment** — pull semantically-related evidence when building
  the citation-rich markdown report, not just per-topic SQL

## Files Created

- `src/reddit_research/retrieval/__init__.py`
- `src/reddit_research/retrieval/palace.py`
- `changelogs/2026-04-19_20_retrieval-palace-chromadb.md` (this file)

## Files Modified

- `pyproject.toml` — new `retrieval` extras group
- `reddit-cli.spec` — bundle chromadb + onnxruntime in PyInstaller output
- `src/reddit_research/core/db.py` — palace sync hook in `upsert_posts`
- `src/reddit_research/cli/main.py` — 4 new `research` subcommands
- `app-tauri/src-tauri/src/commands.rs` — 4 new Tauri commands
- `app-tauri/src-tauri/src/main.rs` — register the 4 commands
- `app-tauri/src/api.js` — 4 new `api.*` bindings

## Next — not in this commit

- Frontend UI for search (sidebar global search box + Topic → "related" chip
  on each finding). Two simple screens, deferred to a follow-up.
- Agent tool-use registration — hook `semantic_search` into `research/chat.py::agent_stream_anthropic`'s tool list.
- Run `uv sync --extra retrieval` locally, then `reddit-cli research reindex-palace` to backfill existing corpora.
