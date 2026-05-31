# Paper Palace — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add paper→paper relationship-finding (semantic neighbors + citation edges) on top of the existing paper-chunk ChromaDB collection, with an explicit academic-source guard so non-paper sources never enter — backend + CLI + Rust only, no UI.

**Architecture:** Build ON the existing `palace.py` paper-chunk collection (already populated via `chunk_paper(embed=True)` → `upsert_paper_chunks`). Add (1) an explicit `ACADEMIC_SOURCES` guard at the embed boundary, (2) a `paper_neighbors(post_id)` mean-pooled similarity query, (3) a `paper_relations.py` that materializes `relates_to` + `cites` edges into `graph_edges`, (4) CLI + Rust wrappers, (5) the `paper_gaps` table pre-create for Phase 2.

**Tech Stack:** Python 3.12, ChromaDB (bundled all-MiniLM-L6-v2 ONNX), sqlite-utils, numpy, Typer CLI, Rust/Tauri command wrappers, pytest.

---

## Reconciliation with existing code (read first)

The Explore pass under-reported. These ALREADY EXIST — do NOT recreate them:
- `src/gapmap/retrieval/palace.py`: `_PAPER_CHUNKS_COLLECTION = "paper_chunks"` (separate collection), `get_paper_chunks_collection()`, `upsert_paper_chunks(chunks, post_id, topic)`, `search_paper_chunks(query, k, topic, post_id, section_filter, rerank)`, `search_papers(...)`, `paper_chunks_stats()`.
- `src/gapmap/research/paper_chunks.py:212`: `chunk_paper(embed=True)` already calls `palace.upsert_paper_chunks(changed, post_id=post_id)`.
- `src/gapmap/research/paper_references.py`: `get_references(post_id)`, `get_cited_by(post_id)`, `resolve_to_existing_posts(post_id)`, `extract_topic_references(topic, limit, force)`.
- Canonical academic set: `src/gapmap/research/intents.py:194` →
  `('arxiv','pubmed','openalex','scholar','semantic_scholar','crossref')`.
- `graph_edges` schema (`core/db.py:409`): columns `src, dst, kind, topic, weight, metadata_json`; PK `(src, dst, kind)`. Upsert via `db["graph_edges"].upsert({...}, pk=("src","dst","kind"))`.

What's MISSING (this plan builds it): an explicit source guard, paper→paper `neighbors`, materialized `relates_to`/`cites` edges, CLI/Rust surface, and the `paper_gaps` table.

**Test bootstrap:** `tests/conftest.py` already puts `src/` on the path and points `GAPMAP_DATA_DIR` at a temp dir per test (verify; if a test needs an isolated DB, use the existing `clean_env`/tmp fixture pattern other tests use). Run tests with `.venv/bin/pytest`.

---

## Task 1: Centralize the academic-source guard

**Files:**
- Create: `src/gapmap/research/sources.py`
- Modify: `src/gapmap/research/paper_chunks.py` (gate the embed in `chunk_paper`)
- Test: `tests/test_paper_sources.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_paper_sources.py
from gapmap.research.sources import ACADEMIC_SOURCES, is_academic_source

def test_academic_set_exact():
    assert ACADEMIC_SOURCES == frozenset(
        {"arxiv", "pubmed", "openalex", "scholar", "semantic_scholar", "crossref"}
    )

def test_is_academic_source():
    assert is_academic_source("arxiv") is True
    assert is_academic_source("ArXiv") is True          # case-insensitive
    assert is_academic_source("reddit") is False
    assert is_academic_source("appstore") is False
    assert is_academic_source("playstore") is False
    assert is_academic_source("hackernews") is False
    assert is_academic_source(None) is False
    assert is_academic_source("") is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_paper_sources.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'gapmap.research.sources'`

- [ ] **Step 3: Write minimal implementation**

```python
# src/gapmap/research/sources.py
"""Single source of truth for which post source_types are academic papers.
Used to gate the paper palace: ONLY these sources are embedded into the
paper-chunk collection and considered for paper relationships/gaps. Mirrors
the set hardcoded in intents.py:194 — keep them in sync."""
from __future__ import annotations

ACADEMIC_SOURCES = frozenset(
    {"arxiv", "pubmed", "openalex", "scholar", "semantic_scholar", "crossref"}
)

def is_academic_source(source_type: str | None) -> bool:
    return bool(source_type) and source_type.strip().lower() in ACADEMIC_SOURCES
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_paper_sources.py -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Gate the embed boundary in `chunk_paper`**

In `src/gapmap/research/paper_chunks.py`, at the top of `chunk_paper(post_id, *, force, embed)` (after the early-return guards, before chunking/embedding), add an explicit academic-source check so a non-academic post can never embed into the paper collection:

```python
    # Explicit academic-source guard (defense in depth — chunking normally only
    # runs after the academic-only full-text gate, but never embed a
    # reddit/appstore/etc. post into the paper palace by accident).
    from .sources import is_academic_source
    from ..core.db import get_db
    _row = list(get_db().query(
        "SELECT coalesce(source_type,'reddit') AS s FROM posts WHERE id = ?",
        [post_id],
    ))
    if embed and _row and not is_academic_source(_row[0]["s"]):
        return {"ok": True, "post_id": post_id, "n_chunks": 0,
                "n_new": 0, "n_unchanged": 0, "embedded": 0,
                "skipped": "non_academic_source"}
```

- [ ] **Step 6: Write the guard test**

```python
# tests/test_paper_sources.py  (append)
def test_chunk_paper_skips_non_academic(tmp_path, monkeypatch):
    monkeypatch.setenv("GAPMAP_DATA_DIR", str(tmp_path))
    from gapmap.core.db import get_db, init_schema
    db = get_db(); init_schema(db)
    db["posts"].insert({"id": "r1", "title": "rant", "selftext": "x" * 4000,
                        "source_type": "reddit"}, pk="id")
    from gapmap.research.paper_chunks import chunk_paper
    out = chunk_paper("r1", embed=True)
    assert out.get("skipped") == "non_academic_source"
    assert out["embedded"] == 0
```

- [ ] **Step 7: Run + commit**

Run: `.venv/bin/pytest tests/test_paper_sources.py -v`  → Expected: PASS (3 tests)
```bash
git add src/gapmap/research/sources.py src/gapmap/research/paper_chunks.py tests/test_paper_sources.py
git commit -m "feat(papers): explicit academic-source guard for the paper palace"
```

---

## Task 2: `paper_neighbors(post_id)` — paper→paper semantic similarity

**Files:**
- Modify: `src/gapmap/retrieval/palace.py` (add after `search_papers`, ~line 1020)
- Test: `tests/test_paper_neighbors.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_paper_neighbors.py
import pytest
from gapmap.retrieval import palace

@pytest.mark.skipif(not palace.is_available(), reason="chromadb not installed")
def test_neighbors_excludes_self_and_ranks(tmp_path, monkeypatch):
    monkeypatch.setenv("GAPMAP_DATA_DIR", str(tmp_path))
    palace.drop_caches() if hasattr(palace, "drop_caches") else None
    def chunks(pid, text):
        return [{"id": f"{pid}#sec=abstract#ord=0", "post_id": pid,
                 "section": "abstract", "ord": 0, "text": text,
                 "char_count": len(text), "hash": pid}]
    palace.upsert_paper_chunks(chunks("p1", "graph neural networks for molecules"), post_id="p1", topic="t")
    palace.upsert_paper_chunks(chunks("p2", "graph neural network molecular property prediction"), post_id="p2", topic="t")
    palace.upsert_paper_chunks(chunks("p3", "ancient roman pottery kilns"), post_id="p3", topic="t")
    out = palace.paper_neighbors("p1", k=5)
    assert out["ok"] is True
    ids = [r["post_id"] for r in out["results"]]
    assert "p1" not in ids                 # self excluded
    assert ids and ids[0] == "p2"          # closest neighbor ranked first
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_paper_neighbors.py -v`
Expected: FAIL — `AttributeError: module 'gapmap.retrieval.palace' has no attribute 'paper_neighbors'`

- [ ] **Step 3: Write minimal implementation**

Add to `src/gapmap/retrieval/palace.py` after `search_papers`:

```python
def paper_neighbors(post_id: str, *, k: int = 8, topic: str | None = None) -> dict:
    """Semantic neighbors of a paper (paper→paper). Mean-pools the paper's own
    chunk embeddings, queries the paper-chunk collection with that vector, rolls
    chunk hits up to paper level, drops self. Returns
    ``{ok, results: [{post_id, score, n_chunks}], count}`` (ranked desc)."""
    if not is_available():
        return {"ok": False, "skipped": True, "reason": "chromadb not installed", "results": []}
    coll = get_paper_chunks_collection()
    if coll is None:
        return {"ok": False, "skipped": True, "reason": "palace unavailable", "results": []}
    try:
        own = coll.get(where={"post_id": post_id}, include=["embeddings"])
    except Exception as e:
        logger.warning("paper_neighbors get failed: %s", e)
        return {"ok": False, "error": str(e), "results": []}
    vecs = (own or {}).get("embeddings") or []
    if not vecs:
        return {"ok": True, "results": [], "count": 0, "reason": "paper not embedded"}
    import numpy as np
    mean_vec = np.mean(np.asarray(vecs, dtype="float32"), axis=0).tolist()
    where = {"topic": topic} if topic else None
    try:
        raw = coll.query(query_embeddings=[mean_vec], n_results=max(k * 6, 30), where=where)
    except Exception as e:
        logger.warning("paper_neighbors query failed: %s", e)
        return {"ok": False, "error": str(e), "results": []}
    _bump_embed_ts()
    metas = (raw.get("metadatas") or [[]])[0]
    dists = (raw.get("distances") or [[]])[0]
    best: dict[str, dict] = {}
    for m, d in zip(metas, dists):
        pid = (m or {}).get("post_id", "")
        if not pid or pid == post_id:
            continue
        sim = max(0.0, 1.0 - (d or 0.0) / 2.0)
        cur = best.get(pid)
        if cur is None or sim > cur["score"]:
            best[pid] = {"post_id": pid, "score": round(sim, 4), "n_chunks": 1}
        else:
            cur["n_chunks"] += 1
    results = sorted(best.values(), key=lambda r: r["score"], reverse=True)[:k]
    return {"ok": True, "results": results, "count": len(results)}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_paper_neighbors.py -v`
Expected: PASS (or SKIP if chromadb missing — acceptable; CI installs the `mcp` extra)

- [ ] **Step 5: Commit**

```bash
git add src/gapmap/retrieval/palace.py tests/test_paper_neighbors.py
git commit -m "feat(papers): paper_neighbors — mean-pooled paper-to-paper similarity"
```

---

## Task 3: `paper_relations.py` — materialize `relates_to` + `cites` edges

**Files:**
- Create: `src/gapmap/research/paper_relations.py`
- Test: `tests/test_paper_relations.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_paper_relations.py
def test_cites_edges_from_resolved_refs(tmp_path, monkeypatch):
    monkeypatch.setenv("GAPMAP_DATA_DIR", str(tmp_path))
    from gapmap.core.db import get_db, init_schema
    db = get_db(); init_schema(db)
    for pid in ("a", "b"):
        db["posts"].insert({"id": pid, "title": pid, "source_type": "arxiv"}, pk="id")
    db["topic_posts"].insert_all([
        {"topic": "t", "post_id": "a"}, {"topic": "t", "post_id": "b"}], pk=("topic", "post_id"))
    # a resolved reference: a cites b
    from gapmap.research.paper_references import _ensure_table
    _ensure_table()
    db["paper_references"].insert({
        "id": "a:1", "src_post_id": "a", "dst_post_id": "b", "dst_doi": "",
        "dst_arxiv_id": "", "dst_title": "b", "dst_year": 2024, "dst_authors_json": "[]",
        "raw": "b et al", "resolution_status": "ok", "extractor": "test",
        "fetched_at": ""}, pk="id")
    from gapmap.research.paper_relations import build
    out = build(topic="t", kinds=["cites"])
    assert out["ok"] is True
    edges = list(db.query(
        "SELECT src, dst, kind FROM graph_edges WHERE kind='cites'"))
    assert {"src": "a", "dst": "b", "kind": "cites"} in [dict(e) for e in edges]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_paper_relations.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'gapmap.research.paper_relations'`

- [ ] **Step 3: Write minimal implementation**

```python
# src/gapmap/research/paper_relations.py
"""Materialize paper->paper edges into graph_edges (academic nodes only).
Phase 1 kinds: `relates_to` (semantic neighbors) and `cites` (resolved
references). Each src capped to top-N to avoid hairballs."""
from __future__ import annotations
import json, os
from typing import Any

from ..core.db import get_db
from .sources import is_academic_source

_TOPN = int(os.getenv("PAPER_RELATES_TOPN") or 8)

def _academic_paper_ids(topic: str | None) -> list[str]:
    db = get_db()
    if topic:
        rows = db.query(
            "SELECT p.id AS id, coalesce(p.source_type,'reddit') AS s "
            "FROM topic_posts tp JOIN posts p ON p.id = tp.post_id WHERE tp.topic = ?",
            [topic])
    else:
        rows = db.query("SELECT id, coalesce(source_type,'reddit') AS s FROM posts")
    return [r["id"] for r in rows if is_academic_source(r["s"])]

def _upsert_edge(db, src: str, dst: str, kind: str, topic: str | None, weight: float, meta: dict):
    db["graph_edges"].upsert(
        {"src": src, "dst": dst, "kind": kind, "topic": topic or "",
         "weight": float(weight), "metadata_json": json.dumps(meta)},
        pk=("src", "dst", "kind"))

def build(topic: str | None = None, *, kinds: list[str] | None = None,
          force: bool = False) -> dict[str, Any]:
    kinds = kinds or ["relates_to", "cites"]
    db = get_db()
    ids = set(_academic_paper_ids(topic))
    made = {"relates_to": 0, "cites": 0}

    if "cites" in kinds:
        from .paper_references import get_references
        for pid in ids:
            for ref in get_references(pid):
                dst = ref.get("dst_post_id") or ""
                if ref.get("resolution_status") == "ok" and dst and dst in ids:
                    _upsert_edge(db, pid, dst, "cites", topic, 1.0,
                                 {"via": ref.get("extractor", "")})
                    made["cites"] += 1

    if "relates_to" in kinds:
        from ..retrieval import palace
        if palace.is_available():
            for pid in ids:
                nb = palace.paper_neighbors(pid, k=_TOPN, topic=topic)
                for r in nb.get("results", []):
                    dst = r["post_id"]
                    if dst in ids:
                        _upsert_edge(db, pid, dst, "relates_to", topic,
                                     r["score"], {"score": r["score"]})
                        made["relates_to"] += 1

    return {"ok": True, "topic": topic, "papers": len(ids), "edges": made}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_paper_relations.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/gapmap/research/paper_relations.py tests/test_paper_relations.py
git commit -m "feat(papers): materialize relates_to + cites edges into graph_edges"
```

---

## Task 4: CLI subcommands

**Files:**
- Modify: `src/gapmap/cli/main.py` (add near the other `research paper-*` commands, ~line 3650)

- [ ] **Step 1: Add the subcommands**

```python
@research_app.command("paper-neighbors")
def cmd_research_paper_neighbors(
    post_id: str = typer.Option(..., "--id"),
    k: int = typer.Option(8, "--k"),
    topic: str = typer.Option("", "--topic", "-t"),
    as_json: bool = typer.Option(True, "--json"),
) -> None:
    from ..retrieval import palace
    _emit(palace.paper_neighbors(post_id, k=k, topic=(topic or None)), as_json)

@research_app.command("paper-relations-build")
def cmd_research_paper_relations_build(
    topic: str = typer.Option("", "--topic", "-t"),
    kinds: str = typer.Option("relates_to,cites", "--kinds"),
    as_json: bool = typer.Option(True, "--json"),
) -> None:
    from ..research.paper_relations import build
    klist = [k.strip() for k in kinds.split(",") if k.strip()]
    _emit(build(topic=(topic or None), kinds=klist), as_json)
```

- [ ] **Step 2: Smoke-test via the daemon-free CLI**

Run (a real arxiv-bearing topic, e.g. "Indian community help app" which has 86 paper_analyses):
```bash
export GAPMAP_DATA_DIR="$HOME/Library/Application Support/com.shantanu.gapmap/gapmap"
.venv/bin/python -m gapmap.cli.main research paper-relations-build --topic "Indian community help app" --json
```
Expected JSON: `{"ok": true, "papers": <N>, "edges": {"relates_to": ..., "cites": ...}}`

- [ ] **Step 3: Commit**

```bash
git add src/gapmap/cli/main.py
git commit -m "feat(papers): CLI — paper-neighbors + paper-relations-build"
```

---

## Task 5: Rust + api.js wrappers (registration triangle)

**Files:**
- Modify: `app-tauri/src-tauri/src/commands.rs`, `app-tauri/src-tauri/src/main.rs`, `app-tauri/src/api.js`

- [ ] **Step 1: Add Rust commands** (in `commands.rs`, near the other `paper_*`):

```rust
#[tauri::command]
pub async fn paper_neighbors(app: AppHandle, post_id: String, k: Option<u32>, topic: Option<String>) -> Result<Value, String> {
    let kk = k.unwrap_or(8).to_string();
    let mut args = vec!["research", "paper-neighbors", "--id", &post_id, "--k", &kk, "--json"];
    let t = topic.unwrap_or_default();
    if !t.is_empty() { args.push("--topic"); args.push(&t); }
    run_cli(&app, args).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn paper_relations_build(app: AppHandle, topic: Option<String>, kinds: Option<String>) -> Result<Value, String> {
    let t = topic.unwrap_or_default();
    let ks = kinds.unwrap_or_else(|| "relates_to,cites".into());
    let mut args = vec!["research", "paper-relations-build", "--kinds", &ks, "--json"];
    if !t.is_empty() { args.push("--topic"); args.push(&t); }
    run_cli(&app, args).await.map_err(err_to_string)
}
```

- [ ] **Step 2: Register in `main.rs`** — add `commands::paper_neighbors, commands::paper_relations_build,` to the `generate_handler![]` list.

- [ ] **Step 3: Add to `api.js`:**

```js
  paperNeighbors: (postId, k = 8, topic = null) => invoke('paper_neighbors', { postId, k, topic }),
  paperRelationsBuild: (topic = null, kinds = 'relates_to,cites') => invoke('paper_relations_build', { topic, kinds }),
```

- [ ] **Step 4: Verify compile**

Run: `cd app-tauri/src-tauri && cargo check` → Expected: 0 errors.
Run: `cd app-tauri && node --check src/api.js` → Expected: OK.

- [ ] **Step 5: Commit**

```bash
git add app-tauri/src-tauri/src/commands.rs app-tauri/src-tauri/src/main.rs app-tauri/src/api.js
git commit -m "feat(papers): Rust + api wrappers for paper_neighbors + paper_relations_build"
```

---

## Task 6: Pre-create the `paper_gaps` table (for Phase 2)

**Files:**
- Modify: `src/gapmap/core/db.py` (in `init_schema`, near the other table creates)
- Test: `tests/test_paper_gaps_schema.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_paper_gaps_schema.py
def test_paper_gaps_table_created(tmp_path, monkeypatch):
    monkeypatch.setenv("GAPMAP_DATA_DIR", str(tmp_path))
    from gapmap.core.db import get_db, init_schema
    db = get_db(); init_schema(db)
    assert "paper_gaps" in db.table_names()
    cols = {c.name for c in db["paper_gaps"].columns}
    assert {"id", "topic", "kind", "title", "detail_json",
            "evidence_post_ids_json", "score", "created_at"} <= cols
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_paper_gaps_schema.py -v`
Expected: FAIL — `assert 'paper_gaps' in [...]`

- [ ] **Step 3: Add the create in `init_schema`**

```python
    if "paper_gaps" not in db.table_names():
        db["paper_gaps"].create({
            "id": str, "topic": str, "kind": str, "title": str,
            "detail_json": str, "evidence_post_ids_json": str,
            "score": float, "created_at": str,
        }, pk="id")
        db["paper_gaps"].create_index(["topic", "kind"])
```

- [ ] **Step 4: Run + commit**

Run: `.venv/bin/pytest tests/test_paper_gaps_schema.py -v` → Expected: PASS
```bash
git add src/gapmap/core/db.py tests/test_paper_gaps_schema.py
git commit -m "feat(papers): pre-create paper_gaps table (Phase 2 populates it)"
```

---

## Final verification (after all tasks)

- [ ] Run the full Python suite: `.venv/bin/pytest tests/ -q` → all pass.
- [ ] `cd app-tauri/src-tauri && cargo check` → 0 errors.
- [ ] Build the sidecar so the new CLI subcommands ship to prod:
      `rm -rf build dist && .venv/bin/pyinstaller gapmap-cli.spec && cp dist/gapmap-cli app-tauri/src-tauri/binaries/gapmap-cli-aarch64-apple-darwin && codesign --force --deep --sign - app-tauri/src-tauri/binaries/gapmap-cli-aarch64-apple-darwin` (Python-side change — needs sidecar rebuild per the skill).
- [ ] Changelog: `changelogs/2026-05-31_NN_paper-palace-phase1.md`.

## Phase 2/3 (NOT in this plan — separate plans later)

- Phase 2: `co_cited_with` + `co_evidenced` edges; `coverage` + `future_work` gaps (populate `paper_gaps`).
- Phase 3: `white_space` (cluster via `retrieval/cluster.py`) + `contradiction` gaps.
- Phase 4: UI.
