"""Persona chat — RAG over the persona's own memories.

Retrieval is keyword-based for Phase 1 (LIKE over lesson+excerpt+tags).
Phase 2 will wire each persona's memories into ChromaDB for semantic
retrieval (one collection per persona, mirroring ``palace`` design).
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


def _retrieve(persona_id: int, question: str, k: int) -> list[dict]:
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
        lines.append(
            f"[M{i}] (topic={m.get('topic') or '—'}, importance={m.get('importance'):.2f})\n"
            f"  Lesson: {m.get('lesson')}\n"
            f"  Evidence: {m.get('excerpt') or '—'}"
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

    memories = _retrieve(persona_id, question, k=k)
    context = _format_context(memories)

    try:
        from ..analyze.providers.base import get_provider
        prov = get_provider(provider)
    except Exception as e:
        return {"ok": False, "error": f"no llm configured: {e}"}

    system = (
        (persona.get("system_prompt") or "") + "\n\n"
        "You are answering a question USING ONLY YOUR OWN MEMORIES. "
        "Each memory is tagged [M1], [M2], etc. Cite the memories you use "
        "by their tag in parentheses, e.g. '...(M2, M5)'. If your memories "
        "don't cover the question, say so honestly — do NOT invent facts."
    )
    user = (
        f"Question: {question}\n\n"
        f"Your memories (most relevant first):\n{context}\n\n"
        f"Answer the question from these memories. Cite (M#)."
    )

    try:
        answer = prov.complete(prompt=user, system=system, max_tokens=800, temperature=0.3)
    except Exception as e:
        return {"ok": False, "error": f"llm call failed: {str(e)[:200]}"}

    return {
        "ok": True,
        "answer": (answer or "").strip(),
        "citations": [
            {
                "tag": f"M{i+1}",
                "memory_id": m["id"],
                "topic": m.get("topic"),
                "lesson": m.get("lesson"),
                "source_post_id": m.get("source_post_id"),
            }
            for i, m in enumerate(memories)
        ],
    }
