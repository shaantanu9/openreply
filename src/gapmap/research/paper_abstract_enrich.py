"""Abstract enrichment — backfill `posts.selftext` for title-only papers.

Many papers arrive with no abstract (PubMed search carries none; some OpenAlex /
Crossref / Scholar rows are metadata-only). Those papers can't be embedded
(no text → no chat, no relations). This module fetches the missing abstract for
a single paper by its source id and writes it back to `posts.selftext`, so the
downstream abstract-chunk path (`paper_chunks.chunk_paper_abstract`) can then
embed it and the whole library becomes chat-able + relatable.

Per-source single fetchers (added alongside this module):
  * pubmed         → ``sources.pubmed.fetch_abstract(pmid)``          (efetch)
  * openalex       → ``sources.openalex.fetch_work_abstract(wid)``    (/works/{id})
  * crossref       → ``sources.crossref.fetch_by_doi(doi)['selftext']``
  * scholar / s2   → ``sources.semantic_scholar.fetch_abstract(id)``

Network-bound + polite (each source fetcher spaces/retries). Idempotent: a paper
that already has an abstract is skipped.

Public API:
  * ``enrich_abstract(post_id)``                 → one paper
  * ``enrich_topic_abstracts(topic, ...)``       → batch over title-only papers
"""
from __future__ import annotations

import time
from typing import Any, Callable

from ..core.db import get_db

# Minimum chars to consider a paper "already has an abstract" — mirrors
# paper_chunks.MIN_CHUNK_CHARS so "enriched" means "now chunk-able".
_MIN_ABSTRACT = 200


def _split_id(post_id: str, prefix: str) -> str:
    """`pubmed_41996242` → `41996242` (strip the `<source>_` prefix)."""
    pid = post_id or ""
    return pid[len(prefix):] if pid.startswith(prefix) else pid


def _doi_from(post_id: str, url: str | None) -> str:
    """Best-effort DOI from a crossref id (`crossref_<doi>`) or a doi.org url."""
    if (post_id or "").startswith("crossref_"):
        return post_id[len("crossref_"):]
    u = url or ""
    for marker in ("doi.org/", "/doi/"):
        if marker in u:
            return u.split(marker, 1)[1].strip()
    return ""


def _fetch_for(source_type: str, post_id: str, url: str | None) -> str | None:
    """Dispatch to the right per-source single-abstract fetcher, then fall back
    to OpenAlex-by-DOI (best abstract coverage) for any paper that carries a DOI
    but whose home source returned nothing. Returns the abstract text or None."""
    s = (source_type or "").lower()
    text: str | None = None
    try:
        if s == "pubmed":
            from ..sources.pubmed import fetch_abstract
            text = fetch_abstract(_split_id(post_id, "pubmed_"))
        elif s == "openalex":
            from ..sources.openalex import fetch_work_abstract
            text = fetch_work_abstract(_split_id(post_id, "openalex_"))
        elif s == "crossref":
            from ..sources.crossref import fetch_by_doi
            row = fetch_by_doi(_split_id(post_id, "crossref_"))
            text = (row or {}).get("selftext") or None
        elif s in ("scholar", "semantic_scholar"):
            from ..sources.semantic_scholar import fetch_abstract
            pref = "scholar_" if s == "scholar" else "s2_"
            text = fetch_abstract(_split_id(post_id, pref))
    except Exception:
        text = None

    if text and len(text.strip()) >= _MIN_ABSTRACT:
        return text

    # Cross-source fallback: OpenAlex by DOI (covers Crossref/Scholar gaps).
    doi = _doi_from(post_id, url)
    if doi and s != "openalex":
        try:
            from ..sources.openalex import fetch_work_abstract_by_doi
            alt = fetch_work_abstract_by_doi(doi)
            if alt and len(alt.strip()) >= _MIN_ABSTRACT:
                return alt
        except Exception:
            pass
    return text


def enrich_abstract(post_id: str) -> dict[str, Any]:
    """Fetch + persist the abstract for one paper. Returns
    ``{ok, post_id, source, chars, status}`` where status ∈
    {enriched, already, no_abstract, unsupported, not_found}."""
    db = get_db()
    rows = list(db.query(
        "SELECT coalesce(source_type,'') AS s, coalesce(selftext,'') AS body, "
        "coalesce(url,'') AS url FROM posts WHERE id = ?",
        [post_id],
    ))
    if not rows:
        return {"ok": False, "post_id": post_id, "status": "not_found"}
    src, body, url = rows[0]["s"], rows[0]["body"], rows[0]["url"]
    if len(body.strip()) >= _MIN_ABSTRACT:
        return {"ok": True, "post_id": post_id, "source": src,
                "chars": len(body), "status": "already"}

    text = _fetch_for(src, post_id, url)
    if not text or len(text.strip()) < _MIN_ABSTRACT:
        # Distinguish "source we can't fetch" from "fetched but empty".
        status = "no_abstract" if src in (
            "pubmed", "openalex", "crossref", "scholar", "semantic_scholar"
        ) else "unsupported"
        return {"ok": True, "post_id": post_id, "source": src,
                "chars": 0, "status": status}

    db.execute("UPDATE posts SET selftext = ? WHERE id = ?", [text.strip(), post_id])
    return {"ok": True, "post_id": post_id, "source": src,
            "chars": len(text.strip()), "status": "enriched"}


# Sources we have a single-paper abstract fetcher for (the SQL pre-filter).
_ENRICHABLE = ("pubmed", "openalex", "crossref", "scholar", "semantic_scholar")


def enrich_topic_abstracts(
    topic: str | None = None,
    *,
    limit: int | None = None,
    chunk: bool = True,
    spacing: float = 0.2,
    progress: Callable[[str], None] | None = None,
) -> dict[str, Any]:
    """Backfill abstracts for every title-only academic paper (optionally
    topic-scoped), then (``chunk=True``) embed the freshly-enriched ones so they
    immediately become chat-able + relatable. Network-bound; ``spacing`` seconds
    between fetches keeps us polite. Returns aggregate counts."""
    db = get_db()
    ph = ",".join("?" for _ in _ENRICHABLE)
    sql = (
        f"SELECT DISTINCT p.id FROM posts p "
        f"WHERE coalesce(p.source_type,'') IN ({ph}) "
        f"AND length(coalesce(p.selftext,'')) < ? "
    )
    params: list[Any] = [*_ENRICHABLE, _MIN_ABSTRACT]
    if topic:
        sql += " AND p.id IN (SELECT post_id FROM topic_posts WHERE topic = ?) "
        params.append(topic)
    if limit:
        sql += " LIMIT ?"
        params.append(int(limit))
    targets = [r["id"] for r in db.query(sql, params)]

    out = {"ok": True, "topic": topic, "total": len(targets),
           "enriched": 0, "no_abstract": 0, "errors": 0, "chunked": 0}
    for i, pid in enumerate(targets):
        try:
            r = enrich_abstract(pid)
            if r.get("status") == "enriched":
                out["enriched"] += 1
                if chunk:
                    try:
                        from .paper_chunks import chunk_paper_abstract
                        cr = chunk_paper_abstract(pid, embed=True)
                        if cr.get("embedded"):
                            out["chunked"] += 1
                    except Exception:
                        pass
            else:
                out["no_abstract"] += 1
        except Exception:
            out["errors"] += 1
        if progress and (i % 25 == 0):
            progress(f"{i}/{len(targets)} · enriched={out['enriched']} chunked={out['chunked']}")
        if spacing:
            time.sleep(spacing)
    return out


__all__ = ["enrich_abstract", "enrich_topic_abstracts"]
