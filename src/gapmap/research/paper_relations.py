"""Materialize paper->paper edges into graph_edges (academic nodes only).
Phase 1 kinds: `relates_to` (semantic neighbors) and `cites` (resolved
references). Each src capped to top-N to avoid hairballs."""
from __future__ import annotations
import json, os
from typing import Any

from ..core.db import get_db
from .sources import is_academic_source

_TOPN = int(os.getenv("PAPER_RELATES_TOPN") or 8)

# Academic source_types treated as "papers" for the map node query (mirrors
# research/sources.py::is_academic_source, inlined here for the SQL IN clause).
_ACADEMIC = ("arxiv", "pubmed", "openalex", "scholar", "semantic_scholar", "crossref", "europepmc")

def _academic_paper_ids(topic: str | None) -> list[str]:
    db = get_db()
    if topic:
        rows = db.query(
            "SELECT p.id AS id, coalesce(p.source_type,'reddit') AS s "
            "FROM topic_posts tp JOIN posts p ON p.id = tp.post_id WHERE tp.topic = ?",
            [topic])
    else:
        rows = db.query("SELECT id, coalesce(source_type,'reddit') AS s FROM posts")
    return [r["id"] for r in rows if is_academic_source(r["s"])]

def _upsert_edge(db, src: str, dst: str, kind: str, topic: str | None, weight: float, meta: dict):
    db["graph_edges"].upsert(
        {"src": src, "dst": dst, "kind": kind, "topic": topic or "",
         "weight": float(weight), "metadata_json": json.dumps(meta)},
        pk=("src", "dst", "kind"))

# Placeholder / non-author strings that must NEVER be used as a same-author
# key — otherwise every paper with a missing author (e.g. 169 papers all
# stamped "[unknown]") gets linked to every other, producing a 14k-edge
# hairball that swamps the map.
_AUTHOR_PLACEHOLDERS = {
    "[unknown]", "unknown", "[deleted]", "deleted", "anonymous", "anon",
    "n/a", "na", "none", "null", "et al", "et al.", "author", "authors",
}


def _norm_author(a: str | None) -> str:
    """First author lowercased — cheap key for same-author edges. Ignores
    initials / very short tokens and placeholder strings to avoid spurious
    links."""
    if not a:
        return ""
    first = str(a).split(",")[0].split(";")[0].split(" and ")[0].strip().lower()
    if first in _AUTHOR_PLACEHOLDERS:
        return ""
    return first if len(first) >= 4 else ""


# All four edge kinds the map can show. relates_to + cites are the original
# Phase-1 builders; shared_finding + same_author were added for the paper map.
ALL_KINDS = ["relates_to", "cites", "shared_finding", "same_author"]


def build(topic: str | None = None, *, kinds: list[str] | None = None,
          force: bool = False) -> dict[str, Any]:
    kinds = kinds or list(ALL_KINDS)
    db = get_db()
    ids = set(_academic_paper_ids(topic))
    made = {"relates_to": 0, "cites": 0, "shared_finding": 0, "same_author": 0}

    if "cites" in kinds:
        from .paper_references import get_references
        for pid in ids:
            for ref in get_references(pid):
                dst = ref.get("dst_post_id") or ""
                if ref.get("resolution_status") == "ok" and dst and dst in ids:
                    # Distinct edge kind — `cites`/`relates_to` are already used
                    # by the dense-graph-relations system for painpoint/feature/
                    # concept NODES. Namespacing as `paper_*` keeps the paper
                    # citation graph unambiguous and queryable on its own.
                    _upsert_edge(db, pid, dst, "paper_cites", topic, 1.0,
                                 {"via": ref.get("extractor", "")})
                    made["cites"] += 1

    if "relates_to" in kinds:
        from ..retrieval import palace
        if palace.is_available():
            for pid in ids:
                # NB: query neighbors WITHOUT the topic filter. Each chunk stores
                # a single `topic` (whatever was active at chunk-time), so a paper
                # tagged to several topics is embedded under only one. Filtering
                # neighbors by `topic` here drops every paper chunked under a
                # different topic and collapses relates_to to ~0. The `dst in ids`
                # guard below already scopes the result to this topic's papers.
                nb = palace.paper_neighbors(pid, k=_TOPN, topic=None)
                for r in nb.get("results", []):
                    dst = r["post_id"]
                    if dst in ids:
                        _upsert_edge(db, pid, dst, "paper_relates_to", topic,
                                     r["score"], {"score": r["score"]})
                        made["relates_to"] += 1

    # shared_finding — two papers that back the SAME gap-map finding. Topic-
    # scoped (finding_research_links is per-topic); skipped when no topic.
    if "shared_finding" in kinds and topic and "finding_research_links" in db.table_names():
        by_finding: dict[str, list[tuple[str, float]]] = {}
        for r in db.query(
            "SELECT finding_id, paper_post_id, similarity FROM finding_research_links "
            "WHERE topic = ?", [topic],
        ):
            pid = r["paper_post_id"]
            if pid in ids:
                by_finding.setdefault(r["finding_id"], []).append(
                    (pid, float(r.get("similarity") or 0.0)))
        for members in by_finding.values():
            members = sorted(members, key=lambda x: x[1], reverse=True)[:_TOPN]
            for i in range(len(members)):
                for j in range(i + 1, len(members)):
                    w = (members[i][1] + members[j][1]) / 2.0 or 0.5
                    _upsert_edge(db, members[i][0], members[j][0],
                                 "paper_shared_finding", topic, w, {})
                    made["shared_finding"] += 1

    # same_author — papers sharing a (first) author. Cheap SQL over the node set.
    if "same_author" in kinds and ids:
        qmarks = ",".join("?" for _ in ids)
        groups: dict[str, list[str]] = {}
        for r in db.query(
            f"SELECT id, coalesce(author,'') AS a FROM posts WHERE id IN ({qmarks})",
            list(ids),
        ):
            ak = _norm_author(r["a"])
            if ak:
                groups.setdefault(ak, []).append(r["id"])
        for members in groups.values():
            if len(members) < 2:
                continue
            for i in range(len(members)):
                for j in range(i + 1, len(members)):
                    _upsert_edge(db, members[i], members[j], "paper_same_author",
                                 topic, 1.0, {})
                    made["same_author"] += 1

    return {"ok": True, "topic": topic, "papers": len(ids), "edges": made}


# Edge kind → friendly label the UI legend uses.
_KIND_LABELS = {
    "paper_relates_to": "semantic",
    "paper_cites": "cites",
    "paper_shared_finding": "shared finding",
    "paper_same_author": "same author",
}


def get_paper_map(topic: str, *, max_papers: int = 200,
                  rebuild: bool = False) -> dict[str, Any]:
    """Return the topic's paper graph as D3 force-graph JSON:
    ``{ok, topic, nodes:[{id,label,source,year,cites,author,has_fulltext}],
       edges:[{src,dst,kind,weight}], stats:{...}}``.

    Lazily materializes edges (``build``) when none exist yet or ``rebuild`` is
    set, so the first open of the map "just works". Pure read otherwise.
    """
    db = get_db()
    placeholders = ",".join("?" for _ in _ACADEMIC)
    try:
        rows = list(db.query(
            f"""
            SELECT p.id, p.title, p.author, p.source_type, p.created_utc,
                   coalesce(p.score,0) AS cites,
                   (SELECT 1 FROM paper_full_texts f WHERE f.post_id = p.id LIMIT 1) AS has_ft,
                   (SELECT 1 FROM paper_chunks c WHERE c.post_id = p.id LIMIT 1) AS has_chunks
            FROM topic_posts tp JOIN posts p ON p.id = tp.post_id
            WHERE tp.topic = ? AND coalesce(p.source_type,'') IN ({placeholders})
            -- Node priority: chunked papers FIRST, then full-text, then by
            -- citation. Only chunked/embedded papers carry semantic
            -- (relates_to) edges, so ranking by citation count alone buried
            -- every recent, low-cited-but-embedded paper below the LIMIT and
            -- the map showed disconnected, relation-less nodes. has_chunks DESC
            -- guarantees the connected papers make the cut.
            ORDER BY has_chunks DESC, has_ft DESC, cites DESC LIMIT ?
            """,
            [topic, *_ACADEMIC, max_papers],
        ))
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "reason": f"node query failed: {e}", "nodes": [], "edges": []}

    if not rows:
        return {"ok": True, "topic": topic, "nodes": [], "edges": [],
                "stats": {"papers": 0, "reason": "no academic papers tagged to topic — collect papers first"}}

    id_set = {r["id"] for r in rows}
    nodes = [{
        "id": r["id"],
        "label": (r.get("title") or "[untitled]")[:160],
        "source": r.get("source_type") or "",
        "year": _year_of(r.get("created_utc")),
        "cites": int(r.get("cites") or 0),
        "author": (r.get("author") or "")[:120],
        "has_fulltext": bool(r.get("has_ft")),
    } for r in rows]

    def _read_edges() -> list[dict[str, Any]]:
        out = []
        for e in db.query(
            "SELECT src, dst, kind, weight FROM graph_edges "
            "WHERE kind IN ('paper_relates_to','paper_cites','paper_shared_finding','paper_same_author') "
            "AND (topic = ? OR coalesce(topic,'') = '')", [topic],
        ):
            if e["src"] in id_set and e["dst"] in id_set:
                out.append({
                    "src": e["src"], "dst": e["dst"],
                    "kind": _KIND_LABELS.get(e["kind"], e["kind"]),
                    "weight": round(float(e.get("weight") or 1.0), 4),
                })
        return out

    edges = _read_edges()
    if rebuild or not edges:
        try:
            build(topic=topic, kinds=list(ALL_KINDS))
            edges = _read_edges()
        except Exception:  # noqa: BLE001
            pass  # show nodes even if edge build hiccups

    by_kind: dict[str, int] = {}
    for e in edges:
        by_kind[e["kind"]] = by_kind.get(e["kind"], 0) + 1
    return {
        "ok": True, "topic": topic, "nodes": nodes, "edges": edges,
        "stats": {"papers": len(nodes), "edges": len(edges), "by_kind": by_kind},
    }


def _year_of(ts_sec: Any) -> int | None:
    try:
        import datetime as _dt
        return _dt.datetime.utcfromtimestamp(int(ts_sec)).year if ts_sec else None
    except Exception:  # noqa: BLE001
        return None
