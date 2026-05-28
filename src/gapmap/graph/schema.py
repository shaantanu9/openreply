"""Graph storage — two tables live alongside our existing Reddit schema.

Design: keep it in the same SQLite so graph queries join cleanly against
`posts` / `comments` / `topic_posts`. Nodes are scoped to a `topic` so one
DB can hold multiple research projects without cross-contamination.

Node IDs are human-readable and collision-free: `<topic>::<kind>::<key>`.
Example: `habit tracker apps::post::1rggteq` or `meditation apps::sub::meditation`.

The `key` component is NFKC-normalized so combining-form vs precomposed
unicode (e.g. "Café" written two different ways) hashes to the same node —
graphify uses the same trick (extract.py:_make_id). For ASCII keys this
is a literal no-op so it doesn't affect existing IDs.
"""
from __future__ import annotations

import unicodedata

from ..core.db import get_db


def ensure_graph_schema() -> None:
    db = get_db()
    if "graph_nodes" not in db.table_names():
        db["graph_nodes"].create(
            {
                "id": str,
                "topic": str,
                "kind": str,
                "label": str,
                "metadata_json": str,
            },
            pk="id",
        )
        db["graph_nodes"].create_index(["topic"])
        db["graph_nodes"].create_index(["kind"])
        db["graph_nodes"].create_index(["topic", "kind"])

    if "graph_edges" not in db.table_names():
        db["graph_edges"].create(
            {
                "src": str,
                "dst": str,
                "kind": str,
                "topic": str,
                "weight": float,
                "metadata_json": str,
            },
            pk=("src", "dst", "kind"),
        )
        db["graph_edges"].create_index(["topic"])
        db["graph_edges"].create_index(["src"])
        db["graph_edges"].create_index(["dst"])
        db["graph_edges"].create_index(["kind"])

    # ── JSON-expression indexes on metadata hot paths (SQLite ≥3.9) ─────
    # The insights queries filter by `community_id`, `confidence`, and
    # `source_diversity`, all of which live INSIDE metadata_json. Without
    # these indexes every such filter is a full-table scan + JSON parse
    # per row — fine at 5K rows, painful at 50K+. The indexes turn those
    # queries into pure btree lookups.
    #
    # IF NOT EXISTS so this is safe on every startup. No schema change
    # needed; SQLite materializes the expression result transparently.
    # We swallow errors so older SQLite builds (or non-SQLite backends if
    # someone swaps the storage layer) silently degrade rather than break.
    _idx_stmts = [
        "CREATE INDEX IF NOT EXISTS idx_nodes_meta_community "
        "ON graph_nodes(topic, json_extract(metadata_json, '$.community_id'))",
        "CREATE INDEX IF NOT EXISTS idx_nodes_meta_source_diversity "
        "ON graph_nodes(topic, json_extract(metadata_json, '$.source_diversity'))",
        "CREATE INDEX IF NOT EXISTS idx_nodes_meta_evidence_count "
        "ON graph_nodes(topic, json_extract(metadata_json, '$.evidence_count'))",
        "CREATE INDEX IF NOT EXISTS idx_edges_meta_confidence "
        "ON graph_edges(topic, json_extract(metadata_json, '$.confidence'))",
    ]
    for stmt in _idx_stmts:
        try:
            db.conn.execute(stmt)
        except Exception:
            pass  # older SQLite / non-JSON1 build — fall back to scans.


def make_node_id(topic: str, kind: str, key: str) -> str:
    # NFKC fold collapses unicode equivalents (e.g. "Café" ↔ "Café") so
    # the same human-readable label can't end up as two distinct nodes.
    # Topic + kind are left literal because they're typically code-internal
    # constants where case sensitivity matters.
    if key:
        try:
            key = unicodedata.normalize("NFKC", key)
        except (TypeError, ValueError):
            pass  # malformed input — fall through with original string
    return f"{topic}::{kind}::{key}"
