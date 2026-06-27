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

from .retrieve import retrieve as _retrieve  # noqa: F401  (re-exported for callers/tests)
from .store import get_persona


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
