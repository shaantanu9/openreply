# Sub-project 1A — Provenance & Auditability Foundation

**Date:** 2026-06-13
**Status:** Design approved → spec
**Part of:** WhyBuddy port roadmap, Wave 1 (keystone). Roadmap: `docs/whybuddy-learnings/WHYBUDDY_LEARNINGS.md`.

## Goal

Make every generated OpenReply artifact (graph nodes / gaps / personas) auditable:
1. **Provenance** — tagged with *how* it was produced (`llm` / `llm_fallback` / `template` / `structural`).
2. **Checks ledger** — a record of the quality gates that ran (op + outcome + detail).
3. **Lineage** — each artifact linked to the source posts + run that produced it.

All additive and **non-fatal** — never blocks enrich/build. Backward-compatible (additive columns/tables; pre-existing rows tolerated with empty provenance).

## Why SQLite, not JSONL (adaptation from WhyBuddy)

WhyBuddy used JSONL for lineage because it had no SQL store for it. OpenReply is
SQLite-first with a native rusqlite read path (Phase 17) and an MCP
`openreply_query_db` path. SQLite tables ride that existing infra (native reads,
MCP queries, screen cache); JSONL would be a second, unqueryable store. So we
implement the *pattern* (provenance + ledger + lineage DAG) on SQLite.

## Components

### 1. Provenance labels
- Add column `provenance TEXT DEFAULT ''` to `graph_nodes` (idempotent migration in `init_schema`, mirroring the existing `ts` ADD COLUMN pattern at `core/db.py:455`).
- Tag at the single LLM write path (`graph/semantic.py::_upsert_node` / `upsert_semantic`):
  - normal LLM extraction → `llm`
  - produced via the existing `build_fallback_chain` → `llm_fallback`
  - structural build path (`graph/build.py`) → `structural`
  - seeded/templated nodes → `template`
- Values are a small enum; default `''` = "unknown (pre-provenance)".
- Surface: provenance badge on nodes in the insights/graph UI; filterable.

### 2. Checks ledger
- New table `checks_ledger`:
  `id INTEGER PK, topic TEXT, run_id TEXT, gate TEXT, operation TEXT, provider TEXT, model TEXT, invariant TEXT, passed INTEGER, exit_code INTEGER, detail TEXT, ts TEXT`.
  Indices: `(topic)`, `(run_id)`, `(topic, gate)`.
- Helper `record_check(*, topic, run_id, gate, operation, passed, provider='', model='', invariant='', exit_code=0, detail='')` in `core/db.py`. Best-effort: returns row id or `-1` on failure (mirrors `log_fetch_start`). NEVER raises.
- Call sites (gates): json-parse of LLM output, schema validation, each LLM call (provider/model), graph-build invariants. Start with the highest-signal gates in `research/enrich_worker.py` + `graph/semantic.py` + `graph/build.py`.

### 3. Lineage
- New table `lineage`:
  `id INTEGER PK, topic TEXT, artifact_id TEXT, artifact_kind TEXT, produced_by TEXT, from_post_ids TEXT(json array), decision TEXT, provider TEXT, model TEXT, ts TEXT`.
  Indices: `(artifact_id)`, `(topic)`, `(produced_by)` — mirrors WhyBuddy byId/bySession/byAgent.
- Helper `record_lineage(*, topic, artifact_id, artifact_kind, produced_by, from_post_ids=[], decision='', provider='', model='')` in `core/db.py`. Best-effort, never raises.
- Populated in `upsert_semantic` when a node is written: extends the existing single `evidence_post_id` into the full `from_post_ids` list + the run that produced it.

### run_id plumbing
- A `runctx` contextvar helper (new tiny module `core/runctx.py` or in `core/db.py`): `new_run_id() -> str` (uuid4 hex), `current_run_id() -> str` (contextvar, `''` if unset), `set_run_id(rid)`.
- Set at the top of a collect/enrich/build invocation; `record_check`/`record_lineage` default `run_id` to `current_run_id()`.

## Architecture / units
- `core/db.py` — schema (2 tables + 1 column) + `record_check` + `record_lineage` (focused helpers near the existing fetch-audit helpers).
- `core/runctx.py` — run_id contextvar (small, single purpose).
- `graph/semantic.py` — tag provenance + emit lineage at node write.
- `graph/build.py` — tag structural provenance + record build invariant checks.
- `research/enrich_worker.py` (+ gap steps) — call `record_check` at each LLM/parse gate; set run_id.
- `app-tauri/src/screens/` — a read-only "Provenance & Audit" panel (vanilla JS) reading the two tables via `api.runQuery`; provenance badge on insight cards.
- MCP (optional, thin): `openreply_checks_list(topic)` + `openreply_lineage_get(artifact_id)` querying the tables.

## Error handling
- All ledger/lineage/provenance writes best-effort: catch + return sentinel, never raise, never block the pipeline (mirror `core/db.py:1405` fetch-audit `-1`).
- Migration idempotent: guard every ADD COLUMN / CREATE with existence checks.

## Testing
- Migration idempotent (run `init_schema` twice → no error, column/tables present).
- `record_check` / `record_lineage` round-trip (write → query back).
- `upsert_semantic` tags `provenance='llm'` + writes a lineage row with the evidence post ids.
- Fallback path tags `provenance='llm_fallback'`.
- DB-error path: helper returns `-1`/no-op, caller proceeds (non-fatal).

## Out of scope (separate later specs that CONSUME this)
- Traceability-matrix UI (2C), session replay (2G), knowledge-graph invariant guard (2B).
