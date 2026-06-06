"""Shared foundation for the strategy / pre-build framework modules.

The strategy modules (market sizing, Porter's Five Forces, SWOT, Lean Canvas,
Value-Proposition Canvas, North-Star) all follow the same shape:

    <name>_get(topic)            -> cached artifact dict (pure read, never raises)
    <name>_compute(topic, ...)   -> run the LLM synthesis, persist, return it

To avoid every module re-implementing provider resolution, tolerant JSON
parsing, evidence gathering, and persistence, those concerns live here:

* ``get_artifact`` / ``put_artifact`` — one topic-keyed row per framework in
  the ``strategy_artifacts`` table (created on first use).
* ``run_llm_json`` — resolve provider, call ``complete``, parse JSON tolerantly.
  Returns ``None`` when no LLM is configured or the call/parse fails, so callers
  degrade to an "configure an LLM key" empty state instead of raising.
* ``topic_context`` — the evidence bundle (painpoints, feature-wishes,
  complaints, workarounds, competitors, products, corpus size + source mix)
  every framework prompt is grounded in.

Pure helpers — reads never raise; the caller decides what an empty result means.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any

from ..core.db import get_db


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ── persistence ─────────────────────────────────────────────────────────────

def _ensure_table(db) -> None:
    if "strategy_artifacts" not in db.table_names():
        db["strategy_artifacts"].create(
            {
                "topic": str,
                "kind": str,          # 'market_sizing' | 'porter' | 'swot' | ...
                "data_json": str,     # the framework payload
                "provider": str,      # resolved LLM provider at compute time
                "model": str,
                "created_at": str,
                "updated_at": str,
            },
            pk=("topic", "kind"),
        )
        db["strategy_artifacts"].create_index(["topic"])


def get_artifact(topic: str, kind: str) -> dict[str, Any] | None:
    """Return the persisted artifact for ``(topic, kind)`` or ``None``.

    Shape: ``{"data": {...}, "provider": str, "model": str, "updated_at": str}``.
    Never raises.
    """
    try:
        db = get_db()
        _ensure_table(db)
        rows = list(db.query(
            "SELECT data_json, provider, model, updated_at "
            "FROM strategy_artifacts WHERE topic = :t AND kind = :k",
            {"t": topic, "k": kind},
        ))
    except Exception:
        return None
    if not rows:
        return None
    r = rows[0]
    try:
        data = json.loads(r.get("data_json") or "{}") or {}
    except Exception:
        data = {}
    return {
        "data": data,
        "provider": r.get("provider") or "",
        "model": r.get("model") or "",
        "updated_at": r.get("updated_at") or "",
    }


def put_artifact(
    topic: str, kind: str, data: dict[str, Any],
    *, provider: str = "", model: str = "",
) -> dict[str, Any]:
    """Upsert one framework artifact. Returns the same ``get_artifact`` shape."""
    db = get_db()
    _ensure_table(db)
    now = _utc_now()
    db["strategy_artifacts"].upsert(
        {
            "topic": topic,
            "kind": kind,
            "data_json": json.dumps(data, ensure_ascii=False, default=str),
            "provider": provider or "",
            "model": model or "",
            "created_at": now,
            "updated_at": now,
        },
        pk=("topic", "kind"),
    )
    return {"data": data, "provider": provider or "", "model": model or "",
            "updated_at": now}


# ── LLM ─────────────────────────────────────────────────────────────────────

def _parse_json(text: str) -> dict[str, Any] | None:
    """Tolerant JSON-object parse: raw → fenced ```json → first {...} block."""
    if not text:
        return None
    candidates = [
        text,
        text.strip().strip("`").lstrip("json").strip(),
    ]
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if m:
        candidates.append(m.group(0))
    for c in candidates:
        try:
            obj = json.loads(c)
            if isinstance(obj, dict):
                return obj
        except Exception:
            continue
    return None


def resolve_llm(provider: str | None = None):
    """Return ``(provider_obj, resolved_name, model)`` or ``(None, "", "")``.

    Never raises — callers branch on a ``None`` provider object.
    """
    try:
        import os
        from ..analyze.providers.base import resolve_provider, get_provider
        name = resolve_provider(provider)  # raises when nothing configured
        provider_obj = get_provider()
        model = os.getenv("LLM_MODEL", "") or ""
        return provider_obj, (name or ""), model
    except Exception:
        return None, "", ""


def run_llm_json(
    prompt: str,
    system: str,
    *,
    provider: str | None = None,
    max_tokens: int = 1600,
    temperature: float = 0.3,
) -> tuple[dict[str, Any] | None, str, str]:
    """Run one JSON-returning LLM call. Returns ``(parsed_or_None, provider, model)``."""
    provider_obj, name, model = resolve_llm(provider)
    if provider_obj is None:
        return None, "", ""
    try:
        raw = provider_obj.complete(
            prompt=prompt, system=system,
            max_tokens=max_tokens, temperature=temperature,
        )
    except Exception:
        return None, name, model
    return _parse_json(raw), name, model


# ── evidence / corpus context ───────────────────────────────────────────────

def _nodes_by_kinds(db, topic: str, kinds: tuple[str, ...], limit: int) -> list[str]:
    if "graph_nodes" not in db.table_names():
        return []
    placeholders = ",".join(f":k{i}" for i in range(len(kinds)))
    params: dict[str, Any] = {"t": topic, "n": limit}
    for i, k in enumerate(kinds):
        params[f"k{i}"] = k
    try:
        rows = list(db.query(
            f"""
            SELECT label FROM graph_nodes
            WHERE topic = :t AND kind IN ({placeholders})
              AND label IS NOT NULL AND label != ''
            ORDER BY created_at DESC LIMIT :n
            """,
            params,
        ))
    except Exception:
        return []
    seen: list[str] = []
    for r in rows:
        lbl = (r.get("label") or "").strip()
        if lbl and lbl not in seen:
            seen.append(lbl)
    return seen


def topic_context(topic: str, *, per_kind: int = 25) -> dict[str, Any]:
    """Gather the evidence bundle every strategy prompt is grounded in.

    Returns labels (not full posts) so prompts stay inside context:
        painpoints, feature_wishes, complaints, workarounds, competitors,
        products, interventions, plus corpus_size and source_mix.
    Pure read; an unbuilt graph yields empty lists, never an exception.
    """
    db = get_db()
    ctx: dict[str, Any] = {
        "topic": topic,
        "painpoints": _nodes_by_kinds(db, topic, ("painpoint",), per_kind),
        "feature_wishes": _nodes_by_kinds(db, topic, ("feature_wish",), per_kind),
        "complaints": _nodes_by_kinds(db, topic, ("complaint",), per_kind),
        "workarounds": _nodes_by_kinds(db, topic, ("workaround",), per_kind),
        "competitors": _nodes_by_kinds(db, topic, ("competitor", "product"), per_kind),
        "interventions": _nodes_by_kinds(db, topic, ("intervention",), per_kind),
        "corpus_size": 0,
        "source_mix": {},
    }

    # Corpus size + source mix (drives bottom-up sizing + confidence).
    try:
        if "topic_posts" in db.table_names():
            row = list(db.query(
                "SELECT COUNT(*) AS n FROM topic_posts WHERE topic = :t", {"t": topic}))
            ctx["corpus_size"] = int(row[0].get("n") or 0) if row else 0
            mix = list(db.query(
                """
                SELECT COALESCE(p.source_type, tp.source, 'unknown') AS src,
                       COUNT(*) AS n
                FROM topic_posts tp
                LEFT JOIN posts p ON p.id = tp.post_id
                WHERE tp.topic = :t
                GROUP BY src ORDER BY n DESC
                """,
                {"t": topic},
            ))
            ctx["source_mix"] = {(r.get("src") or "unknown"): int(r.get("n") or 0) for r in mix}
    except Exception:
        pass
    return ctx


def context_is_thin(ctx: dict[str, Any]) -> bool:
    """True when there's too little evidence to synthesise responsibly."""
    signal = (
        len(ctx.get("painpoints") or [])
        + len(ctx.get("feature_wishes") or [])
        + len(ctx.get("complaints") or [])
        + len(ctx.get("competitors") or [])
    )
    return signal < 3 and int(ctx.get("corpus_size") or 0) < 5


def context_brief(ctx: dict[str, Any], *, cap: int = 12) -> str:
    """Compact, prompt-ready rendering of the evidence bundle."""
    def _block(title: str, items: list[str]) -> str:
        items = [i for i in (items or []) if i][:cap]
        if not items:
            return ""
        body = "\n".join(f"- {i}" for i in items)
        return f"\n{title}:\n{body}"

    parts = [
        f"TOPIC: {ctx.get('topic', '')}",
        f"Corpus size: {ctx.get('corpus_size', 0)} posts.",
    ]
    mix = ctx.get("source_mix") or {}
    if mix:
        parts.append("Source mix: " + ", ".join(f"{k}={v}" for k, v in mix.items()))
    parts.append(_block("Top painpoints", ctx.get("painpoints")))
    parts.append(_block("Feature wishes", ctx.get("feature_wishes")))
    parts.append(_block("Complaints", ctx.get("complaints")))
    parts.append(_block("Workarounds users improvise", ctx.get("workarounds")))
    parts.append(_block("Competitors / existing products", ctx.get("competitors")))
    parts.append(_block("Candidate solutions (interventions)", ctx.get("interventions")))
    return "\n".join(p for p in parts if p)


__all__ = [
    "get_artifact", "put_artifact",
    "resolve_llm", "run_llm_json",
    "topic_context", "context_is_thin", "context_brief",
]
