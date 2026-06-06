"""Connect the dots — surface cross-paper connections that the literature
hasn't explicitly made yet, ranked by novelty.

This is the research differentiator: instead of summarising what papers say, it
finds *relations between them that aren't stated anywhere*. It blends signals
that are already computed elsewhere, so it never invents data:

  1. **Understudied intersections** & **contradictions** — from
     ``paper_gaps.list_gaps`` (an LLM pass already found theme A×B sparsity and
     opposing claims across the corpus).
  2. **Shared-but-uncited findings** — pairs of papers joined by a
     ``paper_shared_finding`` edge but with NO ``paper_cites`` edge between them:
     parallel discovery the authors never connected.
  3. (optional) an LLM "why is this new" pass over the top candidates to add a
     one-line rationale when the source signal didn't carry one.

Each connection carries a ``novelty_score`` (0..1) so the UI can rank. The
result persists to ``strategy_artifacts`` (kind ``connections``) so it caches
and is readable by the desktop tab + an MCP tool.

Pure-read ``connections_get`` never raises. ``connections_compute`` degrades
gracefully (empty list + reason) when there aren't enough papers.
"""
from __future__ import annotations

import json
from typing import Any

from ..core.db import get_db
from .strategy_common import get_artifact, put_artifact, run_llm_json

KIND = "connections"

# Per-connection-kind base novelty weight. Intersections/bridges are the most
# "nobody has looked here" kind; contradictions are tensions worth a paper;
# uncited parallel findings are real but slightly lower base novelty.
_KIND_WEIGHT = {
    "understudied_intersection": 0.92,
    "bridge": 0.90,
    "contradiction": 0.80,
    "shared_uncited": 0.72,
    "method_replication": 0.60,
}
_KIND_LABEL = {
    "understudied_intersection": "Understudied intersection",
    "bridge": "Bridge between clusters",
    "contradiction": "Contradiction to resolve",
    "shared_uncited": "Parallel finding (uncited)",
    "method_replication": "Under-replicated method",
}


# ── read ─────────────────────────────────────────────────────────────────────

def connections_get(topic: str) -> dict[str, Any]:
    """Pure read of the cached connections artifact. Never raises."""
    art = get_artifact(topic, KIND)
    if not art:
        return {"topic": topic, "kind": KIND, "computed": False, "data": {}}
    return {
        "topic": topic, "kind": KIND, "computed": True,
        "data": art["data"], "provider": art["provider"],
        "updated_at": art["updated_at"],
    }


# ── signal: LLM-derived cross-paper gaps ─────────────────────────────────────

def _from_paper_gaps(topic: str) -> list[dict[str, Any]]:
    """Lift understudied-intersection / contradiction / method-replication gaps
    into the unified connection shape. These already carry evidence + a score."""
    try:
        from .paper_gaps import list_gaps
        res = list_gaps(topic)
    except Exception:
        return []
    out: list[dict[str, Any]] = []
    for g in (res.get("gaps") or []):
        kind = g.get("kind") or "understudied_intersection"
        if kind not in _KIND_WEIGHT:
            continue
        detail = g.get("detail") if isinstance(g.get("detail"), dict) else {}
        why = (detail.get("why") or detail.get("detail") or "").strip()
        # list_gaps returns evidence as [{post_id, title}, ...]; tolerate plain
        # strings too in case the shape ever changes.
        ev_raw = g.get("evidence") or []
        if not isinstance(ev_raw, list):
            ev_raw = []
        ev_titles = [
            (e.get("title") or e.get("post_id") or "") if isinstance(e, dict) else str(e)
            for e in ev_raw
        ]
        ev_titles = [t for t in ev_titles if t]
        try:
            raw_score = float(g.get("score") or 0.5)
        except (TypeError, ValueError):
            raw_score = 0.5
        out.append({
            "kind": kind,
            "title": (g.get("title") or "").strip(),
            "why_new": why,
            "evidence": [str(t) for t in ev_titles][:8],
            "evidence_count": len(ev_titles),
            "novelty_score": round(_KIND_WEIGHT[kind] * (0.5 + 0.5 * max(0.0, min(1.0, raw_score))), 3),
        })
    return [o for o in out if o["title"]]


# ── signal: shared-but-uncited parallel findings ─────────────────────────────

def _paper_title(db, post_id: str) -> str:
    try:
        rows = list(db.query("SELECT title FROM posts WHERE id = ? LIMIT 1", [post_id]))
        if rows:
            return (rows[0].get("title") or post_id).strip()
    except Exception:
        pass
    return post_id


def _shared_uncited(topic: str, limit: int = 40) -> list[dict[str, Any]]:
    """Pairs joined by paper_shared_finding but with no paper_cites edge between
    them — two papers reached a parallel finding yet never cited each other."""
    db = get_db()
    if "graph_edges" not in db.table_names():
        return []
    try:
        shared = list(db.query(
            "SELECT src, dst, weight FROM graph_edges "
            "WHERE topic = ? AND kind = 'paper_shared_finding'",
            [topic],
        ))
    except Exception:
        return []
    if not shared:
        return []
    # Build a citation set (undirected) so we can subtract cited pairs.
    cited: set[tuple[str, str]] = set()
    try:
        for e in db.query(
            "SELECT src, dst FROM graph_edges WHERE topic = ? AND kind = 'paper_cites'",
            [topic],
        ):
            a, b = e.get("src"), e.get("dst")
            if a and b:
                cited.add((a, b)); cited.add((b, a))
    except Exception:
        pass

    seen: set[tuple[str, str]] = set()
    out: list[dict[str, Any]] = []
    for e in shared:
        a, b = e.get("src"), e.get("dst")
        if not a or not b or a == b:
            continue
        key = tuple(sorted((a, b)))
        if key in seen or (a, b) in cited:
            continue
        seen.add(key)
        ta, tb = _paper_title(db, a), _paper_title(db, b)
        try:
            w = float(e.get("weight") or 1.0)
        except (TypeError, ValueError):
            w = 1.0
        out.append({
            "kind": "shared_uncited",
            "title": f"Parallel finding — “{ta[:70]}” ↔ “{tb[:70]}” (neither cites the other)",
            "why_new": "Both papers reach a related finding but do not cite each other — a parallel discovery the literature hasn't connected.",
            "evidence": [ta, tb],
            "evidence_count": 2,
            "novelty_score": round(_KIND_WEIGHT["shared_uncited"] * (0.6 + 0.1 * min(4.0, w)) / 1.0, 3),
        })
        if len(out) >= limit:
            break
    # clamp scores to <=1
    for o in out:
        o["novelty_score"] = round(min(1.0, o["novelty_score"]), 3)
    return out


# ── optional LLM "why is this new" enrichment ────────────────────────────────

_SYSTEM = (
    "You are a research analyst who explains, in one tight sentence, WHY a "
    "proposed cross-paper connection is novel — i.e. why the existing literature "
    "hasn't already made it. Output strict JSON only, no markdown fences."
)
_PROMPT = (
    "For each candidate research connection below, write a one-sentence "
    "'why_new' explaining why this link appears unexplored. Return JSON: "
    '{{"items":[{{"title":"<verbatim title>","why_new":"<one sentence>"}}]}}.\n\n'
    "Candidates:\n{candidates}"
)


def _enrich_why_new(items: list[dict[str, Any]], provider: str | None) -> tuple[str, str]:
    """Fill empty why_new on the top items via one LLM call. Best-effort; returns
    (provider_name, model). Mutates ``items`` in place."""
    need = [it for it in items if not it.get("why_new")][:12]
    if not need:
        return "", ""
    cand = "\n".join(f"- {it['title']}" for it in need)
    parsed, name, model = run_llm_json(
        _PROMPT.format(candidates=cand), _SYSTEM, provider=provider,
        max_tokens=900, temperature=0.3,
    )
    if parsed and isinstance(parsed.get("items"), list):
        by_title = {str(x.get("title", "")).strip(): str(x.get("why_new", "")).strip()
                    for x in parsed["items"] if isinstance(x, dict)}
        for it in need:
            w = by_title.get(it["title"])
            if w:
                it["why_new"] = w
    return name, model


# ── compute ──────────────────────────────────────────────────────────────────

def connections_compute(topic: str, provider: str | None = None,
                        *, enrich: bool = True) -> dict[str, Any]:
    """Build, rank, and persist the topic's novel cross-paper connections.

    Combines LLM-derived paper gaps (understudied intersections / contradictions /
    under-replicated methods) with shared-but-uncited parallel findings. Never
    raises; returns ``computed: False`` with a reason when there's nothing to
    connect.
    """
    gaps = _from_paper_gaps(topic)
    uncited = _shared_uncited(topic)
    items = gaps + uncited

    if not items:
        return {
            "topic": topic, "kind": KIND, "computed": False,
            "reason": ("No connections yet — build the paper knowledge first "
                       "(collect academic papers, then run paper-gaps / "
                       "paper-relations-build for this topic)."),
        }

    # De-dup by (kind, title); keep the highest novelty.
    best: dict[tuple[str, str], dict[str, Any]] = {}
    for it in items:
        k = (it["kind"], it["title"].lower())
        if k not in best or it["novelty_score"] > best[k]["novelty_score"]:
            best[k] = it
    ranked = sorted(best.values(), key=lambda x: -x["novelty_score"])

    name, model = ("", "")
    if enrich:
        try:
            name, model = _enrich_why_new(ranked, provider)
        except Exception:
            name, model = "", ""

    # Add display labels + a by-kind tally.
    by_kind: dict[str, int] = {}
    for it in ranked:
        it["kind_label"] = _KIND_LABEL.get(it["kind"], it["kind"])
        by_kind[it["kind"]] = by_kind.get(it["kind"], 0) + 1

    data = {
        "connections": ranked,
        "total": len(ranked),
        "by_kind": by_kind,
    }
    art = put_artifact(topic, KIND, data, provider=name, model=model)
    return {
        "topic": topic, "kind": KIND, "computed": True,
        "data": data, "provider": name, "updated_at": art["updated_at"],
    }


__all__ = ["connections_get", "connections_compute", "KIND"]
