# Sub-project 2C — Traceability Matrix (gap → its sources)

**Date:** 2026-06-13 · **Roadmap:** WhyBuddy port, Wave 2. Builds directly on 1A's `lineage` table.

## Goal
Click a finding (painpoint / feature_wish / workaround / product) → see every source post (Reddit/HN/paper/etc.) that produced it. Pure read over the `lineage` + `posts` tables that 1A already populates. Non-fatal, additive.

## Data path (already exists from 1A)
`lineage(artifact_id, from_post_ids[json], decision, ...)` — `upsert_semantic` writes a row per node with the finding's `example_post_ids`. Join to `posts` via SQLite `json_each`:
```sql
SELECT p.id, p.title, p.url, p.permalink, p.source_type, p.author, p.score
FROM lineage l, json_each(l.from_post_ids) je
JOIN posts p ON p.id = je.value
WHERE l.artifact_id = :aid
```

## Components
1. **Backend helper** `traceability_for_artifact(artifact_id) -> list[dict]` in a new `src/openreply/research/traceability.py` — runs the join above via `get_db().query`, returns source rows (id/title/url/permalink/source_type/author/score). Best-effort: `[]` on error, never raises.
2. **MCP tool** `openreply_traceability(artifact_id)` in `mcp/server.py` (now clean) — thin wrapper over the helper, mirroring `openreply_checks_list`/`openreply_query_db`.
3. **UI expander** in `app-tauri/src/screens/insights.js::renderFindingCard` — a "🔗 N sources" toggle in `.insight-meta` (data-trace-id=`f.id`). On click, `api.runQuery` the join (param `:aid`) and render a compact list of source rows, each linked via `postLink(row)` (import from `lib/postLink.js`, source-aware). Read-only; lazy (only queries on expand).

## Testing
- `traceability_for_artifact`: seed a lineage row + matching posts → returns those posts; unknown id → `[]`; bad DB → `[]` (no raise).
- MCP tool returns seeded rows.
- `node --check insights.js`.

## Out of scope
Editing the lineage emission (done in 1A); the checks panel (1A). This is read-only surfacing.
