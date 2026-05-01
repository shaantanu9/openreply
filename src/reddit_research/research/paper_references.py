"""Citation extraction from cached paper full text.

Two phases:

  1. Extract — pull the References section text (or, when section
     parsing failed, the trailing 15% of the cache file) and split it
     into individual reference lines. Try OpenFileLoader first when
     installed; fall back to regex.
  2. Resolve — for each reference, try in order: explicit DOI →
     Crossref; arxiv id → derive arxiv_<id> post; title-only →
     OpenAlex search; nothing matches → leave as ``unresolved``.

Persisted into ``paper_references``. The graph layer can later promote
these into ``cites`` edges via a small wrapper.

Failure mode: every public function returns a structured result and
NEVER raises. A parser that explodes on a single PDF must not abort
the rest of the topic.
"""
from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from typing import Any

from ..core.db import get_db
from .paper_fulltext import _cache_path
from .paper_sections import get_sections, get_section_text

# Regex toolkit. Conservative — we'd rather miss a few citations than
# pollute the graph with parser errors.
_DOI_RE = re.compile(r"\b10\.[0-9]{4,9}/[^\s\"<>]+", re.IGNORECASE)
_ARXIV_ID_RE = re.compile(
    r"\barXiv[:\s]*([0-9]{4}\.[0-9]{4,5}(?:v[0-9]+)?)\b",
    re.IGNORECASE,
)
_YEAR_RE = re.compile(r"\b(19[5-9][0-9]|20[0-4][0-9])\b")
_REF_LINE_SPLIT = re.compile(
    r"""
    (?:                                        # numbered references like
        ^[ \t]*\[?\s*\d{1,3}\s*\]?[\.\)]?[ \t]+ #   "[1] " or "1. " or "1) "
      |                                        # OR
        ^[ \t]*[A-Z][A-Za-z'-]+,                 #   "Smith, J., 2018, …"
    )
    """,
    re.MULTILINE | re.VERBOSE,
)


def _ensure_table() -> None:
    db = get_db()
    if "paper_references" not in db.table_names():
        db["paper_references"].create(
            {
                "id": int,
                "src_post_id": str,
                "dst_post_id": str,
                "dst_doi": str,
                "dst_arxiv_id": str,
                "dst_title": str,
                "dst_year": int,
                "dst_authors_json": str,
                "raw": str,
                "resolution_status": str,  # ok | doi_only | arxiv_only | unresolved
                "extractor": str,           # openfileloader | regex
                "fetched_at": str,
            },
            pk="id",
        )
        db["paper_references"].create_index(["src_post_id"])
        db["paper_references"].create_index(["dst_doi"])
        db["paper_references"].create_index(["dst_arxiv_id"])
        db["paper_references"].create_index(["dst_post_id"])
        db["paper_references"].create_index(["resolution_status"])


def _ofl_extract(text: str) -> tuple[list[str], str]:
    """Try OpenFileLoader's reference extractor when available. Returns
    (refs, extractor) where extractor is either 'openfileloader' or
    'regex' depending on which path succeeded.

    OpenFileLoader is treated as a soft dependency — every plausible
    package name is probed; on the first success we use it, otherwise
    we fall through to regex. This lets the user install whichever
    package they have without the rest of the code knowing the name.
    """
    candidates = (
        ("openfileloader", "extract_references"),
        ("openfileloader", "parse_references"),
        ("open_file_loader", "extract_references"),
        ("openfile_loader", "extract_references"),
    )
    for mod_name, fn_name in candidates:
        try:
            import importlib
            mod = importlib.import_module(mod_name)
            fn = getattr(mod, fn_name, None)
            if callable(fn):
                refs = fn(text)
                if isinstance(refs, list) and refs:
                    return [str(r).strip() for r in refs if r], "openfileloader"
        except Exception:
            continue
    return [], "regex"


def _regex_extract(refs_text: str) -> list[str]:
    """Split a References-section text into individual reference strings."""
    if not refs_text:
        return []
    # Strategy 1: split on numbered/named line starts.
    splits = list(_REF_LINE_SPLIT.finditer(refs_text))
    if len(splits) >= 5:
        out: list[str] = []
        for i, m in enumerate(splits):
            start = m.start()
            end = splits[i + 1].start() if i + 1 < len(splits) else len(refs_text)
            chunk = refs_text[start:end].strip()
            if 30 <= len(chunk) <= 800:  # skip tiny noise + runaway captures
                out.append(chunk)
        if out:
            return out
    # Strategy 2: split on blank lines (last-resort).
    fallback = [c.strip() for c in re.split(r"\n\s*\n", refs_text) if c.strip()]
    return [f for f in fallback if 30 <= len(f) <= 800]


def _parse_one(raw: str) -> dict[str, Any]:
    """Pull DOI / arxiv id / year / title-ish first sentence from one ref."""
    out: dict[str, Any] = {
        "raw": raw[:1000],
        "doi": "", "arxiv_id": "", "year": 0, "title": "",
    }
    m = _DOI_RE.search(raw)
    if m:
        out["doi"] = m.group(0).rstrip(".,;)")
    m = _ARXIV_ID_RE.search(raw)
    if m:
        out["arxiv_id"] = m.group(1)
    years = _YEAR_RE.findall(raw)
    if years:
        out["year"] = int(years[0])
    # Title heuristic: first sentence that looks long enough to be a
    # title. Conservative — we just store the first 25-200 chars after
    # the authors block.
    title_match = re.search(
        r"(?:[\d\.\)\]]\s+)?(?:[A-Z][a-zA-Z'-]+(?:,\s*[A-Z]\.?){0,3}(?:,\s*and\s+[A-Z][a-zA-Z'-]+)?\.\s+)?(.{20,250}?)[\.\?]\s",
        raw,
    )
    if title_match:
        out["title"] = title_match.group(1).strip()[:250]
    return out


def extract_references_for(post_id: str, *, force: bool = False) -> dict[str, Any]:
    """Pull References section text from the cache, parse into individual
    refs, persist as ``paper_references`` rows. Idempotent.

    Returns ``{ok, post_id, n_refs, extractor, source}``."""
    db = get_db()
    src_rows = list(db.query(
        "SELECT source FROM paper_full_texts WHERE post_id = ? AND status='ok'",
        [post_id],
    ))
    if not src_rows:
        return {"ok": False, "post_id": post_id,
                "error": "no full-text cache for this post"}

    _ensure_table()

    if not force:
        existing = list(db.query(
            "SELECT count(*) AS n FROM paper_references WHERE src_post_id = ?",
            [post_id],
        ))
        if existing and existing[0]["n"] > 0:
            return {"ok": True, "post_id": post_id, "cached": True,
                    "n_refs": existing[0]["n"]}

    # Prefer the structured References section when sectioning succeeded;
    # fall back to the trailing 15% of the cache otherwise.
    refs_text = get_section_text(post_id, "references")
    if not refs_text:
        cache = _cache_path(src_rows[0]["source"], post_id)
        if not cache.exists():
            return {"ok": False, "post_id": post_id, "error": "cache file missing"}
        full = cache.read_text(encoding="utf-8", errors="replace")
        refs_text = full[int(len(full) * 0.85):]

    # OpenFileLoader path first; regex fallback.
    refs, extractor = _ofl_extract(refs_text or "")
    if not refs:
        refs = _regex_extract(refs_text or "")
        extractor = "regex"

    if not refs:
        return {"ok": True, "post_id": post_id, "n_refs": 0,
                "extractor": extractor,
                "warning": "no reference lines extracted — paper may have non-standard refs section"}

    db.execute("DELETE FROM paper_references WHERE src_post_id = ?", [post_id])
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    rows: list[dict] = []
    for r in refs:
        parsed = _parse_one(r)
        if parsed["doi"]:
            status = "doi_only"
        elif parsed["arxiv_id"]:
            status = "arxiv_only"
        else:
            status = "unresolved"
        rows.append({
            "src_post_id": post_id,
            "dst_post_id": "",
            "dst_doi": parsed["doi"],
            "dst_arxiv_id": parsed["arxiv_id"],
            "dst_title": parsed["title"],
            "dst_year": parsed["year"],
            "dst_authors_json": "",
            "raw": parsed["raw"],
            "resolution_status": status,
            "extractor": extractor,
            "fetched_at": now,
        })
    if rows:
        db["paper_references"].insert_all(rows, alter=True)

    return {
        "ok": True, "post_id": post_id, "n_refs": len(rows),
        "extractor": extractor,
        "by_status": {
            "doi_only": sum(1 for r in rows if r["resolution_status"] == "doi_only"),
            "arxiv_only": sum(1 for r in rows if r["resolution_status"] == "arxiv_only"),
            "unresolved": sum(1 for r in rows if r["resolution_status"] == "unresolved"),
        },
    }


def resolve_to_existing_posts(post_id: str | None = None) -> dict[str, Any]:
    """Walk paper_references rows that aren't yet linked to a post and
    try to match them against existing rows in ``posts`` by:

      1. dst_doi → ``posts.metadata_json -> doi`` (when available)
      2. dst_arxiv_id → ``arxiv_<id>`` post id

    Updates ``dst_post_id`` + ``resolution_status='ok'`` on success.
    Pure SQL — no network calls. Network resolution (Crossref, OpenAlex)
    is a follow-up that lives in its own function.
    """
    _ensure_table()
    db = get_db()
    where = ""
    params: list[Any] = []
    if post_id:
        where = " AND src_post_id = ?"
        params.append(post_id)

    # arxiv_id → posts.id
    arxiv_rows = list(db.query(
        "SELECT id, dst_arxiv_id FROM paper_references"
        " WHERE dst_post_id = '' AND dst_arxiv_id != ''" + where,
        params,
    ))
    n_arxiv = 0
    for r in arxiv_rows:
        candidate_pid = f"arxiv_{r['dst_arxiv_id']}"
        match = list(db.query("SELECT id FROM posts WHERE id = ?", [candidate_pid]))
        if not match:
            # Try without the version suffix
            base = re.sub(r"v[0-9]+$", "", r["dst_arxiv_id"])
            match = list(db.query(
                "SELECT id FROM posts WHERE id LIKE ?",
                [f"arxiv_{base}%"],
            ))
        if match:
            db.execute(
                "UPDATE paper_references SET dst_post_id = ?, resolution_status = 'ok'"
                " WHERE id = ?",
                [match[0]["id"], r["id"]],
            )
            n_arxiv += 1

    # DOI → posts (only if metadata_json column exists)
    n_doi = 0
    try:
        doi_rows = list(db.query(
            "SELECT id, dst_doi FROM paper_references"
            " WHERE dst_post_id = '' AND dst_doi != ''" + where,
            params,
        ))
        for r in doi_rows:
            try:
                hits = list(db.query(
                    "SELECT id FROM posts WHERE metadata_json LIKE ? LIMIT 1",
                    [f'%"{r["dst_doi"]}"%'],
                ))
            except Exception:
                hits = []
            if hits:
                db.execute(
                    "UPDATE paper_references SET dst_post_id = ?, resolution_status = 'ok'"
                    " WHERE id = ?",
                    [hits[0]["id"], r["id"]],
                )
                n_doi += 1
    except Exception:
        pass

    return {"ok": True, "linked_via_arxiv": n_arxiv, "linked_via_doi": n_doi}


def get_references(post_id: str) -> list[dict]:
    _ensure_table()
    db = get_db()
    return list(db.query(
        "SELECT id, dst_post_id, dst_doi, dst_arxiv_id, dst_title, dst_year,"
        " raw, resolution_status, extractor"
        " FROM paper_references WHERE src_post_id = ?"
        " ORDER BY id",
        [post_id],
    ))


def get_cited_by(post_id: str) -> list[dict]:
    """Return the papers in our corpus that cite ``post_id``. Only counts
    references where ``resolve_to_existing_posts`` linked the cite to
    a real post in our DB."""
    _ensure_table()
    db = get_db()
    return list(db.query(
        "SELECT src_post_id, dst_doi, dst_arxiv_id, dst_title"
        " FROM paper_references WHERE dst_post_id = ? AND resolution_status = 'ok'",
        [post_id],
    ))


def extract_topic_references(topic: str | None = None,
                             *, limit: int | None = None,
                             force: bool = False) -> dict[str, Any]:
    """Bulk: extract references for every cached paper in a topic and
    auto-link to existing posts."""
    db = get_db()
    sql = "SELECT post_id FROM paper_full_texts WHERE status = 'ok'"
    params: list[Any] = []
    if topic:
        sql += " AND post_id IN (SELECT post_id FROM topic_posts WHERE topic = ?)"
        params.append(topic)
    if limit:
        sql += " LIMIT ?"
        params.append(int(limit))
    targets = list(db.query(sql, params))
    extracted = 0
    refs_total = 0
    for t in targets:
        r = extract_references_for(t["post_id"], force=force)
        if r.get("ok"):
            extracted += 1
            refs_total += int(r.get("n_refs", 0))
    link = resolve_to_existing_posts()
    return {
        "ok": True, "topic": topic, "papers_processed": extracted,
        "refs_total": refs_total,
        "linked_via_arxiv": link["linked_via_arxiv"],
        "linked_via_doi": link["linked_via_doi"],
    }


__all__ = [
    "extract_references_for",
    "resolve_to_existing_posts",
    "get_references",
    "get_cited_by",
    "extract_topic_references",
]
