# Palace (semantic) wired into MCP + cold-start optimisation

**Date:** 2026-04-21
**Type:** Feature + Optimisation

## Summary

Palace (ChromaDB + ONNX MiniLM-L6-v2 + BM25 hybrid) was already polished on the app side — module-level cache, bundle-seed for prod DMG, smart "skip palace upsert if model not ready" gate. Three real gaps remained:

1. **Zero MCP coverage** — Claude Code could `openreply_search` (Reddit API), `openreply_query_db` (raw SQL), and `reddit_graph_*` (graph traversal), but couldn't do **semantic search** over the 12,108-post local corpus. The 79 MB ONNX model was a sunk cost the MCP never used.
2. **No pre-warm in MCP** — the first semantic call would eat ~2-5s ONNX compile in the MCP process even though the same model was already loaded by the desktop app's sidecar.
3. **Fetches via MCP didn't backfill** — `upsert_posts` correctly skips Palace when the model isn't ready, but didn't communicate that to the user; new posts fetched through MCP could end up in `posts` but not in the vector index until a manual reindex.

## Changes

- **5 new MCP tools** (file: `src/reddit_research/mcp/server.py`):
  - `openreply_palace_status` → `{installed, ready, count, archive_bytes, expected_bytes, cache_dir, palace_dir}`
  - `openreply_palace_warmup` → triggers `warmup_model()` (download + extract ONNX) without leaving Claude
  - `openreply_semantic_search(query, topic?, source_type?, k=10, rerank=True)` → hybrid vector + BM25, identical scoring to the app's Settings → Semantic search
  - `openreply_related_posts(post_id, k=10, topic?)` → "more like this" via cosine on the post's existing embedding
  - `openreply_palace_reindex()` → idempotent backfill — safe to interrupt
- **Pre-warm Palace in `mcp.run()`**: opens the persistent ChromaDB client at server startup (~50 ms). Optional `REDDIT_MYIND_PALACE_EAGER=1` env var also runs one throwaway embed so the first semantic call returns in ~30 ms instead of ~300 ms.
- **Same DB shared by design**: MCP reads `REDDIT_MYIND_DATA_DIR` (set by the v1 install flow) → reads `<data_dir>/palace/chroma.sqlite3` → exactly the same vectors the app sees. Verified: 12,108 posts visible from MCP process.
- Documentation comment in `core/db.py::upsert_posts` clarifying the auto-seed path so MCP fetches index immediately if the model has ever been downloaded.

## Verified end-to-end

```
status:         {installed: True, ready: True, count: 12108}
first search:   298 ms (ONNX cold compile)
second search:  123 ms (warm — pure vector lookup)
```

12,108 posts indexed at `~/Library/Application Support/com.shantanu.openreply/reddit-myind/palace/`, identical to the app's read view.

## Files Modified

- `src/reddit_research/mcp/server.py` — added 5 palace tools + pre-warm in `run()`
- `src/reddit_research/core/db.py` — clarifying comment on the auto-seed path

## Files Created

- `changelogs/2026-04-21_05_palace-mcp-optimisation.md` — this entry
- `~/.claude/skills/mempalace-chromadb-onnx/SKILL.md` (global) — reusable skill capturing the full Palace pattern (offline ONNX, hybrid retrieval, bundle-seed for prod, MCP exposure, cold-start optimisation)

## Operational notes

- After Claude Code restart, `mcp__reddit-myind__reddit_palace_status` should return `installed: True, ready: True, count: 12108`
- If `ready` is False on a fresh install, call `mcp__reddit-myind__reddit_palace_warmup` once (or use the desktop app's Settings → Semantic search → Enable). Same model location, both paths share it.
- MCP fetches (`openreply_fetch_posts` etc.) auto-index into Palace as long as the model is ready in the MCP process. If the user enabled Palace after some MCP-side fetches, run `openreply_palace_reindex` to backfill — fast (~2K posts/min).
