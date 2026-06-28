"""Clarified-brief helpers for OpenReply.

set_brief / get_brief  — persist/retrieve per-topic research brief fields.
brief_preamble         — render a compact prompt block from the brief.
suggest_clarifications — LLM-powered 2-3 clarifying questions (best-effort).
"""
from __future__ import annotations


def set_brief(
    topic: str,
    *,
    goal: str = "",
    constraints: str = "",
    success: str = "",
    audience: str = "",
) -> None:
    """Upsert the four clarified-brief fields for *topic* in topic_prefs."""
    from ..core.db import get_db

    db = get_db()
    db["topic_prefs"].upsert(
        {
            "topic": topic,
            "brief_goal": goal,
            "brief_constraints": constraints,
            "brief_success": success,
            "brief_audience": audience,
        },
        pk="topic",
        alter=False,
    )


def get_brief(topic: str) -> dict:
    """Return the four brief fields for *topic* (empty strings if unset/missing)."""
    _empty = {"goal": "", "constraints": "", "success": "", "audience": ""}
    try:
        from ..core.db import get_db

        db = get_db()
        if "topic_prefs" not in db.table_names():
            return _empty
        rows = list(db.query(
            "SELECT brief_goal, brief_constraints, brief_success, brief_audience "
            "FROM topic_prefs WHERE topic = ?",
            [topic],
        ))
        if not rows:
            return _empty
        r = rows[0]
        return {
            "goal": r.get("brief_goal") or "",
            "constraints": r.get("brief_constraints") or "",
            "success": r.get("brief_success") or "",
            "audience": r.get("brief_audience") or "",
        }
    except Exception:
        return _empty


def brief_preamble(topic: str) -> str:
    """Return a compact prompt preamble scoping the LLM to the research brief.

    Returns an empty string when no brief has been set (all fields empty).
    """
    b = get_brief(topic)
    lines: list[str] = []
    if b.get("goal"):
        lines.append(f"- Goal: {b['goal']}")
    if b.get("constraints"):
        lines.append(f"- Constraints: {b['constraints']}")
    if b.get("success"):
        lines.append(f"- Success criteria: {b['success']}")
    if b.get("audience"):
        lines.append(f"- Audience: {b['audience']}")

    if not lines:
        return ""

    return "Research brief — scope your analysis to this:\n" + "\n".join(lines)


def suggest_clarifications(topic: str, corpus_sample: str = "") -> dict:
    """Ask the LLM for 2-3 clarifying questions about the research brief.

    On any error or missing provider, returns ``{"questions": [], "skipped": True, ...}``.
    Never raises.
    """
    try:
        from ..analyze.providers.base import get_provider

        prov = get_provider()
        b = get_brief(topic)
        existing = "\n".join(
            f"  {k}: {v}" for k, v in b.items() if v
        ) or "  (none)"
        prompt = (
            f"You are helping a researcher clarify their brief for the topic: {topic!r}.\n\n"
            f"Current brief:\n{existing}\n\n"
            + (f"Corpus sample:\n{corpus_sample[:1000]}\n\n" if corpus_sample else "")
            + "Ask 2-3 short clarifying questions that would help focus the research. "
            "Return only a numbered list, one question per line."
        )
        raw = prov.complete(prompt=prompt, max_tokens=300, temperature=0.3)
        text = raw if isinstance(raw, str) else (raw.get("text") or raw.get("content") or "")
        questions = [
            line.lstrip("0123456789.) ").strip()
            for line in text.splitlines()
            if line.strip()
        ]
        questions = [q for q in questions if q]
        return {"questions": questions, "skipped": False}
    except Exception as e:
        return {"questions": [], "skipped": True, "reason": str(e)}
