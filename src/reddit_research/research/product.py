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


# ── Stage-Gate verdicts (Cooper, 2017) ──────────────────────────────────
# Each Product carries one current verdict: go / kill / hold / recycle.
# Persisted on the products row itself (gate_status, gate_decided_at,
# gate_notes) so it shows up on every dashboard load with no extra query.
# Setting the verdict bumps the timestamp; clearing it back to '' blanks
# both timestamp and notes. Notes are free-text rationale for the team.

VALID_GATE_STATUSES = ("", "go", "kill", "hold", "recycle")


def gate_set(
    product_id: str,
    status: str,
    notes: str = "",
) -> dict[str, Any]:
    """Set the Stage-Gate verdict on a Product. status='' clears it."""
    db = get_db()
    if "products" not in db.table_names():
        return {"ok": False, "error": "products table not initialized"}
    s = (status or "").strip().lower()
    if s not in VALID_GATE_STATUSES:
        return {
            "ok": False,
            "error": f"invalid status '{status}' — expected one of "
                     f"{', '.join(x for x in VALID_GATE_STATUSES if x)} or empty",
        }
    rows = list(db.query("SELECT id FROM products WHERE id = ?", [product_id]))
    if not rows:
        return {"ok": False, "error": f"product '{product_id}' not found"}
    patch = {
        "id": product_id,
        "gate_status": s,
        "gate_decided_at": _utc_now() if s else "",
        "gate_notes": (notes or "")[:1000] if s else "",
    }
    db["products"].upsert(patch, pk="id")
    return {
        "ok": True,
        "product_id": product_id,
        "gate_status": patch["gate_status"],
        "gate_decided_at": patch["gate_decided_at"],
        "gate_notes": patch["gate_notes"],
    }


def gate_get(product_id: str) -> dict[str, Any]:
    db = get_db()
    if "products" not in db.table_names():
        return {"ok": False, "error": "products table not initialized"}
    rows = list(db.query(
        "SELECT id, gate_status, gate_decided_at, gate_notes FROM products WHERE id = ?",
        [product_id],
    ))
    if not rows:
        return {"ok": False, "error": f"product '{product_id}' not found"}
    r = rows[0]
    return {
        "ok": True,
        "product_id": product_id,
        "gate_status": r.get("gate_status") or "",
        "gate_decided_at": r.get("gate_decided_at") or "",
        "gate_notes": r.get("gate_notes") or "",
    }


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


# ── Cagan's Four Risks (Inspired, Cagan 2017) ──────────────────────────
# Value / Usability / Feasibility / Viability — checked BEFORE the
# Stage-Gate verdict. Each risk has a status (pass / fail / unknown) and
# a free-text note. Stored as JSON on products.four_risks_json.

VALID_RISK_STATUSES = ("unknown", "pass", "fail")
RISK_KEYS = ("value", "usability", "feasibility", "viability")


def four_risks_get(product_id: str) -> dict[str, Any]:
    db = get_db()
    if "products" not in db.table_names():
        return {"ok": False, "error": "products table not initialized"}
    rows = list(db.query(
        "SELECT four_risks_json FROM products WHERE id = ?", [product_id],
    ))
    if not rows:
        return {"ok": False, "error": f"product '{product_id}' not found"}
    blob = rows[0].get("four_risks_json") or ""
    try:
        data = json.loads(blob) if blob else {}
    except (json.JSONDecodeError, TypeError):
        data = {}
    risks = {}
    for k in RISK_KEYS:
        r = data.get(k) or {}
        risks[k] = {
            "status": (r.get("status") if r.get("status") in VALID_RISK_STATUSES
                       else "unknown"),
            "notes": (r.get("notes") or "")[:600],
            "decided_at": r.get("decided_at") or "",
        }
    return {"ok": True, "product_id": product_id, "risks": risks}


def four_risks_set(
    product_id: str,
    risk: str,
    status: str,
    notes: str = "",
) -> dict[str, Any]:
    """Update one risk dimension. risk ∈ value/usability/feasibility/viability."""
    db = get_db()
    if "products" not in db.table_names():
        return {"ok": False, "error": "products table not initialized"}
    risk = (risk or "").strip().lower()
    if risk not in RISK_KEYS:
        return {
            "ok": False,
            "error": f"invalid risk '{risk}' — expected one of {', '.join(RISK_KEYS)}",
        }
    s = (status or "").strip().lower()
    if s not in VALID_RISK_STATUSES:
        return {"ok": False, "error": f"invalid status '{status}'"}
    cur = four_risks_get(product_id)
    if not cur.get("ok"):
        return cur
    data = cur["risks"]
    data[risk] = {
        "status": s,
        "notes": (notes or "")[:600],
        "decided_at": _utc_now(),
    }
    db["products"].upsert(
        {"id": product_id, "four_risks_json": json.dumps(data)},
        pk="id",
    )
    return {"ok": True, "product_id": product_id, "risks": data}


# ── Blue Ocean Value Curve (Kim & Mauborgne, 2005) ───────────────────────
# A list of factor scores (0..10) for the product itself plus each
# competitor. Stored as products.value_curve_json:
#   {
#     "factors": ["price", "ease of setup", ...],
#     "self":     [7, 9, ...],
#     "competitors": [
#       {"name": "Acme", "scores": [3, 6, ...]}
#     ],
#     "four_actions": {"eliminate": "...", "reduce": "...",
#                      "raise": "...", "create": "..."}
#   }

def value_curve_get(product_id: str) -> dict[str, Any]:
    db = get_db()
    if "products" not in db.table_names():
        return {"ok": False, "error": "products table not initialized"}
    rows = list(db.query(
        "SELECT value_curve_json FROM products WHERE id = ?", [product_id],
    ))
    if not rows:
        return {"ok": False, "error": f"product '{product_id}' not found"}
    blob = rows[0].get("value_curve_json") or ""
    try:
        data = json.loads(blob) if blob else {}
    except (json.JSONDecodeError, TypeError):
        data = {}
    return {
        "ok": True,
        "product_id": product_id,
        "factors": list(data.get("factors") or []),
        "self": list(data.get("self") or []),
        "competitors": list(data.get("competitors") or []),
        "four_actions": dict(data.get("four_actions") or {}),
    }


def value_curve_set(
    product_id: str,
    *,
    factors: list[str],
    self_scores: list[int | float],
    competitors: list[dict[str, Any]] | None = None,
    four_actions: dict[str, str] | None = None,
) -> dict[str, Any]:
    db = get_db()
    if "products" not in db.table_names():
        return {"ok": False, "error": "products table not initialized"}
    rows = list(db.query("SELECT id FROM products WHERE id = ?", [product_id]))
    if not rows:
        return {"ok": False, "error": f"product '{product_id}' not found"}

    factors = [str(f).strip() for f in (factors or []) if str(f).strip()]
    if not factors:
        return {"ok": False, "error": "at least one factor is required"}

    def _norm_scores(arr: list[Any]) -> list[float]:
        out = []
        for x in (arr or []):
            try:
                v = float(x)
            except (TypeError, ValueError):
                v = 0.0
            out.append(max(0.0, min(v, 10.0)))
        # Pad / truncate to match factors length
        while len(out) < len(factors):
            out.append(0.0)
        return out[: len(factors)]

    payload = {
        "factors": factors,
        "self": _norm_scores(self_scores),
        "competitors": [
            {
                "name": str(c.get("name") or "").strip()[:80],
                "scores": _norm_scores(c.get("scores") or []),
            }
            for c in (competitors or [])
            if (c.get("name") or "").strip()
        ],
        "four_actions": {
            "eliminate": str((four_actions or {}).get("eliminate") or "")[:300],
            "reduce":    str((four_actions or {}).get("reduce") or "")[:300],
            "raise":     str((four_actions or {}).get("raise") or "")[:300],
            "create":    str((four_actions or {}).get("create") or "")[:300],
        },
        "updated_at": _utc_now(),
    }
    db["products"].upsert(
        {"id": product_id, "value_curve_json": json.dumps(payload)},
        pk="id",
    )
    return {"ok": True, "product_id": product_id, "value_curve": payload}


# ── TAM / SAM / SOM market sizing (Blank & Dorf, 2012) ─────────────────
# Stored as products.tam_sam_som_json:
#   {tam:{value, units, method, source, notes}, sam:{...}, som:{...}}

def tam_sam_som_get(product_id: str) -> dict[str, Any]:
    db = get_db()
    if "products" not in db.table_names():
        return {"ok": False, "error": "products table not initialized"}
    rows = list(db.query(
        "SELECT tam_sam_som_json FROM products WHERE id = ?", [product_id],
    ))
    if not rows:
        return {"ok": False, "error": f"product '{product_id}' not found"}
    blob = rows[0].get("tam_sam_som_json") or ""
    try:
        data = json.loads(blob) if blob else {}
    except (json.JSONDecodeError, TypeError):
        data = {}
    out = {"tam": {}, "sam": {}, "som": {}}
    for k in ("tam", "sam", "som"):
        v = data.get(k) or {}
        if isinstance(v, dict):
            out[k] = {
                "value": float(v.get("value") or 0),
                "units": str(v.get("units") or "USD"),
                "method": str(v.get("method") or ""),
                "source": str(v.get("source") or ""),
                "notes": str(v.get("notes") or ""),
            }
    return {"ok": True, "product_id": product_id, **out}


def tam_sam_som_set(product_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    db = get_db()
    if "products" not in db.table_names():
        return {"ok": False, "error": "products table not initialized"}
    rows = list(db.query("SELECT id FROM products WHERE id = ?", [product_id]))
    if not rows:
        return {"ok": False, "error": f"product '{product_id}' not found"}

    def _norm(node: Any) -> dict[str, Any]:
        if not isinstance(node, dict):
            return {}
        try:
            value = float(node.get("value") or 0)
        except (TypeError, ValueError):
            value = 0.0
        return {
            "value": max(0.0, value),
            "units": str(node.get("units") or "USD")[:20],
            "method": str(node.get("method") or "")[:60],
            "source": str(node.get("source") or "")[:200],
            "notes": str(node.get("notes") or "")[:500],
        }

    data = {
        "tam": _norm(payload.get("tam")),
        "sam": _norm(payload.get("sam")),
        "som": _norm(payload.get("som")),
        "updated_at": _utc_now(),
    }
    db["products"].upsert(
        {"id": product_id, "tam_sam_som_json": json.dumps(data)},
        pk="id",
    )
    return {"ok": True, "product_id": product_id, **{k: v for k, v in data.items() if k != "updated_at"}}


# ── Porter's Five Forces (Porter, 1979) ────────────────────────────────
# Stored as products.porter_forces_json. Each force has a 1..5 score
# (low → high threat) plus notes.
PORTER_FORCES = (
    "new_entrants",
    "supplier_power",
    "buyer_power",
    "substitutes",
    "rivalry",
)


def porter_get(product_id: str) -> dict[str, Any]:
    db = get_db()
    if "products" not in db.table_names():
        return {"ok": False, "error": "products table not initialized"}
    rows = list(db.query(
        "SELECT porter_forces_json FROM products WHERE id = ?", [product_id],
    ))
    if not rows:
        return {"ok": False, "error": f"product '{product_id}' not found"}
    blob = rows[0].get("porter_forces_json") or ""
    try:
        data = json.loads(blob) if blob else {}
    except (json.JSONDecodeError, TypeError):
        data = {}
    forces = {}
    for k in PORTER_FORCES:
        v = data.get(k) or {}
        if isinstance(v, dict):
            try:
                score = int(v.get("score") or 0)
            except (TypeError, ValueError):
                score = 0
            score = max(0, min(score, 5))
            forces[k] = {
                "score": score,
                "notes": str(v.get("notes") or "")[:600],
            }
        else:
            forces[k] = {"score": 0, "notes": ""}
    return {"ok": True, "product_id": product_id, "forces": forces}


def porter_set(product_id: str, force: str, score: int, notes: str = "") -> dict[str, Any]:
    db = get_db()
    if "products" not in db.table_names():
        return {"ok": False, "error": "products table not initialized"}
    f = (force or "").strip().lower()
    if f not in PORTER_FORCES:
        return {"ok": False, "error": f"invalid force '{force}', expected one of {PORTER_FORCES}"}
    rows = list(db.query("SELECT id FROM products WHERE id = ?", [product_id]))
    if not rows:
        return {"ok": False, "error": f"product '{product_id}' not found"}
    cur = porter_get(product_id)
    forces = cur.get("forces") or {}
    try:
        s = int(score)
    except (TypeError, ValueError):
        s = 0
    forces[f] = {"score": max(0, min(s, 5)), "notes": (notes or "")[:600]}
    db["products"].upsert(
        {"id": product_id, "porter_forces_json": json.dumps({**forces, "updated_at": _utc_now()})},
        pk="id",
    )
    return {"ok": True, "product_id": product_id, "forces": forces}


# ── 2x2 Positioning map (Ries & Trout, 1981) ──────────────────────────
# Stored as products.positioning_map_json:
#   {x_axis: str, y_axis: str, points: [{name, x, y, is_self}]}

def positioning_get(product_id: str) -> dict[str, Any]:
    db = get_db()
    if "products" not in db.table_names():
        return {"ok": False, "error": "products table not initialized"}
    rows = list(db.query(
        "SELECT positioning_map_json FROM products WHERE id = ?", [product_id],
    ))
    if not rows:
        return {"ok": False, "error": f"product '{product_id}' not found"}
    blob = rows[0].get("positioning_map_json") or ""
    try:
        data = json.loads(blob) if blob else {}
    except (json.JSONDecodeError, TypeError):
        data = {}
    return {
        "ok": True,
        "product_id": product_id,
        "x_axis": str(data.get("x_axis") or "Price"),
        "y_axis": str(data.get("y_axis") or "Feature depth"),
        "points": list(data.get("points") or []),
    }


def positioning_set(
    product_id: str,
    *,
    x_axis: str,
    y_axis: str,
    points: list[dict[str, Any]],
) -> dict[str, Any]:
    db = get_db()
    if "products" not in db.table_names():
        return {"ok": False, "error": "products table not initialized"}
    rows = list(db.query("SELECT id FROM products WHERE id = ?", [product_id]))
    if not rows:
        return {"ok": False, "error": f"product '{product_id}' not found"}

    def _norm_pt(p: dict[str, Any]) -> dict[str, Any]:
        try:
            x = float(p.get("x") or 0)
        except (TypeError, ValueError):
            x = 0.0
        try:
            y = float(p.get("y") or 0)
        except (TypeError, ValueError):
            y = 0.0
        return {
            "name": str(p.get("name") or "")[:80],
            "x": max(0.0, min(x, 10.0)),
            "y": max(0.0, min(y, 10.0)),
            "is_self": bool(p.get("is_self")),
        }

    norm_points = [_norm_pt(p) for p in (points or []) if (p.get("name") or "").strip()]
    data = {
        "x_axis": str(x_axis or "Price")[:60],
        "y_axis": str(y_axis or "Feature depth")[:60],
        "points": norm_points,
        "updated_at": _utc_now(),
    }
    db["products"].upsert(
        {"id": product_id, "positioning_map_json": json.dumps(data)},
        pk="id",
    )
    return {"ok": True, "product_id": product_id, **{k: v for k, v in data.items() if k != "updated_at"}}


# ── Cost model + pricing tier proposal ─────────────────────────────────
# Stored as products.cost_model_json. Combines dev / infra / maintenance
# costs, blended hourly rate, LTV/CAC inputs, and 2-3 tier proposals.

def cost_model_get(product_id: str) -> dict[str, Any]:
    db = get_db()
    if "products" not in db.table_names():
        return {"ok": False, "error": "products table not initialized"}
    rows = list(db.query(
        "SELECT cost_model_json FROM products WHERE id = ?", [product_id],
    ))
    if not rows:
        return {"ok": False, "error": f"product '{product_id}' not found"}
    blob = rows[0].get("cost_model_json") or ""
    try:
        data = json.loads(blob) if blob else {}
    except (json.JSONDecodeError, TypeError):
        data = {}
    return {
        "ok": True,
        "product_id": product_id,
        "blended_rate": float(data.get("blended_rate") or 0),
        "infra_monthly": float(data.get("infra_monthly") or 0),
        "maintenance_pct": float(data.get("maintenance_pct") or 18.0),
        "ltv": float(data.get("ltv") or 0),
        "cac": float(data.get("cac") or 0),
        "tiers": list(data.get("tiers") or []),
        "currency": str(data.get("currency") or "USD"),
    }


def cost_model_set(product_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    db = get_db()
    if "products" not in db.table_names():
        return {"ok": False, "error": "products table not initialized"}
    rows = list(db.query("SELECT id FROM products WHERE id = ?", [product_id]))
    if not rows:
        return {"ok": False, "error": f"product '{product_id}' not found"}

    def _f(x, dflt=0.0):
        try:
            return float(x)
        except (TypeError, ValueError):
            return dflt

    tiers = []
    for t in (payload.get("tiers") or []):
        if not isinstance(t, dict):
            continue
        name = str(t.get("name") or "").strip()[:40]
        if not name:
            continue
        tiers.append({
            "name": name,
            "scope": str(t.get("scope") or "")[:600],
            "weeks_lo": _f(t.get("weeks_lo")),
            "weeks_hi": _f(t.get("weeks_hi")),
            "price_lo": _f(t.get("price_lo")),
            "price_hi": _f(t.get("price_hi")),
            "excludes": str(t.get("excludes") or "")[:400],
        })

    data = {
        "blended_rate": _f(payload.get("blended_rate")),
        "infra_monthly": _f(payload.get("infra_monthly")),
        "maintenance_pct": _f(payload.get("maintenance_pct"), 18.0),
        "ltv": _f(payload.get("ltv")),
        "cac": _f(payload.get("cac")),
        "currency": str(payload.get("currency") or "USD")[:8],
        "tiers": tiers,
        "updated_at": _utc_now(),
    }
    db["products"].upsert(
        {"id": product_id, "cost_model_json": json.dumps(data)},
        pk="id",
    )
    return {"ok": True, "product_id": product_id, **{k: v for k, v in data.items() if k != "updated_at"}}


__all__ = [
    "create_product", "list_products", "get_product", "update_product",
    "add_competitor", "remove_competitor", "delete_product",
    "convert_topic_to_product",
    "gate_set", "gate_get", "VALID_GATE_STATUSES",
    "four_risks_get", "four_risks_set", "RISK_KEYS", "VALID_RISK_STATUSES",
    "value_curve_get", "value_curve_set",
    "tam_sam_som_get", "tam_sam_som_set",
    "porter_get", "porter_set", "PORTER_FORCES",
    "positioning_get", "positioning_set",
    "cost_model_get", "cost_model_set",
]
