"""Empathy Map (Dave Gray, 2010 — popularised by Stanford d.school).

Per (topic, persona) we build a Says / Thinks / Does / Feels grid plus a
gap-note that calls out the Says-vs-Does delta. Inputs are corpus
excerpts already in SQLite; output is one row in the ``empathy_maps``
table that the UI reads back.

If no LLM provider is configured we still seed a deterministic map by
mining quotes, workaround mentions and emotion words directly from
``graph_nodes.metadata_json`` and ``posts.selftext`` — the LLM pass
upgrades it later.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any, Optional

from ..core.db import get_db, init_schema, save_mcp_analysis
from .prompts import load_extractor


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _slugify(s: str) -> str:
    s = (s or "").strip().lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s or "persona"


def _parse_json(raw: str) -> dict[str, Any]:
    cleaned = (raw or "").strip()
    for fence in ("```json", "```"):
        if cleaned.startswith(fence):
            cleaned = cleaned[len(fence):].lstrip()
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3].rstrip()
    try:
        parsed = json.loads(cleaned)
        if isinstance(parsed, dict):
            return parsed
        return {"_parse_error": True, "_raw": raw}
    except json.JSONDecodeError:
        return {"_parse_error": True, "_raw": raw}


def _gather_excerpts(db, topic: str, persona: str, limit: int = 30) -> list[dict[str, Any]]:
    """Pull a small balanced sample of posts + complaint / workaround
    nodes for the topic. Persona filtering is best-effort substring on
    title/selftext for now — when persona detection lands upstream this
    helper picks it up automatically via the same column.
    """
    out: list[dict[str, Any]] = []
    persona_q = (persona or "").strip().lower()

    if "topic_posts" in db.table_names() and "posts" in db.table_names():
        rows = list(db.query(
            """
            SELECT p.id, p.title, p.selftext, p.source_type AS source
            FROM topic_posts tp
            JOIN posts p ON p.id = tp.post_id
            WHERE tp.topic = :t
            ORDER BY COALESCE(p.score, 0) DESC
            LIMIT :n
            """,
            {"t": topic, "n": limit * 2},
        ))
        for r in rows:
            blob = f"{r.get('title', '')} {r.get('selftext', '') or ''}".strip()
            if persona_q and persona_q not in blob.lower():
                continue
            text = (r.get("selftext") or r.get("title") or "").strip()
            if not text:
                continue
            out.append({
                "source": r.get("source") or "post",
                "text": text[:600],
            })
            if len(out) >= limit:
                break

    # Top up with complaint / workaround graph nodes — they're already
    # condensed and tagged by extraction.
    if len(out) < limit and "graph_nodes" in db.table_names():
        rows = list(db.query(
            """
            SELECT label, kind FROM graph_nodes
            WHERE topic = :t AND kind IN ('complaint', 'workaround', 'feature_wish')
            LIMIT :n
            """,
            {"t": topic, "n": limit - len(out)},
        ))
        for r in rows:
            out.append({"source": r.get("kind") or "graph", "text": r.get("label") or ""})

    return out


def _seed_offline(excerpts: list[dict[str, Any]]) -> dict[str, Any]:
    """LLM-free fallback. Surfaces obvious quotes/workarounds/feelings."""
    says, does, feels = [], [], []
    EMO_TERMS = (
        "frustrated", "annoyed", "anxious", "stressed", "overwhelmed",
        "confused", "exhausted", "tired", "stuck", "lost", "angry",
        "happy", "relieved", "excited", "hopeful",
    )
    DOES_TERMS = ("workaround", "hack", "spreadsheet", "script", "manually",
                  "copy-paste", "switch to", "use instead", "build my own")
    for ex in excerpts:
        text = ex.get("text") or ""
        if not text:
            continue
        if len(says) < 6:
            quoted = re.search(r'"([^"]{10,140})"', text)
            if quoted:
                says.append(quoted.group(1).strip())
            elif len(text) <= 140:
                says.append(text.strip())
        low = text.lower()
        if len(does) < 6 and any(t in low for t in DOES_TERMS):
            does.append(text[:160].strip())
        if len(feels) < 6:
            for emo in EMO_TERMS:
                if emo in low:
                    feels.append(emo)
                    break
    feels = list(dict.fromkeys(feels))  # de-dup but keep order
    return {
        "says": says[:6],
        "thinks": [],   # the LLM is much better at this — leave blank offline
        "does": does[:6],
        "feels": feels[:6],
        "gap_note": "",
    }


def build_empathy_map(
    topic: str,
    persona: str = "primary",
    provider: Optional[str] = None,
    excerpt_limit: int = 30,
) -> dict[str, Any]:
    """Build (or refresh) an empathy map for one persona.

    Returns the persisted row plus an `_offline` flag when no LLM was used.
    """
    db = get_db()
    init_schema(db)

    excerpts = _gather_excerpts(db, topic, persona, limit=excerpt_limit)
    if not excerpts:
        return {
            "ok": False,
            "error": f"no excerpts available for topic '{topic}' and persona '{persona}'",
        }

    parsed: dict[str, Any] = {}
    used_llm = False
    try:
        from ..analyze.providers.base import get_provider
        ext = load_extractor("empathy")
        excerpts_str = "\n".join(
            f"[{e.get('source', '?')}]: {e.get('text', '')[:400]}" for e in excerpts
        )
        user = ext["user_template"].format(
            topic=topic, persona=persona, excerpts=excerpts_str,
        )
        raw = get_provider(provider).complete(
            prompt=user, system=ext["system"],
            max_tokens=1100, temperature=0.3,
        )
        parsed = _parse_json(raw)
        if not parsed.get("_parse_error") and not parsed.get("_skipped"):
            used_llm = True
    except Exception as e:
        parsed = {"_skipped": True, "reason": str(e)[:200]}

    if not used_llm:
        parsed = _seed_offline(excerpts)

    pid = f"{topic}::{_slugify(persona)}"
    now = _utc_now()
    existing = list(db.query("SELECT created_at FROM empathy_maps WHERE id = ?", [pid]))
    created_at = existing[0]["created_at"] if existing else now

    row = {
        "id": pid,
        "topic": topic,
        "persona": persona,
        "says_json": json.dumps(parsed.get("says") or []),
        "thinks_json": json.dumps(parsed.get("thinks") or []),
        "does_json": json.dumps(parsed.get("does") or []),
        "feels_json": json.dumps(parsed.get("feels") or []),
        "gap_notes": (parsed.get("gap_note") or "").strip()[:600],
        "created_at": created_at,
        "updated_at": now,
        # Persisted so reads (get_empathy_map) can tell the UI whether
        # the row came from an LLM call or the offline seed. Without
        # this, the empathy screen had no way to distinguish "row is
        # empty because nothing's been built" from "row was filled by
        # the offline seeder", and incorrectly showed "No LLM
        # configured" on every fresh topic.
        "built_offline": 0 if used_llm else 1,
    }
    db["empathy_maps"].upsert(row, pk="id")

    try:
        save_mcp_analysis(
            topic=topic, source="app", kind="empathy",
            tool="run_empathy_map",
            content=json.dumps({"persona": persona, "offline": not used_llm}),
            content_type="json", provider=provider or "", model="", params={},
        )
    except Exception:
        pass

    out = dict(row)
    out["_offline"] = not used_llm
    return out


def get_empathy_map(topic: str, persona: str = "primary") -> dict[str, Any]:
    db = get_db()
    if "empathy_maps" not in db.table_names():
        return {"ok": False, "error": "empathy_maps table missing"}
    pid = f"{topic}::{_slugify(persona)}"
    rows = list(db.query("SELECT * FROM empathy_maps WHERE id = ?", [pid]))
    if not rows:
        return {"ok": False, "error": f"empathy map for '{persona}' not found"}
    r = rows[0]
    return {
        "ok": True,
        "topic": r.get("topic"),
        "persona": r.get("persona"),
        "says": json.loads(r.get("says_json") or "[]"),
        "thinks": json.loads(r.get("thinks_json") or "[]"),
        "does": json.loads(r.get("does_json") or "[]"),
        "feels": json.loads(r.get("feels_json") or "[]"),
        "gap_notes": r.get("gap_notes") or "",
        "updated_at": r.get("updated_at") or "",
        # Surfaces to the UI so the offline-seed banner only shows
        # when the row was actually built without an LLM. Old rows
        # written before this column existed return falsy → no banner
        # (they may or may not have used the LLM, but assuming the
        # better default is preferable to a misleading warning).
        "built_offline": bool(r.get("built_offline")),
    }


def list_empathy_maps(topic: str) -> list[dict[str, Any]]:
    db = get_db()
    if "empathy_maps" not in db.table_names():
        return []
    return list(db.query(
        "SELECT id, topic, persona, gap_notes, updated_at FROM empathy_maps "
        "WHERE topic = ? ORDER BY updated_at DESC",
        [topic],
    ))


__all__ = ["build_empathy_map", "get_empathy_map", "list_empathy_maps"]
