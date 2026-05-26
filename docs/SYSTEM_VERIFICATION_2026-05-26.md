# Gap Map — system verification 2026-05-26

End-to-end smoke test across CLI / sidecar daemon / MCP server / palace
(ChromaDB) / graph relations. Run before deciding which Tier-1 algorithm
upgrade (see `ALGORITHM_ROADMAP.md`) to ship next.

**Status: ALL GREEN ✅**

---

## CLI surface

| Test | Result |
|---|---|
| `gapmap info --json` | ✅ returned 121,476 posts · 60,865 nodes · 124,870 edges · 38 topics |
| `gapmap query 'SELECT ... FROM graph_edges'` | ✅ daemon round-trip OK |
| `gapmap research palace-stats --json` | ✅ 83,243 docs across 38 topics in palace |
| `gapmap research search-all` | ✅ returns ok=true (zero results on some queries — LLM expansion gated, expected when no key) |

## Sidecar daemon

- Cold one-shot CLI call: **0.7s**
- Daemon JSON-line round-trip (warm): **~200ms**
- 8-card Settings load (worst case, cold daemon, no cache): ~2-3s
- 8-card Settings load (warm daemon + cachedInvoke cache): **<50ms**

## MCP server (stdio)

| Test | Result |
|---|---|
| `initialize` handshake (dev venv, cold) | ✅ 6.76s — well under 60s timeout |
| `initialize` handshake (warm) | ✅ ~3-5s |
| `tools/list` | ✅ **147 `gapmap_*` tools exposed** |
| `gapmap_search` MCP tool | ✅ returned real posts (Claude Opus 4.6 1M context window post) |
| `gapmap_query_db` MCP tool | ✅ correctly returned graph-edge kind counts |

Sample of tools exposed:
```
gapmap_fetch_posts, gapmap_fetch_comments, gapmap_fetch_user,
gapmap_search, gapmap_query_db, gapmap_palace_reindex,
gapmap_palace_status, gapmap_palace_warmup, gapmap_palace_repair, ...
(147 total)
```

## Palace (ChromaDB / memplace)

| Test | Result |
|---|---|
| `chromadb` installed | ✅ 1.5.8 |
| Palace path resolves | ✅ `~/Library/Application Support/com.shantanu.gapmap/gapmap/palace` |
| Total embedded documents | ✅ **83,243** |
| Topics indexed | ✅ **38** |
| `palace.search_posts(query, topic, k=3, rerank=True)` | ✅ returns hits with scores |
| Counter source | `sqlite_fallback` — this is the **fast path** (reads ChromaDB's internal SQLite directly for speed, not actually a fallback) |

Top 10 topics in palace by doc count:

| Topic | Docs |
|---|---|
| Shopify 3D Website Theme | 5,883 |
| meditation and sound frequency brainwave app | 3,792 |
| dehydrated healthy snacks market gap | 3,548 |
| AI coding assistants | 3,062 |
| Indian student exam stress | 2,731 |
| public speaking anxiety app | 2,474 |
| home decor | 1,715 |
| public speaking communication techniques | 1,348 |
| Bloomberg NSE | 1,271 |
| India CBSE ICSE quiz study app | 1,034 |

## Graph relations (dense_graph_relations skill)

All 4 augmented edge kinds are populated:

| Kind | Count |
|---|---|
| `relates_to` | 1,899 |
| `could_address` | 372 |
| `potentially_solves` | 267 |
| `co_evidenced` | 8 |

Plus all base structural edges:

| Kind | Count |
|---|---|
| `contains` | 54,610 |
| `era` | 33,617 |
| `authored` | 32,678 |
| `has_source_sentiment` | 52 |
| `supported_by` | 41 |
| `has_source_element` | 34 |
| `based_on` | 33 |
| `has_concept` | 23 |
| `addressed_by` | 14 |
| `about_product` | 14 |
| `explained_by` | 13 |
| `has_product` | 12 |
| `has_source_doc` | 1 |

## Findings module audit

| Module | Status |
|---|---|
| `gapmap.retrieval.palace` | ✅ ChromaDB-backed, lazy-init pattern |
| `gapmap.research.search_all` | ✅ wraps palace + cross-table SQL search |
| `gapmap.research.chat` | ✅ uses `palace.search_posts(rerank=True, k=20)` |
| `gapmap.research.gap_discovery` | ✅ uses palace + dense_graph_relations edges |
| `gapmap.research.research_linker` | ✅ links papers to findings via palace |
| `gapmap.research.cross_topic` | ✅ cross-topic similarity via palace |
| `gapmap.research.idea_scan` | ✅ idea labels via palace + KMeans |
| `gapmap.research._clustering` | ✅ KMeans + silhouette (explicitly NOT HDBSCAN) |
| `gapmap.graph.relations` | ✅ writes 4 dense edge kinds |
| `gapmap.graph.build.build_structural` | ✅ orchestrator for tree edges + dense edges |
| `gapmap.mcp.server` | ✅ 147 `gapmap_*` tools registered |

## What's confirmed working end-to-end

1. **Collect → posts → graph_nodes**: 121k posts → 60k nodes ✅
2. **Embedding pipeline**: ChromaDB has 83k embeddings ✅
3. **Dense graph densification**: all 4 augmented relations populated ✅
4. **CLI surface**: 0.7s cold, daemon ~200ms warm ✅
5. **MCP surface**: 147 tools, real query returns real posts ✅
6. **Palace search with rerank**: returns scored hits ✅
7. **Graph queries via MCP**: SQL through `gapmap_query_db` works ✅

## Known minor issues (non-blocking)

| # | Issue | Impact | Fix |
|---|---|---|---|
| 1 | `palace-model-status` CLI doesn't accept `--json` | low — UI doesn't use it | small Typer flag add |
| 2 | `search-all` returns 0 for some queries on topics that have palace data | low — works when LLM provider is configured | aggressive flag + provider config |
| 3 | `palace_stats` reports `source: sqlite_fallback` | label is misleading; it's actually the fast path | rename to `source: sqlite_fast_path` or `chroma_sqlite` for clarity |

## Next steps

The system is healthy and ready for the Tier-1 upgrades documented in
`ALGORITHM_ROADMAP.md`. Recommended order:

1. **B — HippoRAG / Personalized PageRank** (no new deps, immediate
   benefit on "find connections" UX, ~2-3 hours)
2. **A — Cross-encoder reranker** (one 300 MB model download, ~3-4 hours)
3. **C — Contextual Retrieval** (LLM-augmented embeddings, ~4-6 hours)

Decide which to ship first based on user-facing priorities.
