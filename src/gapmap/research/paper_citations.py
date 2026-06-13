"""Citation edges (`paper_cites`) from the Semantic Scholar references API.

The PDF-based reference extractor (``paper_references.extract_references_for``)
only works on the ~few-percent of papers with open-access full text. This module
builds citation edges for the *whole* corpus instead: for each paper it asks S2
for the paper's reference list (lightweight external-id rows), matches each
reference against the in-corpus papers by DOI / arXiv id / PMID, and writes the
matches as resolved ``paper_references`` rows. ``paper_relations.build(kinds=
['cites'])`` then materializes the ``paper_cites`` edges the paper map shows.

Resolution is exact-id only (DOI / arXiv / PMID) — no fuzzy title matching — so
every edge is a real, verifiable citation between two papers we hold.

Network-bound and rate-limited: S2's unauthenticated quota is small, so set
``S2_API_KEY`` for any sizeable run and keep ``limit`` modest. Idempotent: a
paper's S2-derived rows are replaced on each run.

Public API:
  * ``build_citations(topic, *, limit=None, spacing=1.1)`` → counts + edge build
"""
from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any, Callable

from ..core.db import get_db
from .sources import is_academic_source

_ACADEMIC = ("arxiv", "pubmed", "openalex", "scholar",
             "semantic_scholar", "crossref", "europepmc")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _base_arxiv(aid: str) -> str:
    """`2401.12086v2` → `2401.12086` (version-stripped, lowercased)."""
    a = (aid or "").strip().lower()
    if a.startswith("arxiv:"):
        a = a[6:]
    return a.split("v")[0] if ("v" in a and a.split("v")[-1].isdigit()) else a


def _topic_paper_ids(topic: str | None) -> list[str]:
    db = get_db()
    if topic:
        rows = db.query(
            "SELECT p.id AS id, coalesce(p.source_type,'') AS s, coalesce(p.url,'') AS url "
            "FROM topic_posts tp JOIN posts p ON p.id = tp.post_id WHERE tp.topic = ?",
            [topic])
    else:
        rows = db.query("SELECT id, coalesce(source_type,'') AS s, coalesce(url,'') AS url FROM posts")
    return [r["id"] for r in rows if is_academic_source(r["s"])]


def _corpus_index(ids: list[str]) -> tuple[dict, dict, dict]:
    """Build (doi→pid, arxiv_base→pid, pmid→pid) lookup maps over the paper set
    so an S2 reference's external ids can be matched to an in-corpus paper."""
    db = get_db()
    doi2pid: dict[str, str] = {}
    arxiv2pid: dict[str, str] = {}
    pmid2pid: dict[str, str] = {}
    id_set = set(ids)
    qmarks = ",".join("?" for _ in ids)
    for r in db.query(
        f"SELECT id, coalesce(url,'') AS url FROM posts WHERE id IN ({qmarks})", list(ids),
    ):
        pid = r["id"]
        if pid not in id_set:
            continue
        if pid.startswith("arxiv_"):
            arxiv2pid[_base_arxiv(pid[len("arxiv_"):])] = pid
        elif pid.startswith("pubmed_"):
            pmid2pid[pid[len("pubmed_"):]] = pid
        elif pid.startswith("crossref_"):
            doi2pid[pid[len("crossref_"):].lower()] = pid
        # Any paper whose url carries a DOI is also reachable by DOI.
        url = (r["url"] or "").lower()
        for marker in ("doi.org/", "/doi/"):
            if marker in url:
                doi2pid.setdefault(url.split(marker, 1)[1].strip(), pid)
                break
    return doi2pid, arxiv2pid, pmid2pid


def _s2_id_for(post_id: str, url: str) -> str | None:
    """The id to query S2 with for a corpus paper (DOI / arXiv / PMID / S2)."""
    if post_id.startswith("arxiv_"):
        return f"ARXIV:{_base_arxiv(post_id[len('arxiv_'):])}"
    if post_id.startswith("pubmed_"):
        return f"PMID:{post_id[len('pubmed_'):]}"
    if post_id.startswith("crossref_"):
        return post_id[len("crossref_"):]
    if post_id.startswith("scholar_"):
        return post_id[len("scholar_"):]
    if post_id.startswith("s2_"):
        return post_id[len("s2_"):]
    # openalex / others: fall back to a DOI in the url if present.
    u = (url or "").lower()
    for marker in ("doi.org/", "/doi/"):
        if marker in u:
            return u.split(marker, 1)[1].strip()
    return None


def build_citations(
    topic: str | None = None,
    *,
    limit: int | None = None,
    spacing: float = 1.1,
    progress: Callable[[str], None] | None = None,
) -> dict[str, Any]:
    """For every paper in ``topic`` (most-cited first), fetch its S2 reference
    list, match references to in-corpus papers by exact id, and persist the
    matches as resolved ``paper_references`` rows. Then build ``paper_cites``
    edges. Returns aggregate counts."""
    from ..sources.semantic_scholar import fetch_reference_ids
    db = get_db()
    ids = _topic_paper_ids(topic)
    if not ids:
        return {"ok": True, "topic": topic, "papers": 0, "edges": 0,
                "reason": "no academic papers"}
    doi2pid, arxiv2pid, pmid2pid = _corpus_index(ids)
    id_set = set(ids)

    # Process most-cited papers first (score = citation count) — they have the
    # richest reference lists — BUT only papers we can actually query S2 with
    # (arXiv / PMID / DOI / S2 id). OpenAlex papers are often the most-cited yet
    # carry no S2-queryable id (their url is the openalex.org work url, no DOI),
    # so without this filter the whole `limit` is spent skipping them.
    qmarks = ",".join("?" for _ in ids)
    url_of = {r["id"]: (r["url"] or "") for r in db.query(
        f"SELECT id, coalesce(url,'') url FROM posts WHERE id IN ({qmarks})", list(ids),
    )}
    ordered = [
        r["id"] for r in db.query(
            f"SELECT id FROM posts WHERE id IN ({qmarks}) ORDER BY coalesce(score,0) DESC",
            list(ids),
        )
        if _s2_id_for(r["id"], url_of.get(r["id"], "")) is not None
    ]
    out_skipped_no_id = len(ids) - len(ordered)
    if limit:
        ordered = ordered[:int(limit)]

    out = {"ok": True, "topic": topic, "papers": len(ordered),
           "skipped_no_s2_id": out_skipped_no_id,
           "fetched": 0, "no_refs": 0, "links": 0, "errors": 0}
    now = _now_iso()
    for i, pid in enumerate(ordered):
        s2id = _s2_id_for(pid, url_of.get(pid, ""))
        if not s2id:
            continue
        try:
            refs = fetch_reference_ids(s2id, limit=200)
        except Exception:
            out["errors"] += 1
            refs = None
        if refs is None:
            out["errors"] += 1
        else:
            out["fetched"] += 1
            if not refs:
                out["no_refs"] += 1
            matched: list[dict] = []
            seen_dst: set[str] = set()
            for ref in refs:
                dst = None
                if ref.get("doi") and ref["doi"] in doi2pid:
                    dst = doi2pid[ref["doi"]]
                elif ref.get("arxiv") and _base_arxiv(ref["arxiv"]) in arxiv2pid:
                    dst = arxiv2pid[_base_arxiv(ref["arxiv"])]
                elif ref.get("pmid") and ref["pmid"] in pmid2pid:
                    dst = pmid2pid[ref["pmid"]]
                if dst and dst != pid and dst in id_set and dst not in seen_dst:
                    seen_dst.add(dst)
                    matched.append({
                        "src_post_id": pid, "dst_post_id": dst,
                        "dst_doi": ref.get("doi", ""), "dst_arxiv_id": ref.get("arxiv", ""),
                        "dst_title": (ref.get("title") or "")[:300],
                        "dst_year": int(ref.get("year") or 0), "dst_authors_json": "",
                        "raw": f"S2 reference → {dst}", "resolution_status": "ok",
                        "extractor": "s2_api", "fetched_at": now,
                    })
            if matched:
                # Idempotent: replace this paper's prior S2-derived rows.
                db.execute(
                    "DELETE FROM paper_references WHERE src_post_id = ? AND extractor = 's2_api'",
                    [pid])
                db["paper_references"].insert_all(matched, alter=True)
                out["links"] += len(matched)
        if progress and (i % 20 == 0):
            progress(f"{i}/{len(ordered)} · fetched={out['fetched']} links={out['links']}")
        if spacing:
            time.sleep(spacing)

    # Materialize the paper_cites edges from the freshly-resolved references.
    try:
        from . import paper_relations
        b = paper_relations.build(topic=topic, kinds=["cites"])
        out["edges"] = b.get("edges", {}).get("cites", 0)
    except Exception as e:
        out["edges"] = 0
        out["edge_build_error"] = str(e)[:200]
    return out


__all__ = ["build_citations"]
