# Sub-project 2B — Knowledge-graph Invariant Guard

**Date:** 2026-06-14 · **Roadmap:** WhyBuddy port, Wave 2. Consumes 1A's `checks_ledger`.

## Goal
After a graph build, validate the SQLite knowledge graph's structural invariants and **record each result to `checks_ledger`** (1A). Net-new: `analyze.py` computes `is_dag` as a metric, but nothing validates + logs invariants as a guard. Best-effort, never raises, never blocks the build.

## Invariants (per topic)
- **required_fields**: every `graph_nodes` row has non-empty `id`, `topic`, `kind`, `label`.
- **acyclic**: the `graph_edges` directed graph for the topic has no cycles (reuse `networkx` as `graph/analyze.py:197` does).
- **no_orphans**: every node (except the topic root) participates in ≥1 edge.
- **root_present**: exactly one `kind='topic'` node for the topic.
- (max_depth: skip for v1 — the graph isn't strictly a tree.)

## Components
1. `src/openreply/graph/invariants.py` — `check_graph_invariants(topic) -> dict`:
   loads nodes+edges for the topic, runs the checks, calls
   `record_check(topic=topic, gate="invariant_<name>", operation="graph_build", passed=<bool>, invariant="<name>", detail="<summary>")` for each, returns
   `{"ok": all_passed, "checks": [{"invariant","passed","detail"}, ...]}`.
   Best-effort: any error → `{"ok": True, "skipped": True, "error": ...}` (never raises, never fails a build).
2. **Wire into build**: in `graph/build.py::_build_structural_body`, right after the 1A `build_complete` `record_check`, call `check_graph_invariants(topic)` (best-effort, wrapped). So every build validates + logs.
3. **CLI**: `research graph-invariants --topic` (prints JSON).
4. **MCP**: `openreply_graph_invariants(topic)` (thin wrapper).
5. **UI**: NONE needed — invariant results are `checks_ledger` rows, already rendered by 1A's Provenance & Audit panel (and visible via `openreply_checks_list`). Synergy.

## Testing
- `check_graph_invariants`: seed a clean small graph → all pass + ledger rows written. Seed a cycle (a→b→a) → `acyclic` fails. Seed a node missing `label` → `required_fields` fails. Missing/empty graph → `skipped`/ok, no raise.
- CLI prints JSON; MCP roundtrip.

## Non-fatal / compat
Pure read + ledger writes; never mutates the graph; never raises; build proceeds regardless.
