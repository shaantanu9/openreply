"""Dual-Mode Pivot — Product entity CRUD.

A Product is a first-class monitored object (the user's own app or site)
that owns a set of competitors and a stream of signals. Each product is
linked to a shared Topic (which backs the collection + synthesis) so the
Phase 1+2 engine works unchanged — Product Mode is a new surface on top
of the same research primitives.

See docs/DUAL_MODE_PIVOT.md §7 for entity design.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any, Optional

from ..core.db import get_db, init_schema


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _slugify(name: str) -> str:
    s = (name or "").strip().lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s or "product"


def _unique_id(base: str) -> str:
    """Slug + suffix if taken."""
    db = get_db()
    slug = _slugify(base)
    if "products" not in db.table_names():
        return slug
    existing = {r["id"] for r in db.query("SELECT id FROM products")}
    if slug not in existing:
        return slug
    for i in range(2, 99):
        cand = f"{slug}-{i}"
        if cand not in existing:
            return cand
    return f"{slug}-{int(datetime.now().timestamp())}"


# ── Create ──────────────────────────────────────────────────────────────
def create_product(
    name: str,
    one_liner: str = "",
    category: str = "",
    topic: str = "",
    competitors: Optional[list[dict]] = None,
    monitoring_cadence: str = "daily",
    metadata: Optional[dict] = None,
) -> dict[str, Any]:
    """Create a new Product row (+ linked competitor rows).

    Args:
        name: User-facing product name (e.g. "MindWave Pro").
        one_liner: One-sentence description.
        category: Free-form category tag ("meditation apps").
        topic: Linked topic slug — if absent, we use slugified name.
                Shares corpus + synthesis with this topic.
        competitors: [{name, urls: {website,appstore,subreddit,...}, category}]
        monitoring_cadence: 'daily' | 'weekly'
        metadata: arbitrary dict persisted as metadata_json.
    """
    db = get_db()
    init_schema(db)
    pid = _unique_id(name)
    now = _utc_now()
    topic_slug = (topic or pid).strip()

    db["products"].insert(
        {
            "id": pid,
            "name": name,
            "one_liner": one_liner or "",
            "category": category or "",
            "topic": topic_slug,
            "created_at": now,
            "last_swept_at": "",
            "monitoring_cadence": monitoring_cadence or "daily",
            "is_active": 1,
            "metadata_json": json.dumps(metadata or {}),
        }
    )

    added_competitors = []
    for c in competitors or []:
        cname = (c.get("name") or "").strip()
        if not cname:
            continue
        urls = c.get("urls") or {}
        db["product_competitors"].upsert(
            {
                "product_id": pid,
                "competitor_name": cname,
                "urls_json": json.dumps(urls),
                "category": c.get("category") or category,
                "tracked_since": now,
                "is_active": 1,
            },
            pk=("product_id", "competitor_name"),
        )
        added_competitors.append(cname)

    return get_product(pid)


# ── Read ────────────────────────────────────────────────────────────────
def list_products(active_only: bool = True) -> list[dict]:
    db = get_db()
    if "products" not in db.table_names():
        return []
    sql = "SELECT * FROM products"
    if active_only:
        sql += " WHERE is_active = 1"
    sql += " ORDER BY created_at DESC"
    rows = list(db.query(sql))
    # Enrich with competitor count + recent signal count (cheap)
    for r in rows:
        try:
            r["competitor_count"] = next(db.query(
                "SELECT count(*) AS n FROM product_competitors "
                "WHERE product_id = ? AND is_active = 1", [r["id"]]
            ))["n"]
        except Exception:
            r["competitor_count"] = 0
        try:
            r["open_signal_count"] = next(db.query(
                "SELECT count(*) AS n FROM product_signals "
                "WHERE product_id = ? AND (user_action IS NULL OR user_action = '')",
                [r["id"]]
            ))["n"]
        except Exception:
            r["open_signal_count"] = 0
    return rows


def get_product(product_id: str) -> dict[str, Any]:
    db = get_db()
    if "products" not in db.table_names():
        return {"ok": False, "error": "products table not initialized"}
    rows = list(db.query("SELECT * FROM products WHERE id = ?", [product_id]))
    if not rows:
        return {"ok": False, "error": f"product '{product_id}' not found"}
    p = rows[0]
    try:
        p["metadata"] = json.loads(p.get("metadata_json") or "{}")
    except Exception:
        p["metadata"] = {}
    # Competitors
    competitors = list(db.query(
        "SELECT * FROM product_competitors WHERE product_id = ? AND is_active = 1 "
        "ORDER BY tracked_since",
        [product_id],
    ))
    for c in competitors:
        try:
            c["urls"] = json.loads(c.get("urls_json") or "{}")
        except Exception:
            c["urls"] = {}
    # Sweeps
    recent_sweeps = list(db.query(
        "SELECT * FROM product_sweeps WHERE product_id = ? "
        "ORDER BY run_at DESC LIMIT 10",
        [product_id],
    ))
    # Signal counts
    signals_by_action = {}
    for r in db.query(
        "SELECT coalesce(user_action,'open') AS bucket, count(*) AS n "
        "FROM product_signals WHERE product_id = ? GROUP BY bucket",
        [product_id],
    ):
        signals_by_action[r["bucket"]] = r["n"]

    return {
        "ok": True,
        "product": p,
        "competitors": competitors,
        "recent_sweeps": recent_sweeps,
        "signal_counts": signals_by_action,
    }


# ── Update ──────────────────────────────────────────────────────────────
def update_product(
    product_id: str,
    fields: dict[str, Any],
) -> dict[str, Any]:
    db = get_db()
    if "products" not in db.table_names():
        return {"ok": False, "error": "products table not initialized"}
    allowed = {
        "name", "one_liner", "category", "topic",
        "monitoring_cadence", "is_active", "metadata_json",
        "last_swept_at",
    }
    patch = {k: v for k, v in fields.items() if k in allowed}
    if not patch:
        return {"ok": False, "error": "no valid fields to update"}
    patch["id"] = product_id
    db["products"].upsert(patch, pk="id")
    return get_product(product_id)


def add_competitor(
    product_id: str,
    name: str,
    urls: Optional[dict] = None,
    category: str = "",
) -> dict[str, Any]:
    db = get_db()
    init_schema(db)
    now = _utc_now()
    db["product_competitors"].upsert(
        {
            "product_id": product_id,
            "competitor_name": name,
            "urls_json": json.dumps(urls or {}),
            "category": category,
            "tracked_since": now,
            "is_active": 1,
        },
        pk=("product_id", "competitor_name"),
    )
    return {"ok": True, "product_id": product_id, "competitor": name}


def remove_competitor(product_id: str, name: str) -> dict[str, Any]:
    db = get_db()
    if "product_competitors" not in db.table_names():
        return {"ok": False, "error": "product_competitors table not initialized"}
    db.execute(
        "UPDATE product_competitors SET is_active = 0 "
        "WHERE product_id = ? AND competitor_name = ?",
        [product_id, name],
    )
    try:
        db.conn.commit()
    except Exception:
        pass
    return {"ok": True, "product_id": product_id, "competitor": name, "removed": True}


# ── Delete (soft) ───────────────────────────────────────────────────────
def delete_product(product_id: str) -> dict[str, Any]:
    db = get_db()
    if "products" not in db.table_names():
        return {"ok": False, "error": "products table not initialized"}
    db.execute("UPDATE products SET is_active = 0 WHERE id = ?", [product_id])
    try:
        db.conn.commit()
    except Exception:
        pass
    return {"ok": True, "product_id": product_id, "deactivated": True}


# ── Topic → Product conversion ──────────────────────────────────────────
def convert_topic_to_product(
    topic: str,
    name: Optional[str] = None,
    one_liner: str = "",
) -> dict[str, Any]:
    """Phase F — seed a Product from an existing Topic's graph.

    Competitors are auto-suggested from graph_nodes where kind='product' or
    'company' in the topic's subgraph. Evidence carries over because the new
    Product shares the topic slug.
    """
    db = get_db()
    init_schema(db)
    if "graph_nodes" not in db.table_names():
        return {"ok": False, "error": "graph_nodes table missing — run graph build on topic first"}
    rows = list(db.query(
        "SELECT label, metadata_json FROM graph_nodes "
        "WHERE topic = ? AND kind IN ('product','company','competitor') "
        "LIMIT 20",
        [topic],
    ))
    # Dedupe by lowercase label; pick at most 10.
    seen = set()
    competitors = []
    for r in rows:
        label = (r.get("label") or "").strip()
        if not label or label.lower() in seen:
            continue
        seen.add(label.lower())
        meta = {}
        try:
            meta = json.loads(r.get("metadata_json") or "{}") or {}
        except Exception:
            meta = {}
        competitors.append({
            "name": label,
            "urls": {k: v for k, v in meta.items() if k in ("website", "appstore", "subreddit", "g2", "capterra")},
            "category": "",
        })
        if len(competitors) >= 10:
            break

    # Derive category from topic label + any suggested
    category = topic
    return create_product(
        name=name or topic,
        one_liner=one_liner,
        category=category,
        topic=topic,
        competitors=competitors,
    )


__all__ = [
    "create_product", "list_products", "get_product", "update_product",
    "add_competitor", "remove_competitor", "delete_product",
    "convert_topic_to_product",
]
