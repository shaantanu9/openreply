"""GummySearch import + discovery presets — the migration wedge.

GummySearch shuts down Nov 30 2026 (no Reddit commercial licence), stranding
thousands of paying users who've curated "audiences" (collections of
subreddits). This module lets them carry that work into Gap Map: import a
GummySearch export (JSON or CSV, tolerant of shape) into an ``audiences`` table,
and seed fresh users with curated preset bundles so first-run feels instant.

Importing only stores the audience → subreddit mapping; the user then runs a
normal ``collect`` against those subreddits.
"""
from __future__ import annotations

import csv as _csv
import io
import json as _json
import re as _re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ..core.db import get_db

# Curated niche → subreddit bundles. Instant first-run for new users.
PRESET_BUNDLES: dict[str, list[str]] = {
    "saas": ["SaaS", "Entrepreneur", "startups", "indiehackers", "microsaas"],
    "ai_tools": ["artificial", "MachineLearning", "OpenAI", "LocalLLaMA", "ChatGPT"],
    "fitness": ["Fitness", "loseit", "bodyweightfitness", "running", "xxfitness"],
    "personal_finance": ["personalfinance", "financialindependence", "investing", "Frugal"],
    "productivity": ["productivity", "getdisciplined", "Notion", "ObsidianMD"],
    "mental_health": ["mentalhealth", "Anxiety", "meditation", "selfimprovement"],
    "ecommerce": ["ecommerce", "shopify", "FulfillmentByAmazon", "dropship"],
    "developers": ["webdev", "programming", "learnprogramming", "ExperiencedDevs"],
}


def _ensure_table() -> None:
    db = get_db()
    db.execute(
        "CREATE TABLE IF NOT EXISTS audiences ("
        " audience_id TEXT PRIMARY KEY,"
        " name TEXT NOT NULL,"
        " subreddits TEXT,"          # JSON list
        " source TEXT,"             # gummysearch | preset | manual
        " created_at TEXT)"
    )
    db.conn.commit()


def _norm_sub(s: str) -> str:
    s = (s or "").strip()
    s = _re.sub(r"^/?r/", "", s, flags=_re.IGNORECASE)  # strip r/ or /r/
    return s.strip("/ ").strip()


def _save_audience(name: str, subs: list[str], source: str) -> dict | None:
    subs = [_norm_sub(x) for x in subs if _norm_sub(x)]
    # dedupe preserving order
    seen, clean = set(), []
    for s in subs:
        k = s.lower()
        if k not in seen:
            seen.add(k); clean.append(s)
    if not clean:
        return None
    db = get_db()
    aid = uuid.uuid4().hex[:12]
    db.execute(
        "INSERT INTO audiences(audience_id,name,subreddits,source,created_at) VALUES(?,?,?,?,?)",
        [aid, name or "Imported audience", _json.dumps(clean), source,
         datetime.now(timezone.utc).isoformat(timespec="seconds")],
    )
    return {"audience_id": aid, "name": name, "count": len(clean), "subreddits": clean}


def _parse_json(text: str) -> list[dict]:
    """Return a list of {name, subreddits} from tolerant JSON shapes."""
    data = _json.loads(text)
    out: list[dict] = []
    # Shape A: {"audiences": [...]}
    if isinstance(data, dict) and "audiences" in data:
        data = data["audiences"]
    # Shape B: list of dicts {name, subreddits:[...]}
    if isinstance(data, list) and data and isinstance(data[0], dict):
        for a in data:
            name = a.get("name") or a.get("title") or a.get("audience") or "Imported"
            subs = a.get("subreddits") or a.get("subs") or a.get("communities") or []
            if isinstance(subs, str):
                subs = _re.split(r"[,\s]+", subs)
            out.append({"name": name, "subreddits": subs})
        return out
    # Shape C: flat list of subreddit strings
    if isinstance(data, list):
        out.append({"name": "Imported audience", "subreddits": [str(x) for x in data]})
        return out
    # Shape D: dict mapping name → [subs]
    if isinstance(data, dict):
        for name, subs in data.items():
            if isinstance(subs, list):
                out.append({"name": name, "subreddits": subs})
    return out


def _parse_csv(text: str) -> list[dict]:
    """Group CSV rows into audiences. Recognises name/audience + subreddit cols;
    falls back to one audience of all subreddit-like cells."""
    reader = _csv.reader(io.StringIO(text))
    rows = [r for r in reader if any(c.strip() for c in r)]
    if not rows:
        return []
    header = [h.strip().lower() for h in rows[0]]
    has_header = any(h in ("name", "audience", "subreddit", "subreddits", "community") for h in header)
    name_idx = next((i for i, h in enumerate(header) if h in ("name", "audience")), None)
    sub_idx = next((i for i, h in enumerate(header) if h in ("subreddit", "subreddits", "community")), None)
    body = rows[1:] if has_header else rows
    groups: dict[str, list[str]] = {}
    for r in body:
        name = (r[name_idx].strip() if name_idx is not None and name_idx < len(r) else "Imported audience") or "Imported audience"
        if sub_idx is not None and sub_idx < len(r):
            for s in _re.split(r"[,;\s]+", r[sub_idx]):
                if s.strip():
                    groups.setdefault(name, []).append(s)
        else:
            for cell in r:  # no sub column — treat every cell as a candidate sub
                if cell.strip():
                    groups.setdefault(name, []).append(cell)
    return [{"name": n, "subreddits": s} for n, s in groups.items()]


def import_file(path: str) -> dict[str, Any]:
    """Import a GummySearch export (JSON or CSV). Returns {ok, imported, audiences}."""
    _ensure_table()
    p = Path(path)
    if not p.exists():
        return {"ok": False, "error": f"file not found: {path}"}
    text = p.read_text(encoding="utf-8", errors="ignore")
    try:
        parsed = _parse_json(text) if (p.suffix.lower() == ".json" or text.lstrip()[:1] in "[{") \
            else _parse_csv(text)
    except Exception as e:
        # last-ditch: try the other parser
        try:
            parsed = _parse_csv(text)
        except Exception:
            return {"ok": False, "error": f"could not parse export: {e}"}
    saved = [a for a in (_save_audience(x["name"], x["subreddits"], "gummysearch") for x in parsed) if a]
    get_db().conn.commit()
    return {"ok": True, "imported": len(saved), "audiences": saved}


def list_audiences() -> dict[str, Any]:
    _ensure_table()
    db = get_db()
    rows = list(db.query("SELECT * FROM audiences ORDER BY created_at DESC"))
    for r in rows:
        try:
            r["subreddits"] = _json.loads(r.get("subreddits") or "[]")
        except Exception:
            r["subreddits"] = []
        r["count"] = len(r["subreddits"])
    return {"ok": True, "count": len(rows), "rows": rows}


def presets() -> dict[str, Any]:
    """The curated niche → subreddit bundles available for one-click seeding."""
    return {"ok": True, "count": len(PRESET_BUNDLES),
            "presets": [{"key": k, "subreddits": v, "count": len(v)}
                        for k, v in PRESET_BUNDLES.items()]}


def import_preset(key: str) -> dict[str, Any]:
    _ensure_table()
    subs = PRESET_BUNDLES.get(key)
    if not subs:
        return {"ok": False, "error": f"unknown preset {key!r}",
                "available": list(PRESET_BUNDLES.keys())}
    a = _save_audience(key.replace("_", " ").title(), subs, "preset")
    get_db().conn.commit()
    return {"ok": True, "audience": a}


__all__ = ["import_file", "list_audiences", "presets", "import_preset", "PRESET_BUNDLES"]
