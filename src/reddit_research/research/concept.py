"""Concept Agent — synthesize 3-5 product concepts from a topic's painpoints.

Bare-minimum MVP of the agent layer described in
`docs/superpowers/specs/2026-04-20-product-vision-agents.md`. Reads the
already-extracted painpoints + sentiment + workarounds for a topic, hands
them to ONE LLM call, and returns evidence-linked concept cards.

Every concept cites the exact painpoint labels it's justified by, so the
UI can render clickable citations back to the source painpoints.
"""
from __future__ import annotations

import json
import re
from typing import Any

from ..analyze.providers.base import get_provider
from ..core.db import get_db
from ..graph.build import _upsert_edge, _upsert_node
from ..graph.schema import ensure_graph_schema, make_node_id
from .prompts import load_extractor


def _slug(s: str) -> str:
    out = re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-")
    return out[:60] or "unnamed"


def _parse_json_list(raw: str) -> list[dict[str, Any]]:
    """Parse concept payload from common LLM output shapes.

    Accepts:
      - plain JSON array
      - fenced JSON array
      - object-wrapped lists: {"concepts":[...]} / {"ideas":[...]}
      - prose + embedded first JSON array block
    """
    text = (raw or "").strip()
    if not text:
        return []
    for fence in ("```json", "```"):
        if text.startswith(fence):
            text = text[len(fence):].lstrip()
    if text.endswith("```"):
        text = text[:-3].rstrip()
    if not text:
        return []

    def _coerce(parsed: Any) -> list[dict[str, Any]]:
        if isinstance(parsed, list):
            return [x for x in parsed if isinstance(x, dict)]
        if isinstance(parsed, dict):
            for k in ("concepts", "ideas", "items", "results"):
                v = parsed.get(k)
                if isinstance(v, list):
                    return [x for x in v if isinstance(x, dict)]
        return []

    # 1) Direct parse
    try:
        return _coerce(json.loads(text))
    except json.JSONDecodeError:
        pass

    # 2) If prefixed prose exists, parse from first json opener.
    first_obj = text.find("{")
    first_arr = text.find("[")
    first = min([i for i in (first_obj, first_arr) if i >= 0], default=-1)
    if first > 0:
        candidate = text[first:]
        try:
            got = _coerce(json.loads(candidate))
            if got:
                return got
        except json.JSONDecodeError:
            pass

    # 3) Extract first JSON array block from mixed text.
    m = re.search(r"\[\s*\{.*\}\s*\]", text, re.DOTALL)
    if m:
        try:
            got = _coerce(json.loads(m.group(0)))
            if got:
                return got
        except json.JSONDecodeError:
            pass

    return []


def _painpoints_for_topic(topic: str, limit: int = 15) -> list[dict[str, Any]]:
    """Top painpoints by (severity, frequency, # evidence edges) for the topic."""
    db = get_db()
    rows = list(db.query(
        """
        SELECT n.id, n.label, n.metadata_json,
               (SELECT count(*) FROM graph_edges e
                WHERE e.src = n.id AND e.kind = 'evidenced_by') AS n_evidence
        FROM graph_nodes n
        WHERE n.topic = :topic AND n.kind = 'painpoint'
        ORDER BY n_evidence DESC, n.label ASC
        LIMIT :lim
        """,
        {"topic": topic, "lim": limit},
    ))
    out = []
    for r in rows:
        meta = {}
        try:
            meta = json.loads(r.get("metadata_json") or "{}")
        except json.JSONDecodeError:
            pass
        out.append({
            "id": r["id"],
            "label": r["label"],
            "severity": meta.get("severity"),
            "frequency": meta.get("frequency"),
            "classification": meta.get("classification"),  # CHRONIC / EMERGING / FADING
            "evidence_excerpt": meta.get("evidence"),
            "n_evidence": r["n_evidence"],
        })
    return out


def _workarounds_for_topic(topic: str, limit: int = 10) -> list[dict[str, Any]]:
    db = get_db()
    rows = list(db.query(
        """
        SELECT n.label, n.metadata_json
        FROM graph_nodes n
        WHERE n.topic = :topic AND n.kind = 'workaround'
        ORDER BY n.label
        LIMIT :lim
        """,
        {"topic": topic, "lim": limit},
    ))
    out = []
    for r in rows:
        meta = {}
        try:
            meta = json.loads(r.get("metadata_json") or "{}")
        except json.JSONDecodeError:
            pass
        out.append({
            "label": r["label"],
            "gap": meta.get("gap"),
            "user_quote": meta.get("user_quote"),
        })
    return out


def _sentiment_blocks_for_topic(topic: str) -> list[dict[str, Any]]:
    """Per-source sentiment cards (label, dominant emotions, themes)."""
    db = get_db()
    rows = list(db.query(
        """
        SELECT n.label, n.metadata_json
        FROM graph_nodes n
        WHERE n.topic = :topic AND n.kind = 'source_sentiment'
        ORDER BY n.label
        """,
        {"topic": topic},
    ))
    out = []
    for r in rows:
        meta = {}
        try:
            meta = json.loads(r.get("metadata_json") or "{}")
        except json.JSONDecodeError:
            pass
        out.append({
            "source": meta.get("source") or r["label"],
            "tone": meta.get("label"),
            "dominant_emotions": meta.get("dominant_emotions") or [],
            "common_themes": meta.get("common_themes") or [],
        })
    return out


def _format_painpoints(pps: list[dict[str, Any]]) -> str:
    if not pps:
        return "(no painpoints yet — run gap extraction first)"
    lines = ["## Painpoints (extracted from corpus)"]
    for p in pps:
        tags = []
        if p.get("classification"):
            tags.append(str(p["classification"]))
        if p.get("severity"):
            tags.append(f"severity={p['severity']}")
        if p.get("frequency"):
            tags.append(f"freq={p['frequency']}")
        tag_str = f" [{', '.join(tags)}]" if tags else ""
        lines.append(f"- **{p['label']}**{tag_str}")
        if p.get("evidence_excerpt"):
            lines.append(f"  > {str(p['evidence_excerpt'])[:200]}")
    return "\n".join(lines)


def _format_sentiment(sents: list[dict[str, Any]]) -> str:
    if not sents:
        return ""
    lines = ["## How each source community feels"]
    for s in sents:
        emos = ", ".join(s.get("dominant_emotions") or []) or "—"
        themes = "; ".join(s.get("common_themes") or []) or "—"
        lines.append(f"- **{s['source']}** ({s.get('tone') or '?'}): {emos} · themes: {themes}")
    return "\n".join(lines)


def _format_workarounds(was: list[dict[str, Any]]) -> str:
    if not was:
        return ""
    lines = ["## DIY workarounds users already build (= strong gap signals)"]
    for w in was:
        lines.append(f"- {w['label']}")
        if w.get("user_quote"):
            lines.append(f"  > \"{str(w['user_quote'])[:160]}\"")
    return "\n".join(lines)


def _fallback_concepts(
    topic: str,
    painpoints: list[dict[str, Any]],
    workarounds: list[dict[str, Any]],
    max_concepts: int,
) -> list[dict[str, Any]]:
    """Deterministic backup when the LLM returns empty/non-JSON output.

    Keeps Concepts tab useful by generating grounded, conservative concept cards
    directly from top painpoints and known DIY workaround signals.
    """
    if not painpoints:
        return []
    ideas: list[dict[str, Any]] = []
    for i, p in enumerate(painpoints[:max(1, max_concepts)]):
        label = (p.get("label") or "").strip() or "User pain"
        top_wa = (workarounds[i]["label"] if i < len(workarounds) and workarounds[i].get("label") else None)
        short = re.sub(r"[^a-zA-Z0-9 ]+", " ", label).strip()
        title_root = " ".join(short.split()[:4]).strip() or f"{topic.title()} Helper"
        ideas.append(
            {
                "title": f"{title_root} Copilot",
                "headline": f"Fix \"{label}\" with a focused workflow for {topic}.",
                "target_user": f"People in {topic} who repeatedly face \"{label}\".",
                "core_job": f"Remove friction around \"{label}\" with one guided end-to-end flow.",
                "differentiation": (
                    f"Purpose-built around this specific painpoint instead of generic all-in-one tools."
                    + (f" Replaces current DIY workaround: {top_wa}." if top_wa else "")
                ),
                "evidence_painpoint_labels": [label],
                "confidence": "medium",
                "effort_tier": "1-month",
            }
        )
    return ideas[:max_concepts]


def concepts_for_topic(
    topic: str,
    provider: str | None = None,
    max_concepts: int = 5,
) -> dict[str, Any]:
    """Generate 3-5 product concepts for a topic, grounded in its painpoints.

    Returns: {topic, concepts: [...], persisted: int, reason?: str}
    Each concept includes evidence_painpoint_labels tying it back to the source.
    """
    pps = _painpoints_for_topic(topic, limit=15)
    if len(pps) < 2:
        return {
            "topic": topic,
            "concepts": [],
            "persisted": 0,
            "reason": f"Only {len(pps)} painpoints for this topic. Run gap extraction "
                      f"(Solutions tab or 'research gaps') first to give the concept "
                      f"agent something to work with.",
        }

    sents = _sentiment_blocks_for_topic(topic)
    was = _workarounds_for_topic(topic, limit=10)

    ext = load_extractor("concept")
    user = ext["user_template"].format(
        topic=topic,
        painpoints_block=_format_painpoints(pps),
        sentiment_block=_format_sentiment(sents),
        workarounds_block=_format_workarounds(was),
    )
    raw = get_provider(provider).complete(
        prompt=user, system=ext["system"], max_tokens=1500, temperature=0.3
    )
    concepts = _parse_json_list(raw)
    if not concepts:
        fallback = _fallback_concepts(topic, pps, was, max_concepts=max_concepts)
        if not fallback:
            return {
                "topic": topic,
                "concepts": [],
                "persisted": 0,
                "reason": "LLM returned non-JSON or empty output. Try re-running.",
            }
        concepts = fallback
        fallback_reason = "LLM output was empty/non-JSON; returned deterministic fallback concepts."
    else:
        fallback_reason = None

    # Persist each concept as a graph node + cite back to its evidence painpoints.
    ensure_graph_schema()
    db = get_db()
    topic_node = make_node_id(topic, "topic", topic)
    if db["graph_nodes"].count_where("id = ?", [topic_node]) == 0:
        _upsert_node(db, topic, "topic", topic, topic)

    # Build a label → painpoint-node-id lookup so we can wire evidence edges.
    pp_lookup = {p["label"]: p["id"] for p in pps}

    persisted = 0
    concepts = concepts[:max_concepts]  # enforce cap
    for c in concepts:
        title = (c.get("title") or "").strip()
        if not title:
            continue
        concept_node = _upsert_node(
            db, topic, "concept", _slug(title), title,
            metadata={
                "headline": c.get("headline"),
                "target_user": c.get("target_user"),
                "core_job": c.get("core_job"),
                "differentiation": c.get("differentiation"),
                "evidence_painpoint_labels": c.get("evidence_painpoint_labels") or [],
                "confidence": c.get("confidence"),
                "effort_tier": c.get("effort_tier"),
            },
        )
        _upsert_edge(db, topic, topic_node, concept_node, "has_concept")

        # Wire evidence edges: concept --based_on--> painpoint
        for pp_label in (c.get("evidence_painpoint_labels") or []):
            pp_id = pp_lookup.get(pp_label)
            if pp_id:
                _upsert_edge(db, topic, concept_node, pp_id, "based_on")
        persisted += 1

    out = {"topic": topic, "concepts": concepts, "persisted": persisted}
    if fallback_reason:
        out["reason"] = fallback_reason
        out["fallback"] = True

    try:
        from ..core.db import save_mcp_analysis
        save_mcp_analysis(
            topic=topic, source="app", kind="concepts", tool="run_concepts",
            content=json.dumps(out, ensure_ascii=False, default=str),
            content_type="json",
            provider=provider or "",
            model="",
            params={"max_concepts": max_concepts, "painpoints": len(pps),
                    "workarounds": len(was), "fallback": bool(fallback_reason)},
        )
    except Exception:
        pass

    return out
