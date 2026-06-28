"""Persona memory retrieval primitives — shared by `chat.py` (RAG chat) and
`reply/knowledge.py` (the reply/content blend).

Extracted from `chat.py` so the reply engine can pull a persona's own
knowledge (memories + semantic graph) into a draft without importing the
chat surface. Behaviour is byte-for-byte what `chat.py` used before:

- `retrieve()` tries the per-persona ChromaDB collection (cosine) first and
  falls back to keyword LIKE over `persona_memories` if Chroma is
  unavailable or empty, so the feature still works on lean installs.
- An empty/blank query degrades to "most-important recent memories", which
  is exactly what standalone content generation wants when no angle is given.
"""
from __future__ import annotations

import json
import re
from typing import Any

from ..core.db import get_db

_KEYWORD_LIMIT = 8


def extract_keywords(question: str) -> list[str]:
    """Strip stopwords + short tokens. Heuristic but good enough for LIKE retrieval."""
    stop = {
        "the", "a", "an", "and", "or", "but", "if", "then", "of", "in", "on",
        "to", "for", "is", "are", "was", "were", "be", "do", "does", "did",
        "i", "you", "we", "they", "he", "she", "it", "this", "that", "these",
        "those", "as", "at", "by", "with", "from", "what", "who", "how",
        "when", "where", "why", "which", "tell", "me", "about", "can",
        "should", "would", "could", "will", "have", "has", "had",
    }
    toks = re.findall(r"[A-Za-z][A-Za-z0-9'-]+", (question or "").lower())
    out: list[str] = []
    for t in toks:
        if len(t) < 3 or t in stop:
            continue
        if t not in out:
            out.append(t)
        if len(out) >= _KEYWORD_LIMIT:
            break
    return out


def retrieve_semantic(persona_id: int, question: str, k: int) -> list[dict] | None:
    """Cosine-search the persona's Chroma collection. Returns None if Chroma
    unavailable or the collection is empty — caller falls back to keyword."""
    try:
        from .graph import _get_collection
    except Exception:
        return None
    coll = _get_collection(persona_id)
    if coll is None:
        return None
    try:
        if (coll.count() or 0) == 0:
            return None
        res = coll.query(
            query_texts=[question],
            n_results=int(k),
            include=["distances", "metadatas"],
        )
    except Exception:
        return None
    ids = (res.get("ids") or [[]])[0]
    dists = (res.get("distances") or [[]])[0]
    if not ids:
        return None
    try:
        mem_ids = [int(i) for i in ids]
    except (TypeError, ValueError):
        return None
    sim_by_id = {mid: 1.0 - float(d or 0.0) for mid, d in zip(mem_ids, dists)}
    db = get_db()
    qmarks = ",".join("?" * len(mem_ids))
    cur = db.execute(
        f"SELECT id, source_post_id, topic, lesson, excerpt, tags, importance, "
        f"created_at FROM persona_memories WHERE id IN ({qmarks})",
        mem_ids,
    )
    cols = [c[0] for c in cur.description]
    rows = [dict(zip(cols, r)) for r in cur.fetchall()]
    # Preserve cosine ordering (Chroma's ranked list)
    rows.sort(key=lambda r: -sim_by_id.get(r["id"], 0.0))
    for r in rows:
        try:
            r["tags"] = json.loads(r.get("tags") or "[]")
        except (TypeError, ValueError):
            r["tags"] = []
        r["similarity"] = sim_by_id.get(r["id"], 0.0)
    return rows


def retrieve_keyword(persona_id: int, question: str, k: int) -> list[dict]:
    """Score memories by keyword overlap; tie-break by importance + recency.

    An empty keyword set (blank question) returns the most-important recent
    memories — the natural seed for angle-less content generation.
    """
    db = get_db()
    kws = extract_keywords(question)
    if not kws:
        sql = (
            "SELECT id, source_post_id, topic, lesson, excerpt, tags, importance, created_at "
            "FROM persona_memories WHERE persona_id = ? "
            "ORDER BY importance DESC, created_at DESC LIMIT ?"
        )
        cur = db.execute(sql, [persona_id, int(k)])
    else:
        like_terms = " OR ".join(
            ["LOWER(lesson) LIKE ?", "LOWER(excerpt) LIKE ?", "LOWER(tags) LIKE ?"]
            * len(kws)
        )
        params: list[Any] = [persona_id]
        for kw in kws:
            p = f"%{kw}%"
            params.extend([p, p, p])
        # Score = total number of LIKE hits across lesson+excerpt+tags
        score_expr = " + ".join(
            "(LOWER(lesson) LIKE ?) + (LOWER(excerpt) LIKE ?) + (LOWER(tags) LIKE ?)"
            for _ in kws
        )
        params_score = []
        for kw in kws:
            p = f"%{kw}%"
            params_score.extend([p, p, p])
        sql = (
            f"SELECT id, source_post_id, topic, lesson, excerpt, tags, importance, "
            f"created_at, ({score_expr}) AS score "
            f"FROM persona_memories WHERE persona_id = ? AND ({like_terms}) "
            f"ORDER BY score DESC, importance DESC, created_at DESC LIMIT ?"
        )
        cur = db.execute(sql, params_score + [persona_id] + params[1:] + [int(k)])
    cols = [c[0] for c in cur.description]
    out = []
    for r in cur.fetchall():
        d = dict(zip(cols, r))
        try:
            d["tags"] = json.loads(d.get("tags") or "[]")
        except (TypeError, ValueError):
            d["tags"] = []
        out.append(d)
    return out


def retrieve(persona_id: int, question: str, k: int) -> tuple[list[dict], str]:
    """Try semantic first, fall back to keyword. Returns (rows, retrieval_kind)."""
    sem = retrieve_semantic(persona_id, question, k)
    if sem is not None:
        return sem, "semantic"
    return retrieve_keyword(persona_id, question, k), "keyword"
