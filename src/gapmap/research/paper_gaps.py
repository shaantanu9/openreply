"""Detect literature *patterns* and *gaps* across a topic's academic papers.

This is the missing half of the paper pipeline: the corpus already gets
collected, full-texted, summarized, and related (paper_relations.py), but
nothing ever told the user *where the open problems are*. This module reads
the topic's papers + their LLM summaries and produces a ranked set of
research gaps — exactly the material a new paper positions itself against —
persisted into the (previously unused) ``paper_gaps`` table.

Four gap kinds (the four the user asked for):
  ``understudied_intersection`` — themes A and B are each well studied but
        their intersection is sparse/empty ("lots on X, lots on Y, little on
        X applied to Y"). The classic literature gap.
  ``contradiction``             — papers that make opposing claims on the same
        question — an unresolved debate to position against.
  ``temporal``                  — a sub-area active in the past but gone quiet,
        OR very recent with little follow-up. Computed deterministically from
        the publication-year histogram (no LLM needed).
  ``method_replication``        — findings asserted by very few papers, small
        samples, or never replicated — "needs more evidence" openings.

Design choices:
  * ONE consolidated LLM call over a compact corpus overview (title + year +
    one-line summary, capped to the top-N most-cited papers) yields the three
    reasoning-heavy kinds. Cheaper and more coherent than N per-paper calls,
    and it can see cross-paper structure the per-paper analyzer can't.
  * The ``temporal`` kind is fully deterministic so it works even with no LLM
    configured. ``detect_gaps`` therefore *always* returns something useful
    and never raises — same fail-soft contract as paper_fulltext/paper_analyze.
  * Evidence is cited by paper index in the prompt, mapped back to real
    ``post_id`` values so the UI can link each gap to its supporting papers.

Row shape written to ``paper_gaps``:
  id, topic, kind, title, detail_json, evidence_post_ids_json, score, created_at
"""
from __future__ import annotations

import hashlib
import json as _json
import re as _re
from collections import Counter
from datetime import datetime, timezone
from typing import Any, Callable

from ..core.db import get_db
from .paper_export import _papers_for_topic, _split_title_venue, _year
from .paper_analyze import get_analyses

ALL_KINDS = (
    "understudied_intersection",
    "contradiction",
    "temporal",
    "method_replication",
)

# How many papers (most-cited first) to feed the LLM overview. Keeps the
# prompt well inside context while still seeing the bulk of the signal.
_MAX_OVERVIEW_PAPERS = 60


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _gap_id(topic: str, kind: str, title: str) -> str:
    """Stable id so re-running upserts the same gap instead of duplicating."""
    h = hashlib.sha1(f"{topic}\x1f{kind}\x1f{title}".encode("utf-8")).hexdigest()
    return f"gap_{h[:16]}"


def _emit(progress_cb: Callable[[str, dict], None] | None, kind: str, info: dict) -> None:
    if not progress_cb:
        return
    try:
        progress_cb(kind, info)
    except Exception:  # a broken callback must never break detection
        pass


def _persist(topic: str, kind: str, title: str, detail: dict,
             evidence_ids: list[str], score: float) -> None:
    db = get_db()
    db["paper_gaps"].upsert(
        {
            "id": _gap_id(topic, kind, title),
            "topic": topic,
            "kind": kind,
            "title": title[:300],
            "detail_json": _json.dumps(detail, default=str, ensure_ascii=False),
            "evidence_post_ids_json": _json.dumps(evidence_ids[:20]),
            "score": float(score),
            "created_at": _now_iso(),
        },
        pk="id",
    )


# ── corpus overview ─────────────────────────────────────────────────────────

def _build_overview(topic: str, max_papers: int) -> list[dict[str, Any]]:
    """Top-cited academic papers for the topic, joined with their one-line
    LLM summary (when analyzed). Returns ``[{idx, id, title, year, cites,
    summary}]`` — the compact unit the detector reasons over."""
    papers = _papers_for_topic(topic, limit=max_papers)
    analyses = {a["post_id"]: a for a in get_analyses(topic)}
    overview: list[dict[str, Any]] = []
    for i, p in enumerate(papers, 1):
        title, _venue = _split_title_venue(p)
        a = analyses.get(p.get("id"))
        summary = ""
        if a:
            summary = (a.get("summary") or a.get("takeaway") or "").strip()
        if not summary:
            summary = (p.get("selftext") or "").strip()[:240]
        # _year() returns a string (or ""/None) — coerce to int for the
        # arithmetic in the temporal detector; None when not a 4-digit year.
        yr_raw = _year(p)
        try:
            year = int(str(yr_raw)[:4]) if yr_raw else None
        except (TypeError, ValueError):
            year = None
        overview.append({
            "idx": i,
            "id": p.get("id"),
            "title": title,
            "year": year,
            "cites": int(p.get("score") or 0),
            "summary": summary[:300],
        })
    return overview


# ── deterministic: temporal gaps ─────────────────────────────────────────────

def _detect_temporal(topic: str, overview: list[dict]) -> list[dict]:
    """Year-histogram based openings — fully deterministic.

    Two signals:
      * a year with a notable cluster of papers followed by ≥3 quiet years
        ("active then dormant" — revisit with modern methods)
      * the most recent year carrying only 1-2 papers despite an active field
        ("emerging, little follow-up").
    """
    years = [p["year"] for p in overview if p.get("year")]
    if len(years) < 5:
        return []
    by_year = Counter(years)
    span = sorted(by_year)
    latest = span[-1]
    gaps: list[dict] = []

    # Active-then-dormant: a peak year with ≥3 papers where the following 3
    # years total ≤1, and that peak isn't the most recent year.
    for y in span:
        if by_year[y] >= 3 and y <= latest - 3:
            after = sum(by_year.get(y + d, 0) for d in (1, 2, 3))
            if after <= 1:
                ev = [p["id"] for p in overview if p.get("year") == y][:10]
                gaps.append({
                    "title": f"Activity around {y} went quiet afterwards",
                    "detail": {
                        "peak_year": y, "peak_count": by_year[y],
                        "papers_in_following_3y": after,
                        "why": f"{by_year[y]} papers in {y} but only {after} in {y+1}-{y+3} — "
                               "a line of work that stalled and may be ripe to revisit with current methods/data.",
                    },
                    "evidence": ev,
                    "score": round(min(1.0, by_year[y] / 10.0 + 0.4), 3),
                })

    # Emerging-thin: latest year present but thin relative to the field.
    if by_year.get(latest, 0) <= 2 and sum(by_year.values()) >= 8:
        ev = [p["id"] for p in overview if p.get("year") == latest][:10]
        gaps.append({
            "title": f"Very recent ({latest}) work is thin — little follow-up yet",
            "detail": {
                "latest_year": latest, "latest_count": by_year.get(latest, 0),
                "why": "The newest sub-direction has few papers — an opening to be early with systematic follow-up.",
            },
            "evidence": ev,
            "score": 0.55,
        })
    return gaps[:6]


# ── LLM: intersections / contradictions / method gaps ────────────────────────

_SYSTEM = (
    "You are a research librarian who finds the OPEN PROBLEMS in a body of "
    "literature so a researcher can position a new paper. You only use the "
    "papers given. Return strict JSON, no prose."
)


def _build_prompt(topic: str, overview: list[dict]) -> str:
    lines = [
        f'Topic: "{topic}"',
        "",
        "PAPERS (index | year | citations | title — one-line summary):",
    ]
    for p in overview:
        yr = p.get("year") or "?"
        lines.append(
            f'[{p["idx"]}] ({yr}, {p.get("cites", 0)} cites) {p["title"]}'
            + (f" — {p['summary']}" if p.get("summary") else "")
        )
    lines += [
        "",
        "Identify research GAPS strictly from these papers. Return JSON:",
        "{",
        '  "understudied_intersections": [',
        '    {"title": "<short gap name>", "detail": "<2-3 sentences: which two well-studied '
        'themes rarely meet here, and why their intersection matters>", "evidence": [<paper indices that '
        'establish each side>], "score": <0..1 how promising>}',
        "  ],",
        '  "contradictions": [',
        '    {"title": "<the disputed question>", "detail": "<2-3 sentences naming the opposing claims and who '
        'makes them>", "evidence": [<indices on each side>], "score": <0..1>}',
        "  ],",
        '  "method_replication": [',
        '    {"title": "<finding that needs more evidence>", "detail": "<2-3 sentences: asserted by how few '
        'papers / small samples / never replicated>", "evidence": [<indices>], "score": <0..1>}',
        "  ]",
        "}",
        "",
        "Rules: 2-5 items per array (fewer if the literature genuinely lacks them; "
        "empty array is allowed). Every item MUST cite real paper indices from the list "
        "above. Be specific to THIS topic — no generic 'more research is needed'.",
    ]
    return "\n".join(lines)


def _parse_json(raw: str) -> dict | None:
    text = (raw or "").strip()
    for attempt in (
        lambda: _json.loads(text),
        lambda: _json.loads(text.strip("`").lstrip("json").strip()),
        lambda: (_json.loads(_re.search(r"\{.*\}", text, _re.DOTALL).group(0))
                 if _re.search(r"\{.*\}", text, _re.DOTALL) else None),
    ):
        try:
            parsed = attempt()
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            continue
    return None


def _idx_to_ids(indices: Any, overview: list[dict]) -> list[str]:
    by_idx = {p["idx"]: p["id"] for p in overview}
    out: list[str] = []
    if isinstance(indices, list):
        for n in indices:
            try:
                pid = by_idx.get(int(n))
            except (TypeError, ValueError):
                pid = None
            if pid and pid not in out:
                out.append(pid)
    return out


def _detect_llm(topic: str, overview: list[dict], provider: str | None) -> dict[str, list[dict]]:
    """Run the consolidated LLM gap pass. Returns {kind: [gap, ...]} for the
    three reasoning kinds, or {} when no LLM is configured / the call fails."""
    try:
        from ..analyze.providers.base import resolve_provider, get_provider
        resolve_provider(provider)  # raises when nothing configured
        provider_obj = get_provider()
    except Exception:
        return {}

    prompt = _build_prompt(topic, overview)
    try:
        raw = provider_obj.complete(
            prompt=prompt, system=_SYSTEM, max_tokens=1600, temperature=0.3,
        )
    except Exception:
        return {}

    parsed = _parse_json(raw)
    if not parsed:
        return {}

    mapping = {
        "understudied_intersections": "understudied_intersection",
        "contradictions": "contradiction",
        "method_replication": "method_replication",
    }
    out: dict[str, list[dict]] = {}
    for json_key, kind in mapping.items():
        items = parsed.get(json_key)
        if not isinstance(items, list):
            continue
        kept: list[dict] = []
        for it in items:
            if not isinstance(it, dict):
                continue
            title = str(it.get("title") or "").strip()
            if not title:
                continue
            ev = _idx_to_ids(it.get("evidence"), overview)
            if not ev:
                continue  # an evidence-less gap is just an opinion — drop it
            try:
                score = float(it.get("score") or 0.5)
            except (TypeError, ValueError):
                score = 0.5
            kept.append({
                "title": title,
                "detail": {"why": str(it.get("detail") or "").strip()},
                "evidence": ev,
                "score": max(0.0, min(1.0, score)),
            })
        out[kind] = kept
    return out


# ── public API ────────────────────────────────────────────────────────────

def detect_gaps(
    topic: str,
    *,
    provider: str | None = None,
    max_papers: int = _MAX_OVERVIEW_PAPERS,
    force: bool = False,
    progress_cb: Callable[[str, dict], None] | None = None,
) -> dict[str, Any]:
    """Detect + persist research gaps for ``topic``. Never raises.

    Returns ``{ok, topic, papers, by_kind:{kind:n}, llm_used, gaps:[...]}``.
    ``force`` clears existing gaps for the topic first (otherwise upserts).
    """
    db = get_db()
    overview = _build_overview(topic, max_papers)
    _emit(progress_cb, "gaps:start", {"papers": len(overview)})

    if len(overview) < 3:
        return {"ok": True, "topic": topic, "papers": len(overview),
                "by_kind": {}, "llm_used": False, "gaps": [],
                "reason": "need at least 3 academic papers to detect gaps — collect papers first"}

    if force:
        try:
            db.execute("DELETE FROM paper_gaps WHERE topic = ?", [topic])
        except Exception:
            pass

    # Deterministic temporal first (always runs).
    temporal = _detect_temporal(topic, overview)
    # LLM pass for the three reasoning kinds (graceful empty when no LLM).
    _emit(progress_cb, "gaps:llm", {"status": "analyzing corpus for gaps…"})
    llm = _detect_llm(topic, overview, provider)

    all_by_kind: dict[str, list[dict]] = {"temporal": temporal, **llm}
    persisted: list[dict] = []
    by_kind: dict[str, int] = {}
    for kind, items in all_by_kind.items():
        for g in items:
            _persist(topic, kind, g["title"], g["detail"], g["evidence"], g["score"])
            by_kind[kind] = by_kind.get(kind, 0) + 1
            persisted.append({"kind": kind, **g})
        _emit(progress_cb, "gaps:kind", {"kind": kind, "count": by_kind.get(kind, 0)})

    persisted.sort(key=lambda g: g.get("score", 0), reverse=True)
    return {
        "ok": True,
        "topic": topic,
        "papers": len(overview),
        "by_kind": by_kind,
        "llm_used": bool(llm),
        "gaps": persisted,
    }


def list_gaps(topic: str) -> dict[str, Any]:
    """Read persisted gaps for a topic, newest-scored first, with evidence
    paper titles resolved for display."""
    db = get_db()
    try:
        rows = list(db.query(
            "SELECT id, kind, title, detail_json, evidence_post_ids_json, score, created_at "
            "FROM paper_gaps WHERE topic = ? ORDER BY score DESC", [topic],
        ))
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "topic": topic, "error": str(e), "gaps": []}

    # Resolve evidence post_ids → titles in one pass.
    all_ids: set[str] = set()
    parsed_rows: list[dict] = []
    for r in rows:
        try:
            ev = _json.loads(r.get("evidence_post_ids_json") or "[]")
        except Exception:
            ev = []
        try:
            detail = _json.loads(r.get("detail_json") or "{}")
        except Exception:
            detail = {}
        all_ids.update(ev)
        parsed_rows.append({**r, "_evidence_ids": ev, "_detail": detail})

    titles: dict[str, str] = {}
    if all_ids:
        qs = ",".join("?" for _ in all_ids)
        for r in db.query(f"SELECT id, title FROM posts WHERE id IN ({qs})", list(all_ids)):
            titles[r["id"]] = (r.get("title") or "")[:200]

    gaps = []
    for r in parsed_rows:
        gaps.append({
            "id": r["id"],
            "kind": r["kind"],
            "title": r["title"],
            "detail": r["_detail"],
            "score": r.get("score"),
            "evidence": [{"post_id": pid, "title": titles.get(pid, pid)}
                         for pid in r["_evidence_ids"]],
        })
    by_kind: dict[str, int] = {}
    for g in gaps:
        by_kind[g["kind"]] = by_kind.get(g["kind"], 0) + 1
    return {"ok": True, "topic": topic, "by_kind": by_kind, "gaps": gaps}


__all__ = ["detect_gaps", "list_gaps", "ALL_KINDS"]
