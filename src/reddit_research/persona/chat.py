"""Persona chat — RAG over the persona's own memories.

Phase 3a (2026-05-12): semantic retrieval via the per-persona ChromaDB
collection (the memory-palace-per-persona "mirofish learning" link).
Falls back to keyword LIKE if ChromaDB is unavailable so the feature
still works on lean installs.

The system prompt is **conclusion-primed**: the top-K highest-confidence
conclusions (Phase 2b output) are injected as "established beliefs"
separate from the retrieved memories, letting the persona reason from
its consolidated worldview without the LLM having to re-derive it from
the raw memory list each turn.
"""
from __future__ import annotations

import json
import re
from typing import Any

from ..core.db import get_db
from .store import get_persona


_KEYWORD_LIMIT = 8


def _extract_keywords(question: str) -> list[str]:
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


def _retrieve_semantic(persona_id: int, question: str, k: int) -> list[dict] | None:
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


def _retrieve(persona_id: int, question: str, k: int) -> tuple[list[dict], str]:
    """Try semantic first, fall back to keyword. Returns (rows, retrieval_kind)."""
    sem = _retrieve_semantic(persona_id, question, k)
    if sem is not None:
        return sem, "semantic"
    return _retrieve_keyword(persona_id, question, k), "keyword"


def _retrieve_keyword(persona_id: int, question: str, k: int) -> list[dict]:
    """Score memories by keyword overlap; tie-break by importance + recency."""
    db = get_db()
    kws = _extract_keywords(question)
    if not kws:
        # Empty question → just return most-important recent memories
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
            f"(LOWER(lesson) LIKE ?) + (LOWER(excerpt) LIKE ?) + (LOWER(tags) LIKE ?)"
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


def _format_context(memories: list[dict]) -> str:
    if not memories:
        return "(no memories matched)"
    lines = []
    for i, m in enumerate(memories, 1):
        extras = f"importance={m.get('importance'):.2f}"
        if "similarity" in m:
            extras += f", sim={m['similarity']:.2f}"
        lines.append(
            f"[M{i}] (topic={m.get('topic') or '—'}, {extras})\n"
            f"  Lesson: {m.get('lesson')}\n"
            f"  Evidence: {m.get('excerpt') or '—'}"
        )
    return "\n\n".join(lines)


def _format_conclusions(rows: list[dict]) -> str:
    if not rows:
        return ""
    lines = []
    for i, c in enumerate(rows, 1):
        lines.append(
            f"[C{i}] (confidence={c.get('confidence') or 0:.2f}, "
            f"evidence_count={len(c.get('evidence') or [])})\n"
            f"  {c.get('statement') or ''}"
        )
    return "\n\n".join(lines)


def chat_persona(
    persona_id: int,
    question: str,
    *,
    k: int = 8,
    provider: str | None = None,
) -> dict:
    """Ask the persona a question. Returns {ok, answer, citations}."""
    persona = get_persona(persona_id)
    if not persona:
        return {"ok": False, "error": f"persona id={persona_id} not found"}

    memories, retrieval_kind = _retrieve(persona_id, question, k=k)
    context = _format_context(memories)

    # Conclusion priming — pull top-3 highest-confidence beliefs (if any)
    # and inject them as "established beliefs" so the persona answers
    # from its consolidated worldview, not just the per-turn memory recall.
    try:
        from .conclude import list_conclusions
        top_concl = list_conclusions(persona_id, limit=3) or []
    except Exception:
        top_concl = []
    beliefs_block = _format_conclusions(top_concl)

    try:
        from ..analyze.providers.base import get_provider
        prov = get_provider(provider)
    except Exception as e:
        return {"ok": False, "error": f"no llm configured: {e}"}

    beliefs_intro = (
        "Your established beliefs (synthesised from clusters of your memories):\n"
        f"{beliefs_block}\n\n"
    ) if beliefs_block else ""

    system = (
        (persona.get("system_prompt") or "") + "\n\n"
        + beliefs_intro
        + "You are answering a question USING ONLY YOUR OWN MEMORIES + your "
        "established beliefs above. Memories are tagged [M1], [M2]…; beliefs "
        "are tagged [C1], [C2]…. Cite what you use, e.g. '…(M2, C1)'. If "
        "your memories + beliefs don't cover the question, say so honestly "
        "— do NOT invent facts."
    )
    user = (
        f"Question: {question}\n\n"
        f"Your memories (most relevant first):\n{context}\n\n"
        f"Answer the question. Cite (M#) and (C#) where appropriate."
    )

    try:
        answer = prov.complete(prompt=user, system=system, max_tokens=800, temperature=0.3)
    except Exception as e:
        return {"ok": False, "error": f"llm call failed: {str(e)[:200]}"}

    return {
        "ok": True,
        "answer": (answer or "").strip(),
        "retrieval": retrieval_kind,
        "citations": [
            {
                "tag": f"M{i+1}",
                "memory_id": m["id"],
                "topic": m.get("topic"),
                "lesson": m.get("lesson"),
                "source_post_id": m.get("source_post_id"),
                "similarity": m.get("similarity"),
            }
            for i, m in enumerate(memories)
        ],
        "beliefs": [
            {
                "tag": f"C{i+1}",
                "conclusion_id": c.get("id"),
                "confidence": c.get("confidence"),
                "statement": c.get("statement"),
            }
            for i, c in enumerate(top_concl)
        ],
    }
