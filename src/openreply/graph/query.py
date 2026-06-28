"""Graph read helpers — neighbors, kind filters, degree ranking."""
from __future__ import annotations

import json
from typing import Any

from ..core.db import get_db


def _parse_metadata(row: dict[str, Any]) -> dict[str, Any]:
    out = {k: v for k, v in row.items() if k != "metadata_json"}
    try:
        out["metadata"] = json.loads(row.get("metadata_json") or "{}")
    except json.JSONDecodeError:
        out["metadata"] = {}
    return out


def neighbors(
    topic: str,
    node_id: str,
    edge_kinds: list[str] | None = None,
    direction: str = "both",  # 'out' | 'in' | 'both'
    limit: int = 50,
) -> list[dict]:
    """Return neighboring nodes with the connecting edge info."""
    db = get_db()
    kind_filter = ""
    params: list[Any] = [topic, node_id]
    if edge_kinds:
        placeholders = ",".join("?" for _ in edge_kinds)
        kind_filter = f" AND e.kind IN ({placeholders})"
        params.extend(edge_kinds)

    parts = []
    if direction in ("out", "both"):
        parts.append(
            f"""
            SELECT n.*, e.kind AS edge_kind, 'out' AS direction
            FROM graph_edges e JOIN graph_nodes n ON n.id = e.dst
            WHERE e.topic = ? AND e.src = ? {kind_filter}
            """
        )
    if direction in ("in", "both"):
        parts.append(
            f"""
            SELECT n.*, e.kind AS edge_kind, 'in' AS direction
            FROM graph_edges e JOIN graph_nodes n ON n.id = e.src
            WHERE e.topic = ? AND e.dst = ? {kind_filter}
            """
        )
    if not parts:
        return []

    # If both directions, duplicate params
    full_params = params.copy()
    if direction == "both":
        full_params = params + params
    sql = " UNION ALL ".join(parts) + f" LIMIT {int(limit)}"
    rows = list(db.query(sql, full_params))
    return [_parse_metadata(r) for r in rows]


def nodes_of_kind(topic: str, kind: str, limit: int = 100) -> list[dict]:
    db = get_db()
    rows = list(
        db.query(
            "SELECT * FROM graph_nodes WHERE topic=? AND kind=? LIMIT ?",
            [topic, kind, limit],
        )
    )
    return [_parse_metadata(r) for r in rows]


def top_nodes_by_degree(
    topic: str,
    kind: str | None = None,
    limit: int = 20,
) -> list[dict]:
    """Rank nodes by total degree (in + out edges) — surfaces hubs."""
    db = get_db()
    kind_filter = " AND n.kind = ?" if kind else ""
    params: list[Any] = [topic, topic, topic]
    if kind:
        params.append(kind)
    sql = f"""
        SELECT n.*,
               (SELECT count(*) FROM graph_edges e
                WHERE e.topic=? AND (e.src = n.id OR e.dst = n.id)) AS degree
        FROM graph_nodes n
        WHERE n.topic = ? {kind_filter.replace('?', '')}
        AND n.topic = ? {kind_filter}
        ORDER BY degree DESC LIMIT {limit}
    """
    # Simpler rewrite — the above got tangled
    params = [topic]
    kind_sql = ""
    if kind:
        kind_sql = " AND n.kind = ?"
        params.append(kind)
    sql = f"""
        SELECT n.id, n.kind, n.label, n.metadata_json,
               (SELECT count(*) FROM graph_edges e
                WHERE e.topic = n.topic AND (e.src = n.id OR e.dst = n.id)) AS degree
        FROM graph_nodes n
        WHERE n.topic = ? {kind_sql}
        ORDER BY degree DESC LIMIT {limit}
    """
    rows = list(db.query(sql, params))
    return [_parse_metadata(r) for r in rows]
