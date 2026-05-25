"""Per-painpoint emotion + JTBD extraction.

One LLM call per painpoint, grounded in the evidence posts already linked
to that painpoint by the gap-mining stage. Returns structured JSON that
is stored as metadata on the painpoint graph node.
"""
from __future__ import annotations

import json
from typing import Any

from ..analyze.providers.base import get_provider
from .prompts import load_extractor


def _format_evidence(posts: list[dict[str, Any]]) -> str:
    parts = []
    for p in posts[:5]:
        body = (p.get("selftext") or "")[:400]
        parts.append(f"[{p.get('id', '?')}] {p.get('title', '')}\n{body}")
    return "\n\n".join(parts)


def _parse_json(raw: str) -> dict[str, Any]:
    cleaned = raw.strip()
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


def extract_why_for_painpoint(
    painpoint_label: str,
    evidence_posts: list[dict[str, Any]],
    provider: str | None = None,
) -> dict[str, Any]:
    """Run the why extractor for one painpoint.

    Returns either {emotions, jtbd} or {_skipped: True, reason: ...} or
    {_parse_error: True, _raw: ...}. Never raises on bad LLM output.
    """
    if not evidence_posts:
        return {"_skipped": True, "reason": "no_evidence"}

    ext = load_extractor("why")
    user = ext["user_template"].format(
        painpoint_label=painpoint_label,
        evidence=_format_evidence(evidence_posts),
    )
    raw = get_provider(provider).complete(
        prompt=user, system=ext["system"], max_tokens=512, temperature=0.2
    )
    return _parse_json(raw)


def _evidence_posts_for(db, topic: str, painpoint_id: str) -> list[dict[str, Any]]:
    """Return up to 5 evidence posts for one painpoint by walking
    `evidenced_by` edges from painpoint -> post and joining `posts`."""
    rows = list(db.query(
        """
        SELECT p.id, p.title, p.selftext
        FROM graph_edges e
        JOIN graph_nodes n ON n.id = e.dst AND n.kind = 'post'
        JOIN posts p ON p.id = substr(n.id, instr(n.id, '::post::') + 8)
        WHERE e.src = :src AND e.kind = 'evidenced_by'
        LIMIT 5
        """,
        {"src": painpoint_id},
    ))
    return rows


def extract_why_for_topic(
    topic: str,
    provider: str | None = None,
) -> list[dict[str, Any]]:
    """Extract why-data for every painpoint in a topic.

    Returns: [{painpoint_id, painpoint_label, why}, ...]
    Painpoints with no evidence are skipped (why = {_skipped: True}).
    """
    from ..core.db import get_db
    db = get_db()
    pps = list(db.query(
        "SELECT id, label FROM graph_nodes WHERE topic = :t AND kind = 'painpoint'",
        {"t": topic},
    ))
    out = []
    for pp in pps:
        evidence = _evidence_posts_for(db, topic, pp["id"])
        why = extract_why_for_painpoint(
            painpoint_label=pp["label"],
            evidence_posts=evidence,
            provider=provider,
        )
        out.append({"painpoint_id": pp["id"], "painpoint_label": pp["label"], "why": why})
    return out
