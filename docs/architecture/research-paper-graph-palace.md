# Research Paper · Linking · Knowledge Graph · Memory Palace — Architecture & Flows

> **Scope:** how the four research subsystems are built end-to-end — UI (JS) → Rust commands → Python sidecar → SQLite/ChromaDB — with file:line citations. Use this as the map for understanding or extending any of them.
>
> _Citations are approximate where noted; re-run `graphify query` / `codegraph_search` for the exact current line if a file has moved._

---

## 0. The 3-tier architecture (read this first)

Every feature in this app is the same triangle. The UI never touches data directly — it calls a Rust command, which shells out to the Python sidecar, which owns SQLite + ChromaDB.

```
┌─────────────────────────────────────────────────────────────────┐
│  FRONTEND (vanilla JS, Vite)        app-tauri/src/                 │
│   screens/*.js  ──render()──►  UI                                  │
│        │  calls api.<fn>()                                          │
│        ▼                                                            │
│   api.js  ── invoke('<cmd>', {..}) / listen('<event>') ──►          │
└────────────────────────────────│──────────────────────────────────┘
                                  │  Tauri IPC
┌─────────────────────────────────▼──────────────────────────────────┐
│  RUST (Tauri 2)                 app-tauri/src-tauri/src/             │
│   commands.rs  #[tauri::command] fn  ── run_cli(["research", …]) ──► │
│   cli.rs       run_cli() spawns the Python sidecar                  │
│   main.rs      generate_handler!(...) registers every command       │
└────────────────────────────────│──────────────────────────────────┘
                                  │  subprocess (NDJSON / JSON on stdout)
┌─────────────────────────────────▼──────────────────────────────────┐
│  PYTHON SIDECAR                 src/gapmap/                          │
│   cli/main.py        argparse → cmd_* handlers                      │
│   sources/ research/ graph/ retrieval/   ← the real logic           │
│   core/db.py         SQLite (gapmap.db, ~62 tables)                 │
│   retrieval/palace.py ChromaDB + ONNX MiniLM embeddings             │
└─────────────────────────────────────────────────────────────────────┘
```

**The "command registration triangle"** — to add or change any command you must touch all three:
1. `app-tauri/src/api.js` — a JS wrapper that calls `invoke('<cmd>', {...})`.
2. `app-tauri/src-tauri/src/commands.rs` — the `#[tauri::command]` fn that calls `run_cli`.
3. `app-tauri/src-tauri/src/main.rs` — add the fn to the `generate_handler!(...)` list (миссing this = build error `__cmd__<name>` not found).

Plus the Python side: a `cmd_*` handler wired into `src/gapmap/cli/main.py`'s argparse.

**Two return styles:**
- **One-shot JSON** — Rust calls `run_cli`, parses the JSON once, returns it. (Most commands.)
- **NDJSON streaming** — long ops (graph enrich, palace warmup/reindex) emit progress lines that Rust forwards as Tauri events (`enrich:progress`, `palace:warmup:done`, …). The JS `api.js` wrapper `listen()`s for those.

---

## 1. Research paper management

### Where it lives
| Layer | Location |
|---|---|
| Fetch sources | `src/gapmap/sources/collect_adapter.py:816` (`SOURCES` registry), `sources/pubmed.py:79` (`fetch_pubmed`) — arxiv, openalex, semantic scholar, pubmed, crossref, scholar |
| Full text | `src/gapmap/research/paper_fulltext.py` (PDF download + extract) |
| Sections | `src/gapmap/research/paper_sections.py:173` (`parse_sections_for`) |
| Chunking | `src/gapmap/research/paper_chunks.py:128` (`chunk_paper`) |
| Embedding | `src/gapmap/retrieval/palace.py:333` (`upsert_paper_chunks`) |
| LLM analysis | `src/gapmap/research/paper_analyze.py` (`analyze_paper`) |
| MCP tools | `src/gapmap/mcp/server.py` — `gapmap_papers:912`, `gapmap_paper_sections:1060`, `gapmap_paper_chunk:1098`, `gapmap_paper_chunk_topic:1165`, `gapmap_paper_research_pipeline:1731`, `gapmap_paper_fulltext`, `gapmap_paper_chunk_search`, `gapmap_analyze_paper` |
| Rust | `commands.rs` — `paper_research_pipeline:1564`, `paper_outline_generate:1598`, `paper_draft_generate:1617`, `paper_export_with_citations:1659`, `paper_pdf_fetch:3776` |
| JS API | `api.js` — `analyzePaper:482`, `paperAnalysesGet:490`, `paperOutlineGenerate:924`, `paperDraftGenerate:925`, `paperExportWithCitations:933` |
| **UI screen** | `app-tauri/src/screens/papers.js` — list with citation counts, Unpaywall PDF links, export toolbar (BibTeX/RIS/APA/Markdown). `renderList:137`, `renderRow:83`, `renderSearchHeader:50` |

### Tables
`posts` (paper rows, `source_type='arxiv'…`) · `paper_full_texts` · `paper_sections` · `paper_chunks` · `paper_analyses` · `paper_references`

### Flow (6 stages, each writes its own table)
1. **Fetch** → `gapmap_papers` pulls from the source registry → `posts`.
2. **Full text** → `paper_fulltext` downloads OA PDF/text → `paper_full_texts`.
3. **Sections** → parse into Abstract/Methods/Results/… → `paper_sections`.
4. **Chunk** → section-aware windows, hash-stable ids → `paper_chunks`.
5. **Embed** → `upsert_paper_chunks` → ChromaDB `paper_chunks_collection`.
6. **Analyze** → LLM summary/relevance/takeaway → `paper_analyses`.

---

## 2. Linking (finding ↔ paper)

### Where it lives
| Layer | Location |
|---|---|
| Core | `src/gapmap/research/research_linker.py` — `link_findings_for_topic:66`, `_finding_query_text:57`, `get_links_for_finding:165`, `get_links_summary:185` |
| MCP | `gapmap_link:2888` (create), `gapmap_links:2896` (read/count) |
| Rust | `commands.rs` — `link_research:1714`, `research_links:1728` |
| JS API | `api.js` — `linkResearch:943` (+ `mutated('research_links')`), `researchLinks:947` |

### Table
`finding_research_links` (finding_id, finding_title, post_id, similarity, top_chunk_id, ts).

### Flow (3 steps)
1. Iterate `graph_nodes` for the topic where `kind ∈ {painpoint, feature_wish, product_complaint, diy_workaround}`.
2. Build a query from each finding → `palace.search_paper_chunks(k=3)`.
3. Upsert `finding_research_links` rows (finding → top paper post_ids + similarity).

**Purpose:** grounds each user pain/feature node in academic papers. This is the bridge between the graph and the paper corpus.

---

## 3. Knowledge graph

### Where it lives
| Layer | Location |
|---|---|
| Structural build | `src/gapmap/graph/build.py:178` (`build_structural`) |
| Semantic (LLM) | `src/gapmap/graph/semantic.py:228` (`upsert_semantic`), `enrich_from_llm:454`, `backfill_source_evidence:143` |
| Relations | `src/gapmap/graph/relations.py` (`build_semantic_relations` → relates_to / potentially_solves / could_address) |
| Analysis | `src/gapmap/graph/analyze.py` — `pagerank_nodes:101`, `detect_communities` (Leiden), `betweenness_bridges` |
| Insights | `src/gapmap/graph/insights.py` — knowledge_gaps, surprising_connections, cross_source_bridges, god_nodes |
| Export | `src/gapmap/graph/export.py` (D3 JSON) |
| MCP | `gapmap_graph_build/_pagerank/_communities/_bridges/_neighbors/_top_nodes/_structural_summary/_export_json` |
| Rust | `commands.rs` — `build_graph:1128`, `enrich_graph:1143`, `enrich_graph_stream:1180` (NDJSON), `relate_graph:1311`, `cancel_enrich_for_topic:999`, `clear_graph_inflight:951` |
| JS API | `api.js` — `buildGraph:559`, `enrichGraph:564`, `enrichGraphStream:578` (listens `enrich:progress` / `enrich:stream:done`), `relateGraph:587`, `cancelEnrich:604` |

### Tables
`graph_nodes` (kind ∈ painpoint/product/workaround/feature_wish/topic/subreddit/user/post/comment/company; `metadata_json`; `evidence_post_id`) · `graph_edges` (`kind` carries confidence: `EXTRACTED` / `INFERRED` / `AMBIGUOUS`) · `communities` (Leiden clusters).

### Flow (5 layers)
1. **Structural** → nodes (topic/post/comment/user/subreddit) + containment/authorship edges.
2. **Semantic** → LLM findings (painpoint/feature/product/workaround) + `evidence_post_id` backlinks.
3. **Relations** → ChromaDB similarity → `relates_to`/`potentially_solves`/`could_address` (INFERRED).
4. **Communities** → Leiden → `community_id` per node.
5. **Analysis** → PageRank, betweenness bridges, insight queries.

### Concurrency guard
`commands.rs` keeps an `ActiveGraphOps` Mutex (≈875–945) keyed by `(op, topic)` so a topic can't run the same heavy graph op twice; `clear_graph_inflight` is the manual escape hatch and `cancel_enrich_for_topic` SIGTERMs the active sidecar.

---

## 4. Memory palace (semantic search)

### Where it lives
| Layer | Location |
|---|---|
| Core | `src/gapmap/retrieval/palace.py` — `is_available:70`, `get_palace`, `get_embedding_function`, `upsert_posts_many:207`, `search_posts:407` (hybrid), `related_posts:486`, `reindex_all:537`, `upsert_paper_chunks:333`, `search_paper_chunks:398`, `heal_corrupt_index`, `warmup_model` |
| Embedder | `src/gapmap/retrieval/embedder.py` (ONNX MiniLM; env `GAPMAP_EMBEDDING_MODEL`, default `all-MiniLM-L6-v2`) |
| Relevance | `src/gapmap/research/relevance.py` — `score_posts`, `filter_topic_posts`, `filter_findings` |
| MCP | `gapmap_palace_warmup/status/reindex/repair`, `search_posts`, `related_posts`, `paper_chunk_search` |
| Rust | `commands.rs` — `palace_warmup:4686` (NDJSON), `palace_reindex:4707` (NDJSON), `palace_prewarm:4674`, `palace_stats:4643`, `palace_model_status:4654`, `reindex_palace:4635`, `semantic_search`, `related_posts` |
| JS API | `api.js` — `semanticSearch:759`, `relatedPosts:761`, `reindexPalace:763`, `palaceStats:771`, `palaceModelStatus:775`, `palaceWarmup:779` (listens `palace:warmup:*`), `palacePrewarm:787`, `palaceReindex:792` (listens `palace:reindex:*`) |
| **UI** | `app-tauri/src/screens/search.js` — ad-hoc search; semantic results surface through `semanticSearch`. Palace status/warmup typically lives in the Settings screen. |

### Storage layout
```
<data_dir>/palace/
  ├── chroma.sqlite
  └── data/<collection>/  (chroma.parquet + index/index.bin  ← HNSW)
<data_dir>/models/sentence-transformers/all-MiniLM-L6-v2/   (~80 MB ONNX)
```
Collections: `posts_collection`, `paper_chunks_collection`.

### Flow
1. **Warmup** → download + cache ONNX model on first use.
2. **Index** → batch-embed `posts` (title + body[:2048]) → `posts_collection`; `upsert_paper_chunks` → `paper_chunks_collection`.
3. **Search** → cosine (HNSW) + BM25 rerank (0.6·vector + 0.4·BM25).
4. **Self-heal** → on HNSW corruption, `heal_corrupt_index` moves the index aside; user then runs reindex. (Note: this is the WAL/side-file safety code — it must never delete the live `-wal`/`-shm`.)

---

## 5. How the four connect

```
Papers ──chunk+embed──► PALACE (paper_chunks_collection) ─┐
   │                                                       │ semantic search
   └─fetch─► posts ──embed──► PALACE (posts_collection)    │
                                                           ▼
Corpus ─LLM extract─► GRAPH nodes (findings) ─link_findings_for_topic─► finding_research_links ─► Papers
                            │
                            └─► analyze (pagerank / communities / bridges) ─► insights
```

- **Palace is the shared semantic engine** — both the graph's INFERRED relation edges and the finding→paper linking call `palace.search_*`.
- **Linking** is the bridge: graph findings ↔ paper corpus, via `finding_research_links`.
- Everything keys off the same `gapmap.db` (SQLite, ~62 tables) and the same ONNX embedder.

---

## 6. Frontend mechanics (how the UI is handled)

### Routing — `app-tauri/src/main.js`
- **Hash routing** (`#/papers`, `#/graph`, …). The router matches `location.hash` against a routes array and dispatches `await route.render(main, { params })`.
- Each screen **exports an async `render(main, {params})`** entrypoint (e.g. `screens/search.js → renderSearch`).
- Tab system in `lib/tabs.js` (Chrome-style tabs, localStorage-backed, scroll-position preserved across re-render). Sidebar nav toggles `.nav a.active`.

### `api.js` — the JS↔Rust bridge
- Wraps `@tauri-apps/api` `invoke`. `DEFAULT_INVOKE_TIMEOUT_MS = 90_000`; `Promise.race` with a timeout sentinel + single backoff retry.
- **Two-layer cache** (≈23–91): in-memory `_cache` (TTL, default 5 s) + `_inflight` dedup (burst re-renders collapse to one call) + localStorage SWR (`readPersisted`/`writePersisted`, build-output cached 7 days).
- **Mutation broadcast** (≈261–375): `mutated(kind)` looks up `INVALIDATE_MAP`, clears affected cache keys, and dispatches a `gapmap:changed` event so other screens refetch. `graph`, `findings`, `research_links`, `collect` are all keys here.
- **DB-freshness poll** (≈377–430): polls `db_mtime` every 5 s while the window is visible, dispatches `gapmap:db-changed` on external writes.

### Rust — `commands.rs` / `cli.rs` / `main.rs`
- Each command is an `async fn` annotated `#[tauri::command]` that builds a `["research", "<subcmd>", "--topic", …, "--json"]` arg vec and calls `run_cli` (in `cli.rs`), which spawns the Python sidecar and parses stdout.
- Streaming commands pass `--stream` and forward each NDJSON line as a Tauri event.
- Every command must be listed in `main.rs`'s `generate_handler!(...)`.

### Loaders / state
- `lib/skeleton.js` (`skelRows`) for skeleton loading rows; `lib/screenCache.js` (`readScreenCache`/`writeScreenCache`) for per-screen state; `lib/busyButton.js` (`withButtonBusy`) to disable a button during an async op; `lib/analyzingLoader.js` for the long-op "alive" loader (spinner + cycling stages).

### End-to-end example — open Papers tab → list analyses → export
1. Router sees `#/papers` → `papers.js render()`.
2. Screen calls `api.paperAnalysesGet(topic)`.
3. `api.js` `cachedInvoke` → dedup/TTL check → `invoke('paper_analyses_get', {topic})`.
4. Rust command → `run_cli(["research","paper-analyses-get","--topic",topic,"--json"])`.
5. Python reads `paper_analyses` from `gapmap.db` → returns JSON.
6. Result cached (TTL + localStorage SWR); `papers.js renderList()` paints rows (`renderRow:83`), skeleton shown while loading.
7. Export → `api.paperExportWithCitations(topic,'bibtex')` → `paper_export_with_citations:1659` → sidecar → file download.

---

## 7. How to extend (cheat sheet)

**Add a new research command** (e.g. `paper_foo`):
1. **Python:** add `cmd_paper_foo` and wire it into `cli/main.py` argparse (subcommand under `research`).
2. **Rust:** add `#[tauri::command] async fn paper_foo(app, topic) -> Result<Value,String>` in `commands.rs` calling `run_cli(["research","paper-foo","--topic",&topic,"--json"])`.
3. **Rust:** add `commands::paper_foo` to `generate_handler!` in `main.rs` (skip = build error).
4. **JS:** add `paperFoo: (topic) => invoke('paper_foo', {topic})` to `api.js`.
5. **UI:** call `api.paperFoo()` from the relevant `screens/*.js`.
6. If it mutates data, call `api.mutated('<kind>')` after so other screens refresh.

**Long-running op?** Emit NDJSON progress from Python, forward as events in the Rust command, and `listen()` in the api.js wrapper (copy the `enrich_graph_stream` / `palace_warmup` pattern).

---

_See also: `src/gapmap/mcp/server.py` for the full MCP tool surface, and the `tauri-python-sidecar-app` skill for the command-registration-triangle and NDJSON-streaming patterns._
