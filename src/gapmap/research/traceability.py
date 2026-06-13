"""Traceability: an artifact (graph node) → the source posts that produced it,
via the lineage table (1A). Read-only, best-effort."""
from __future__ import annotations

from typing import Any

from ..core.db import get_db

# SQLite supports json_each() on the JSON-encoded from_post_ids column.
# The comma between `lineage l` and `json_each(...)` is an implicit
# cross-join (ANSI SQL-compatible in SQLite ≥ 3.38).
_SQL = (
    "SELECT p.id, p.title, p.url, p.permalink, p.source_type, p.author, p.score "
    "FROM lineage l, json_each(l.from_post_ids) je "
    "JOIN posts p ON p.id = je.value "
    "WHERE l.artifact_id = :aid"
)


def traceability_for_artifact(artifact_id: str) -> list[dict[str, Any]]:
    """Return source posts behind one artifact.

    Joins ``lineage.from_post_ids`` (stored as a JSON array) with the
    ``posts`` table to surface the human-readable posts that fed the
    given graph node or derived artifact.

    Args:
        artifact_id: the ``graph_nodes.id`` (or other artifact key) to trace.

    Returns:
        List of post dicts (id, title, url, permalink, source_type, author,
        score). Returns ``[]`` on any error — never raises.
    """
    try:
        return list(get_db().query(_SQL, {"aid": artifact_id}))
    except Exception:
        return []
