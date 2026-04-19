"""Paper fetching per painpoint.

For each painpoint we call PubMed + Semantic Scholar + OpenAlex with a
query built from `painpoint_label + jtbd.desired_outcome`. Results are
deduped by normalized title. Each paper is annotated with a coarse
evidence tier (peer-reviewed for journal sources, anecdote otherwise).

No LLM here — this is pure fetch + dedupe.
"""
from __future__ import annotations

import re
from typing import Any

from ..sources.openalex import fetch_openalex
from ..sources.pubmed import fetch_pubmed
from ..sources.scholar import fetch_scholar


def _normalize_title(t: str) -> str:
    return re.sub(r"\W+", "", (t or "").lower())


def _tier_for(source_type: str) -> str:
    # MVP: coarse tiering. Anything from a literature DB is peer-reviewed.
    # Replication-status and meta-analysis detection is post-MVP.
    if source_type in ("pubmed", "scholar", "openalex"):
        return "peer-reviewed"
    return "anecdote"


def _build_query(painpoint_label: str, jtbd_desired_outcome: str) -> str:
    parts = [s.strip() for s in (painpoint_label, jtbd_desired_outcome) if s and s.strip()]
    return " ".join(parts).strip()


def _safe_fetch(fn, query: str, limit: int) -> list[dict]:
    try:
        return fn(query, limit=limit) or []
    except Exception:  # noqa: BLE001 — never let one source kill the loop
        return []


def fetch_science_for_painpoint(
    painpoint_label: str,
    jtbd_desired_outcome: str,
    limit: int = 5,
) -> list[dict[str, Any]]:
    """Return up to `limit` papers, deduped by title, tier-tagged."""
    query = _build_query(painpoint_label, jtbd_desired_outcome)
    if not query:
        return []

    raw: list[dict] = []
    raw += _safe_fetch(fetch_pubmed, query, limit=limit * 2)
    raw += _safe_fetch(fetch_scholar, query, limit=limit * 2)
    raw += _safe_fetch(fetch_openalex, query, limit=limit * 2)

    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for p in raw:
        key = _normalize_title(p.get("title") or "")
        if not key or key in seen:
            continue
        seen.add(key)
        p_copy = dict(p)
        p_copy["tier"] = _tier_for(p.get("source_type") or p.get("sub") or "")
        out.append(p_copy)
        if len(out) >= limit:
            break
    return out
