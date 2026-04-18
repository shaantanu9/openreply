"""Graph storage — two tables live alongside our existing Reddit schema.

Design: keep it in the same SQLite so graph queries join cleanly against
`posts` / `comments` / `topic_posts`. Nodes are scoped to a `topic` so one
DB can hold multiple research projects without cross-contamination.

Node IDs are human-readable and collision-free: `<topic>::<kind>::<key>`.
Example: `habit tracker apps::post::1rggteq` or `meditation apps::sub::meditation`.
"""
from __future__ import annotations

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


def make_node_id(topic: str, kind: str, key: str) -> str:
    return f"{topic}::{kind}::{key}"
