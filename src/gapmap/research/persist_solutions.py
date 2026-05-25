"""Persist why-data + papers + interventions to the graph.

Schema is loose (graph_nodes.kind is free-text), so we just upsert with
the new kinds: 'mechanism', 'intervention', 'evidence_paper'. Edges:
  painpoint --explained_by--> mechanism
  mechanism --addressed_by--> intervention
  intervention --supported_by--> evidence_paper
  painpoint --has_evidence--> evidence_paper
"""
from __future__ import annotations

import json
import re
from typing import Any

from ..core.db import get_db
from ..graph.build import _upsert_edge, _upsert_node
from ..graph.schema import make_node_id


def _slug(s: str) -> str:
    out = re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-")
    return out[:60] or "unnamed"


def persist_why_for_painpoint(
    topic: str,
    painpoint_id: str,
    why: dict[str, Any],
) -> None:
    """Merge `why` into the painpoint node's metadata_json under the 'why' key.

    Skips if `why` indicates parse error or no evidence — we don't want
    to overwrite a previous successful run with a failure.
    """
    if why.get("_skipped") or why.get("_parse_error"):
        return
    db = get_db()
    row = db["graph_nodes"].get(painpoint_id)
    if not row:
        return
    meta = {}
    try:
        meta = json.loads(row.get("metadata_json") or "{}") or {}
    except json.JSONDecodeError:
        meta = {}
    meta["why"] = why
    db["graph_nodes"].update(painpoint_id, {"metadata_json": json.dumps(meta)})


def persist_papers_for_painpoint(
    topic: str,
    painpoint_id: str,
    papers: list[dict[str, Any]],
) -> int:
    """Upsert evidence_paper nodes and link painpoint --has_evidence--> paper.
    Returns count of papers persisted."""
    if not papers:
        return 0
    db = get_db()
    n = 0
    for p in papers:
        pid = p.get("id")
        if not pid:
            continue
        node_id = _upsert_node(
            db, topic, "evidence_paper", _slug(pid), p.get("title") or pid,
            metadata={
                "source": p.get("source_type") or p.get("sub"),
                "tier": p.get("tier"),
                "url": p.get("url"),
                "author": p.get("author"),
                "year_ts": p.get("created_utc"),
                "abstract_excerpt": (p.get("selftext") or "")[:500],
                "external_id": pid,
            },
        )
        _upsert_edge(db, topic, painpoint_id, node_id, "has_evidence")
        n += 1
    return n


def persist_solutions_for_painpoint(
    topic: str,
    painpoint_id: str,
    solution: dict[str, Any],
) -> dict[str, int]:
    """Persist mechanism + interventions. Returns counts."""
    summary = {"mechanisms_added": 0, "interventions_added": 0, "supporting_edges": 0}
    if not solution or solution.get("_skipped") or solution.get("_parse_error"):
        return summary

    mechanism_text = (solution.get("mechanism") or "").strip()
    interventions = solution.get("interventions") or []
    if not mechanism_text or not interventions:
        return summary

    db = get_db()
    # The mechanism slug is keyed by painpoint to keep it scoped; same painpoint
    # rerun replaces the same mechanism node rather than spawning duplicates.
    mech_id = _upsert_node(
        db, topic, "mechanism",
        _slug(f"{painpoint_id}-mech"),
        mechanism_text,
        metadata={"painpoint_id": painpoint_id},
    )
    _upsert_edge(db, topic, painpoint_id, mech_id, "explained_by")
    summary["mechanisms_added"] = 1

    for iv in interventions:
        label = (iv.get("label") or "").strip()
        if not label:
            continue
        iv_id = _upsert_node(
            db, topic, "intervention", _slug(f"{painpoint_id}-{label}"), label,
            metadata={
                "confidence_tier": iv.get("confidence_tier"),
                "effort": iv.get("effort"),
                "rationale": iv.get("rationale"),
                "painpoint_id": painpoint_id,
            },
        )
        _upsert_edge(db, topic, mech_id, iv_id, "addressed_by")
        summary["interventions_added"] += 1
        for paper_ext_id in (iv.get("supporting_paper_ids") or []):
            paper_node_id = make_node_id(topic, "evidence_paper", _slug(paper_ext_id))
            if db["graph_nodes"].count_where("id = ?", [paper_node_id]) > 0:
                _upsert_edge(db, topic, iv_id, paper_node_id, "supported_by")
                summary["supporting_edges"] += 1
    return summary
