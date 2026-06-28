# 1A — Provenance & Auditability Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Tag every generated artifact with provenance, record quality-gate checks in a ledger, and link artifacts to their source posts via a lineage table — all additive and non-fatal.

**Architecture:** Two new SQLite tables (`checks_ledger`, `lineage`) + one new column (`graph_nodes.provenance`) created idempotently in `init_schema`. Two best-effort helpers (`record_check`, `record_lineage`) mirror the existing `log_fetch_start` `-1`-sentinel pattern. A `run_id` contextvar groups rows per pipeline run. Provenance is threaded through the single node-write path `_upsert_node`. A read-only vanilla-JS panel + two thin MCP query tools surface the data.

**Tech Stack:** Python 3.11 (`.venv`), sqlite-utils, pytest, vanilla JS (Tauri), Rust (only if a new MCP/query command is needed — reuse `run_query` where possible).

**Env:** all pytest via `./.venv/bin/python -m pytest ... -v` from repo root.

---

## Conventions
- Non-fatal contract: ledger/lineage writes catch all exceptions and return `-1` / no-op; they NEVER raise (mirror `core/db.py:1405`).
- Migrations idempotent: guard every CREATE/ADD COLUMN with existence checks (mirror `core/db.py:455`).
- Run tests: `./.venv/bin/python -m pytest tests/<file> -v`.

---

## Task 1: Schema — provenance column + checks_ledger + lineage tables

**Files:**
- Modify: `src/openreply/core/db.py` (in `init_schema`, near the `graph_nodes` block ~432-460)
- Test: `tests/test_provenance_schema.py`

- [ ] **Step 1: Write the failing test**
```python
# tests/test_provenance_schema.py
import os, tempfile
def _fresh_db(monkeypatch):
    d = tempfile.mkdtemp(); monkeypatch.setenv("OPENREPLY_DATA_DIR", d)
    import importlib, openreply.core.db as db; importlib.reload(db)
    db.get_db.cache_clear() if hasattr(db.get_db, "cache_clear") else None
    return db

def test_schema_has_provenance_and_tables(monkeypatch):
    db = _fresh_db(monkeypatch)
    conn = db.get_db()
    cols = {c.name for c in conn["graph_nodes"].columns}
    assert "provenance" in cols
    assert "checks_ledger" in conn.table_names()
    assert "lineage" in conn.table_names()

def test_init_schema_idempotent(monkeypatch):
    db = _fresh_db(monkeypatch)
    db.init_schema(db.get_db()); db.init_schema(db.get_db())  # twice, no error
    assert "lineage" in db.get_db().table_names()
```
- [ ] **Step 2: Run → FAIL** (`assert "provenance" in cols`)
  `./.venv/bin/python -m pytest tests/test_provenance_schema.py -v`
- [ ] **Step 3: Implement** — in `init_schema`, (a) add `provenance` to the `graph_nodes` CREATE dict (`"provenance": str,`) AND to the `else:` lazy-migration block:
```python
        if "provenance" not in _cols:
            db.executescript("ALTER TABLE graph_nodes ADD COLUMN provenance TEXT DEFAULT ''")
```
(b) After the graph_edges block, add:
```python
    if "checks_ledger" not in db.table_names():
        db["checks_ledger"].create({
            "id": int, "topic": str, "run_id": str, "gate": str, "operation": str,
            "provider": str, "model": str, "invariant": str, "passed": int,
            "exit_code": int, "detail": str, "ts": str,
        }, pk="id")
        db["checks_ledger"].create_index(["topic"])
        db["checks_ledger"].create_index(["run_id"])
        db["checks_ledger"].create_index(["topic", "gate"])
    if "lineage" not in db.table_names():
        db["lineage"].create({
            "id": int, "topic": str, "artifact_id": str, "artifact_kind": str,
            "produced_by": str, "from_post_ids": str, "decision": str,
            "provider": str, "model": str, "ts": str,
        }, pk="id")
        db["lineage"].create_index(["artifact_id"])
        db["lineage"].create_index(["topic"])
        db["lineage"].create_index(["produced_by"])
```
- [ ] **Step 4: Run → PASS** (both tests)
- [ ] **Step 5: Commit**
```bash
git add src/openreply/core/db.py tests/test_provenance_schema.py
git commit -m "feat(db): provenance column + checks_ledger + lineage tables"
```

---

## Task 2: run_id contextvar (`core/runctx.py`)

**Files:**
- Create: `src/openreply/core/runctx.py`
- Test: `tests/test_runctx.py`

- [ ] **Step 1: Failing test**
```python
# tests/test_runctx.py
from openreply.core import runctx
def test_run_id_lifecycle():
    assert runctx.current_run_id() == ""
    rid = runctx.new_run_id()
    assert len(rid) >= 8
    runctx.set_run_id(rid)
    assert runctx.current_run_id() == rid
    runctx.set_run_id("")
    assert runctx.current_run_id() == ""
```
- [ ] **Step 2: Run → FAIL** (ModuleNotFoundError)
- [ ] **Step 3: Implement**
```python
# src/openreply/core/runctx.py
"""Per-pipeline-run id, grouping checks_ledger + lineage rows for one
collect/enrich/build invocation. Best-effort: unset → "" (rows still write)."""
from __future__ import annotations
import contextvars, uuid
_run_id: contextvars.ContextVar[str] = contextvars.ContextVar("openreply_run_id", default="")
def new_run_id() -> str:
    return uuid.uuid4().hex
def set_run_id(rid: str) -> None:
    _run_id.set(rid or "")
def current_run_id() -> str:
    try:
        return _run_id.get()
    except Exception:
        return ""
```
- [ ] **Step 4: Run → PASS**
- [ ] **Step 5: Commit**
```bash
git add src/openreply/core/runctx.py tests/test_runctx.py
git commit -m "feat(core): run_id contextvar for run-scoped provenance"
```

---

## Task 3: `record_check` + `record_lineage` helpers (non-fatal)

**Files:**
- Modify: `src/openreply/core/db.py` (after the fetch-audit helpers, ~1440)
- Test: `tests/test_ledger_lineage.py`

- [ ] **Step 1: Failing test**
```python
# tests/test_ledger_lineage.py
import tempfile, importlib
def _db(monkeypatch):
    monkeypatch.setenv("OPENREPLY_DATA_DIR", tempfile.mkdtemp())
    import openreply.core.db as db; importlib.reload(db); db.get_db()
    return db

def test_record_check_roundtrip(monkeypatch):
    db = _db(monkeypatch)
    rid = db.record_check(topic="t", gate="json_parse", operation="enrich",
                          passed=True, provider="ollama", model="x", detail="ok")
    assert rid and rid > 0
    rows = list(db.get_db().query("SELECT * FROM checks_ledger WHERE topic='t'"))
    assert rows[0]["gate"] == "json_parse" and rows[0]["passed"] == 1

def test_record_lineage_roundtrip(monkeypatch):
    db = _db(monkeypatch)
    rid = db.record_lineage(topic="t", artifact_id="n1", artifact_kind="painpoint",
                           produced_by="run123", from_post_ids=["p1","p2"], decision="d")
    assert rid and rid > 0
    rows = list(db.get_db().query("SELECT * FROM lineage WHERE artifact_id='n1'"))
    import json; assert json.loads(rows[0]["from_post_ids"]) == ["p1","p2"]

def test_record_check_never_raises_on_bad_db(monkeypatch):
    db = _db(monkeypatch)
    # monkeypatch get_db to throw — helper must swallow and return -1
    monkeypatch.setattr(db, "get_db", lambda: (_ for _ in ()).throw(RuntimeError("boom")))
    assert db.record_check(topic="t", gate="g", operation="o", passed=False) == -1
```
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement** — add to `core/db.py` (uses existing `_utc_now`, `get_db`, `_retry_on_locked`, `json`, `current_run_id`):
```python
from .runctx import current_run_id  # add near top imports

def record_check(*, topic: str, gate: str, operation: str, passed: bool,
                 run_id: str | None = None, provider: str = "", model: str = "",
                 invariant: str = "", exit_code: int = 0, detail: str = "") -> int:
    """Record one quality gate. Best-effort bookkeeping — returns row id or -1.
    NEVER raises (mirrors log_fetch_start)."""
    try:
        db = get_db()
        def _ins() -> int:
            return db["checks_ledger"].insert({
                "topic": topic, "run_id": run_id if run_id is not None else current_run_id(),
                "gate": gate, "operation": operation, "provider": provider, "model": model,
                "invariant": invariant, "passed": 1 if passed else 0, "exit_code": exit_code,
                "detail": (detail or "")[:2000], "ts": _utc_now(),
            }).last_pk
        return _retry_on_locked(_ins)
    except Exception:
        return -1

def record_lineage(*, topic: str, artifact_id: str, artifact_kind: str,
                   produced_by: str | None = None, from_post_ids: list[str] | None = None,
                   decision: str = "", provider: str = "", model: str = "") -> int:
    """Link an artifact to the sources/run that produced it. Best-effort, -1 on
    failure, never raises."""
    try:
        db = get_db()
        def _ins() -> int:
            return db["lineage"].insert({
                "topic": topic, "artifact_id": artifact_id, "artifact_kind": artifact_kind,
                "produced_by": produced_by if produced_by is not None else current_run_id(),
                "from_post_ids": json.dumps(from_post_ids or [], default=str),
                "decision": (decision or "")[:1000], "provider": provider, "model": model,
                "ts": _utc_now(),
            }).last_pk
        return _retry_on_locked(_ins)
    except Exception:
        return -1
```
(If `_utc_now` / `_retry_on_locked` names differ, grep `core/db.py` and match the real names.)
- [ ] **Step 4: Run → PASS**
- [ ] **Step 5: Commit**
```bash
git add src/openreply/core/db.py tests/test_ledger_lineage.py
git commit -m "feat(db): non-fatal record_check + record_lineage helpers"
```

---

## Task 4: Thread `provenance` through `_upsert_node`

**Files:**
- Modify: `src/openreply/graph/build.py` (`_upsert_node` at :76 — both batch tuple path and legacy per-row path, AND the batch-flush INSERT that maps `_BATCH.nodes` tuples → columns)
- Test: `tests/test_node_provenance.py`

- [ ] **Step 1: Failing test**
```python
# tests/test_node_provenance.py
import tempfile, importlib
def test_upsert_node_writes_provenance(monkeypatch):
    monkeypatch.setenv("OPENREPLY_DATA_DIR", tempfile.mkdtemp())
    import openreply.core.db as db; importlib.reload(db); db.get_db()
    import openreply.graph.build as b; importlib.reload(b)
    nid = b._upsert_node(db.get_db(), "topic", "painpoint", "k1", "label", provenance="llm")
    row = list(db.get_db().query("SELECT provenance FROM graph_nodes WHERE id=?", [nid]))
    assert row[0]["provenance"] == "llm"
```
- [ ] **Step 2: Run → FAIL** (`_upsert_node` has no `provenance` param / column not written)
- [ ] **Step 3: Implement** — add `provenance: str = ""` to `_upsert_node`'s signature. In the BATCH path append it to the tuple (make it the 7th element) AND update `_BATCH.nodes` flush INSERT (grep `INSERT INTO graph_nodes` or `.insert_all(` / `.upsert_all(` for `_BATCH.nodes` in `build.py`) to include the `provenance` column in the same position. In the LEGACY per-row path, add `"provenance": provenance` to the inserted/updated dict. On UPDATE, only overwrite provenance when the new value is non-empty (don't blank an existing tag): `provenance = excluded.provenance` guarded, or in Python: keep old if new is "". Keep arity consistent across CREATE (Task 1) / tuple / flush.
- [ ] **Step 4: Run → PASS**
- [ ] **Step 5: Commit**
```bash
git add src/openreply/graph/build.py tests/test_node_provenance.py
git commit -m "feat(graph): thread provenance through _upsert_node write path"
```

---

## Task 5: Tag `llm` / `llm_fallback` + emit lineage in `upsert_semantic`

**Files:**
- Modify: `src/openreply/graph/semantic.py` (`_upsert_semantic_body` — pass `provenance="llm"` to each `_upsert_node`; when the row carries a fallback marker from `build_fallback_chain`, pass `"llm_fallback"`; after writing a node, call `record_lineage` with the finding's evidence post ids)
- Test: `tests/test_semantic_provenance.py`

- [ ] **Step 1: Failing test**
```python
# tests/test_semantic_provenance.py
import tempfile, importlib
def test_semantic_tags_llm_and_lineage(monkeypatch):
    monkeypatch.setenv("OPENREPLY_DATA_DIR", tempfile.mkdtemp())
    import openreply.core.db as db; importlib.reload(db); db.get_db()
    import openreply.graph.semantic as s; importlib.reload(s)
    s.upsert_semantic("t", painpoints=[{"label":"slow sync","evidence_post_ids":["p1"]}])
    nodes = list(db.get_db().query("SELECT provenance FROM graph_nodes WHERE kind='painpoint'"))
    assert nodes and nodes[0]["provenance"] in ("llm","llm_fallback")
    lin = list(db.get_db().query("SELECT * FROM lineage WHERE artifact_kind='painpoint'"))
    assert lin  # a lineage row was emitted
```
(Adjust the painpoint dict keys to match the real schema the function expects — grep `_upsert_semantic_body` for how it reads label/evidence.)
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement** — in `_upsert_semantic_body`, for each finding category, pass `provenance="llm"` to `_upsert_node` (or `"llm_fallback"` if the finding dict has a fallback flag set by `build_fallback_chain`). Immediately after the node is upserted, call:
```python
from ..core.db import record_lineage
record_lineage(topic=topic, artifact_id=node_id, artifact_kind=kind,
               from_post_ids=list(finding.get("evidence_post_ids") or []),
               decision="llm_extraction")
```
Wrap in try/except (best-effort).
- [ ] **Step 4: Run → PASS**
- [ ] **Step 5: Commit**
```bash
git add src/openreply/graph/semantic.py tests/test_semantic_provenance.py
git commit -m "feat(graph): tag llm/llm_fallback provenance + emit lineage in upsert_semantic"
```

---

## Task 6: Tag `structural` in build.py + record build invariant checks

**Files:**
- Modify: `src/openreply/graph/build.py` (structural node-creation callers — the build_structural path that creates `source`/`document`/`element`/co-occurrence nodes — pass `provenance="structural"`; at the end of a build, `record_check(gate="build_complete", operation="graph_build", passed=True, detail=f"{n} nodes")`)
- Test: `tests/test_build_provenance.py`

- [ ] **Step 1: Failing test**
```python
# tests/test_build_provenance.py
import inspect, openreply.graph.build as b
def test_structural_callers_pass_provenance():
    src = inspect.getsource(b)
    # every _upsert_node call in the structural builder should set provenance=
    assert 'provenance="structural"' in src or "provenance='structural'" in src
```
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement** — pass `provenance="structural"` on the `_upsert_node` calls inside the structural build function(s). Add one `record_check(topic=topic, gate="build_complete", operation="graph_build", passed=True, detail=...)` at the end of `build_structural` (best-effort).
- [ ] **Step 4: Run → PASS**
- [ ] **Step 5: Commit**
```bash
git add src/openreply/graph/build.py tests/test_build_provenance.py
git commit -m "feat(graph): structural provenance tag + build_complete check"
```

---

## Task 7: Record checks at enrich LLM/parse gates + set run_id

**Files:**
- Modify: `src/openreply/research/enrich_worker.py` (set a run_id at the top of an enrich invocation; `record_check` at: json-parse of LLM output (pass/fail + detail), and per-extractor LLM call with provider/model)
- Test: `tests/test_enrich_checks.py`

- [ ] **Step 1: Failing test** — assert that after an enrich run over a stub corpus, `checks_ledger` has ≥1 row with `gate='json_parse'` or `gate='llm_call'`. (Use the existing enrich test fixtures/mocks; if enrich needs an LLM, mock the provider to return a fixed JSON so the parse-gate fires. Grep `tests/test_enrich_worker.py` for the existing mock pattern and reuse it.)
```python
# tests/test_enrich_checks.py  (skeleton — fill mocks from tests/test_enrich_worker.py)
def test_enrich_records_checks(monkeypatch, tmp_path):
    # arrange: OPENREPLY_DATA_DIR=tmp, seed a couple posts, mock LLM → valid JSON
    # act: run the enrich entrypoint for the topic
    # assert: rows in checks_ledger with gate in {'json_parse','llm_call'}
    ...
```
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement** — at the start of the enrich entrypoint: `from ..core.runctx import new_run_id, set_run_id; set_run_id(new_run_id())`. Around the LLM call: `record_check(topic=topic, gate="llm_call", operation="enrich", passed=ok, provider=prov, model=mdl, detail=...)`. Around JSON parse: `record_check(topic=topic, gate="json_parse", operation="enrich", passed=parsed_ok, detail=err_or_ok)`. All best-effort.
- [ ] **Step 4: Run → PASS**
- [ ] **Step 5: Commit**
```bash
git add src/openreply/research/enrich_worker.py tests/test_enrich_checks.py
git commit -m "feat(enrich): record json_parse + llm_call checks with run_id"
```

---

## Task 8: MCP tools `openreply_checks_list` + `openreply_lineage_get`

**Files:**
- Modify: `src/openreply/mcp/server.py` (add two thin read tools that query the tables via the existing DB query helper)
- Test: `tests/test_mcp_provenance_tools.py`

- [ ] **Step 1: Failing test**
```python
# tests/test_mcp_provenance_tools.py
import tempfile, importlib
def test_checks_and_lineage_tools(monkeypatch):
    monkeypatch.setenv("OPENREPLY_DATA_DIR", tempfile.mkdtemp())
    import openreply.core.db as db; importlib.reload(db); db.get_db()
    db.record_check(topic="t", gate="g", operation="o", passed=True)
    db.record_lineage(topic="t", artifact_id="a1", artifact_kind="painpoint", from_post_ids=["p1"])
    import openreply.mcp.server as m; importlib.reload(m)
    checks = m.openreply_checks_list(topic="t")    # call the underlying fn
    lin = m.openreply_lineage_get(artifact_id="a1")
    assert any(r["gate"]=="g" for r in checks)
    assert any(r["artifact_id"]=="a1" for r in lin)
```
(Match the real registration pattern in `mcp/server.py` — these tools may be registered via a decorator; expose plain callables the test can import, mirroring existing tools like `openreply_query_db`.)
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement** — add two tools mirroring an existing read tool: `openreply_checks_list(topic, limit=200)` → `SELECT * FROM checks_ledger WHERE topic=:topic ORDER BY id DESC LIMIT :limit`; `openreply_lineage_get(artifact_id)` → `SELECT * FROM lineage WHERE artifact_id=:artifact_id`. Use the same parameterized-query path the other tools use.
- [ ] **Step 4: Run → PASS**
- [ ] **Step 5: Commit**
```bash
git add src/openreply/mcp/server.py tests/test_mcp_provenance_tools.py
git commit -m "feat(mcp): openreply_checks_list + openreply_lineage_get read tools"
```

---

## Task 9: Frontend — provenance badge + "Provenance & Audit" panel (vanilla JS)

**Files:**
- Modify: `app-tauri/src/screens/insights.js` (render a small provenance badge on each finding card from the node's `provenance` field)
- Create: `app-tauri/src/screens/provenance.js` (a read-only panel: recent checks + lineage for the current topic, via `api.runQuery`)
- Modify: `app-tauri/src/main.js` (register a `#/provenance` route) + sidebar entry
- Test: manual (vanilla JS, no unit harness for screens) + `node --check` on both files

- [ ] **Step 1: Badge** — in the insights finding-card template, if the row has `provenance`, render `<span class="prov-badge prov-${provenance}">${provenance}</span>` (style: `llm`=neutral, `llm_fallback`=amber, `structural`=blue, `template`=grey). The insights query must `SELECT ... provenance` — add the column to the existing node query.
- [ ] **Step 2: Panel** — `provenance.js` exports `renderProvenance(root, topic)` that runs two `api.runQuery` reads (checks_ledger + lineage for the topic) and renders two tables (use `.table-wrap` for overflow). Pure read; cache via `screenCache` keyed `provenance.${topic}`.
- [ ] **Step 3: Route** — add `#/provenance` to the router map in `main.js` and a sidebar link (under the topic/insights area). Follow an existing screen's registration exactly.
- [ ] **Step 4: Verify** — `node --check app-tauri/src/screens/provenance.js` (exit 0); run the dev app, open a topic with findings → badges show on cards, the Provenance panel lists checks + lineage.
- [ ] **Step 5: Commit**
```bash
git add app-tauri/src/screens/insights.js app-tauri/src/screens/provenance.js app-tauri/src/main.js
git commit -m "feat(ui): provenance badges + read-only Provenance & Audit panel"
```

---

## Task 10: Changelog + graph sync

**Files:**
- Create: `changelogs/2026-06-13_06_provenance-auditability-foundation.md`

- [ ] **Step 1: Write changelog** (summary, the 2 tables + 1 column, the helpers, the run_id contextvar, the MCP tools, the UI panel; list files created/modified).
- [ ] **Step 2: Full new-suite run** — `./.venv/bin/python -m pytest tests/test_provenance_schema.py tests/test_runctx.py tests/test_ledger_lineage.py tests/test_node_provenance.py tests/test_semantic_provenance.py tests/test_build_provenance.py tests/test_enrich_checks.py tests/test_mcp_provenance_tools.py -v` → all pass.
- [ ] **Step 3: Sync graphs** — `codegraph sync && graphify update .` (local).
- [ ] **Step 4: Commit**
```bash
git add changelogs/2026-06-13_06_provenance-auditability-foundation.md
git commit -m "docs(changelog): 1A provenance & auditability foundation"
```

---

## Self-review
- Spec coverage: provenance column ✓(T1,4,5,6) · checks_ledger ✓(T1,3,7) · lineage ✓(T1,3,5) · run_id ✓(T2,7) · MCP ✓(T8) · UI ✓(T9) · non-fatal ✓(T3) · idempotent migration ✓(T1).
- No placeholders except where the implementer must match a real signature (flagged with "grep …"): the batch-flush INSERT (T4), the finding-dict keys (T5), the enrich mock (T7), the MCP registration pattern (T8) — each cites exactly what to grep.
- Type consistency: `record_check`/`record_lineage` signatures used identically in T3/T7/T8; `provenance` values (`llm`/`llm_fallback`/`structural`/`template`) consistent T4-T6,T9.
