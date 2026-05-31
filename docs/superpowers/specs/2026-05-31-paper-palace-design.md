# Paper Palace — dedicated semantic + relational index for academic papers

**Date:** 2026-05-31
**Status:** Design (approved for spec review)
**Author:** Claude (with shaantanu)

## 1. Goal

Build a **separate, paper-only "memory palace"** for the research-paper feature
so the app can find **relationships** between papers, surface **research gaps**,
**link** papers to each other and to topics, and give a **proper flow between
papers** — without contaminating the index with non-academic sources (Reddit,
App Store, Play Store, HN, news, etc.).

Backend + logic first. UI is explicitly out of scope for this spec (a later,
separate effort).

## 2. Why this is feasible (current-state anchors)

- The app already has a memory palace: `src/gapmap/retrieval/palace.py` —
  a ChromaDB `PersistentClient` + bundled `all-MiniLM-L6-v2` ONNX embedder at
  `<data_dir>/palace/chroma.sqlite3`. Offline, zero external calls.
- Papers are already chunked into `paper_chunks`
  (`src/gapmap/research/paper_chunks.py`), with `embed` support and
  `embedded_at`/`embed_backend` columns — but they are **not embedded into a
  dedicated paper index**, and no semantic/relationship layer reads them.
- Citations are already extracted into `paper_references`
  (`src/gapmap/research/paper_references.py`) with resolution to local posts —
  but never materialized into `graph_edges`. The code itself notes the missing
  "promote to `cites` edges" wrapper.
- Paper sections (incl. `limitations`, `future_work`) are already parsed into
  `paper_sections` (`src/gapmap/research/paper_sections.py`).
- A clustering helper already exists: `src/gapmap/retrieval/cluster.py`.
- The canonical academic-source set already lives in
  `src/gapmap/research/intents.py:194`:
  `('arxiv','pubmed','openalex','scholar','semantic_scholar','crossref')`.

So the heavy infra exists. This spec adds the **dedicated paper collection +
relationship layer + gap layer + query API** on top.

## 3. Non-goals

- No UI in this spec (later effort).
- No new academic-source adapters / fetchers (use what's collected).
- No external citation-network API calls (resolution stays corpus-local for
  now; unresolved refs are recorded but not back-fetched in Phase 1).

## 4. Architecture

```
posts (academic sources ONLY)
  → paper_chunks                      [exists]
  → [NEW] paper_palace.build()        →  ChromaDB collection "papers_palace"
                                          (separate from the general palace;
                                           reuses the SAME ONNX embedder)
  → [NEW] paper_relations.build()     →  graph_edges (paper→paper)
  → [NEW] paper_gaps.find()           →  paper_gaps table
  → query API: neighbors / relations / gaps   → (UI later)
```

### 4.1 The source guarantee (hard requirement)

A single helper `is_academic_source(src)` / `ACADEMIC_SOURCES` (centralized,
sourced from the existing `intents.py` set) gates **both**:
- **ingest** — `paper_palace.build()` only embeds chunks whose post has
  `source_type IN ACADEMIC_SOURCES`; and
- **query** — every relationship/gap query joins on the same filter.

Reddit / appstore / playstore / hn / gnews / devto / etc. can never enter the
paper palace, even if a chunk row slips in.

### 4.2 Scope: global, topic-tagged

ONE collection `papers_palace` holds every academic paper chunk. Each chunk's
ChromaDB metadata carries `post_id`, `topic` (the topic tag(s) via
`topic_posts`), `section`, `source_type`. Queries can filter by `topic` (within
a topic) OR omit it (cross-topic discovery — a method from topic A surfacing for
a gap in topic B).

## 5. Components (new)

### 5.1 `src/gapmap/research/paper_palace.py`
- `ACADEMIC_SOURCES` (import/re-export the canonical set).
- `build(topic: str | None = None, *, force=False) -> dict` — for each academic
  paper (optionally scoped to a topic), ensure chunks exist, embed them into the
  `papers_palace` ChromaDB collection with metadata. Idempotent via the existing
  chunk `hash`. Returns `{ok, embedded, skipped, papers, collection_count}`.
- `neighbors(post_id: str, k: int = 8, topic: str | None = None) -> list` —
  semantic neighbors of a paper (mean-pool its chunk vectors OR query by its
  chunks), filtered to academic sources, optionally same-topic. Returns ranked
  `[{post_id, score, title, ...}]`, excluding self.
- `status() -> dict` — collection presence, count, model readiness (mirrors the
  existing `palace.model_status()` shape).
- Graceful `chromadb`-missing degradation (same pattern as `palace.py`): return
  `{ok: False, skipped: True, reason}` rather than raising.

### 5.2 `src/gapmap/research/paper_relations.py`
Materializes paper→paper edges into `graph_edges` (kind tags below), academic
nodes only, each capped per-paper top-N (the `dense-graph-relations` pattern,
to avoid hairballs):
- `relates_to` — semantic similarity from `paper_palace.neighbors` (Phase 1).
- `cites` — the missing wrapper: read resolved `paper_references`
  (`resolution_status='ok'`, `dst_post_id != ''`) → edges src→dst (Phase 1).
- `co_cited_with` — bibliographic coupling: papers sharing ≥N references (Phase 2).
- `co_evidenced` — both papers are `has_evidence` for the same painpoint/finding
  (Phase 2).
- `build(topic=None, *, kinds=[...], force=False) -> dict`.

### 5.3 `src/gapmap/research/paper_gaps.py` + `paper_gaps` table
New table `paper_gaps(id, topic, kind, title, detail_json, evidence_post_ids_json, score, created_at)`.
`kind` ∈ `future_work | white_space | coverage | contradiction`.
- **future_work** (Phase 2): aggregate `paper_sections` where name IN
  ('future_work','limitations'); LLM-summarize open problems; flag those not
  semantically addressed by another paper (palace check).
- **white_space** (Phase 3): cluster `papers_palace` vectors via the existing
  `cluster.py`; label clusters; flag sparse regions + unexplored between-cluster
  combinations.
- **coverage** (Phase 2): cross-join app painpoints/findings with their
  `has_evidence` papers — painpoint with 0 papers = gap-to-fill; paper cluster
  with 0 painpoint links = untapped opportunity.
- **contradiction** (Phase 3): LLM pairwise claim comparison on
  highly-similar paper pairs. Heaviest; last.
- `find(topic, *, kinds=[...]) -> dict`.

### 5.4 Surface (backend only — wired for the future UI)
- **CLI** (`src/gapmap/cli/main.py`): `research paper-palace build|neighbors|status`,
  `research paper-relations build`, `research paper-gaps find`. Each `--json`,
  each tolerant/skip-gracefully on no-LLM / no-chromadb.
- **Rust** (`app-tauri/src-tauri/src/commands.rs`): thin command wrappers
  (`paper_palace_build`, `paper_neighbors`, `paper_relations_build`,
  `paper_gaps_find`) registered in `main.rs`, exposed in `api.js`. Read-only
  queries (neighbors list, gaps list, relations list) use the **native rusqlite**
  path (Phase 17 pattern) where they are plain SELECTs.

## 6. Data model changes

- **New ChromaDB collection** `papers_palace` (separate file/collection from the
  general palace; same embedder).
- **New table** `paper_gaps` (above). Pre-created in `init_schema`.
- **`graph_edges`** — reuse existing table; add the new `kind` values
  (`relates_to`, `cites`, `co_cited_with`, `co_evidenced`) scoped to
  academic-source paper nodes. No schema change (kind is free-text).
- No change to `paper_chunks` / `paper_references` / `paper_sections` schemas.

## 7. Data flow (Phase 1 happy path)

1. User (later, via UI) or CLI calls `paper-palace build --topic T`.
2. For each academic paper in T: ensure full text + chunks, embed chunks into
   `papers_palace` (skip unchanged by hash).
3. `paper-relations build --topic T` computes `relates_to` (palace neighbors,
   top-8 capped) + `cites` (from resolved references) → `graph_edges`.
4. `paper-neighbors --id P` returns the semantic + cited/citing neighbors of P.
5. (Phase 2+) `paper-gaps find --topic T` populates `paper_gaps`.

## 8. Error handling

- `chromadb` not installed → palace functions return
  `{ok: False, skipped: True, reason}`; relations still build `cites`
  (citation-only, no semantic). Never raise into the UI.
- No LLM configured → gap kinds that need an LLM (future_work, contradiction)
  return `{ok: False, skipped: True, reason, error_class: "llm_key"}`;
  non-LLM gaps (coverage, white_space) still run.
- Missing tables on fresh install → return empty, not error (native reads
  catch "no such table").

## 9. Testing

- `tests/test_paper_palace.py`:
  - `is_academic_source` excludes reddit/appstore/etc., includes the 6 academic.
  - `build` embeds only academic chunks (seed a reddit + an arxiv post; assert
    only the arxiv chunks land in `papers_palace`).
  - `neighbors` returns self-excluded, academic-only, score-ranked results.
  - `cites` edges materialize only from resolved `paper_references`.
  - Graceful skip when chromadb absent (monkeypatch import).
- Parity/idempotency: re-running `build` embeds 0 new (hash dedup).

## 10. Phasing (build order)

- **Phase 1 (this implementation):** `paper_palace` (build/neighbors/status,
  source-filtered) + `relates_to` + `cites` edges + CLI + Rust wrappers + tests.
  Ships the "related papers" + citation graph — ~70% of the value.
- **Phase 2:** `co_cited_with` + `co_evidenced` edges; `coverage` +
  `future_work` gaps.
- **Phase 3:** `white_space` (cluster) + `contradiction` gaps.
- **Phase 4 (separate):** UI.

## 11. Decisions

- **Paper vector for neighbors = mean-pooled chunk embeddings.** Decided (not
  open): compute each paper's representative vector as the mean of its chunk
  vectors, store/query that. Simpler and standard; avoids per-chunk fan-out at
  query time. (Per-chunk query + aggregate is a possible future refinement.)
- Top-N cap for `relates_to` = 8 per paper by default, tunable via env (the
  `dense-graph-relations` pattern, to prevent hairballs).
- Cross-topic neighbors are ON by default; the topic filter is opt-in per query.

## 12. Files touched (Phase 1)

**New:** `paper_palace.py`, `paper_relations.py`, `tests/test_paper_palace.py`.
**Modified:** `cli/main.py` (new subcommands), `core/db.py` or schema init
(`paper_gaps` table pre-create — even if populated in Phase 2),
`commands.rs` + `main.rs` + `api.js` (thin wrappers). `intents.py` /a shared
module (export `ACADEMIC_SOURCES` if not already importable).
**Prod note:** Python changes ship to the DMG via a sidecar rebuild.
