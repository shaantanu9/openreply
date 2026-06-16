"""Deterministic citation-existence gate for academic outputs.

When an academic brief / draft cites papers from the Gap Map corpus, we want a
cheap, *deterministic* (no LLM) way to confirm each cited paper actually exists
in an external index. A fabricated or broken citation is a strong "this output
is not trustworthy" signal, so we surface it before the work ships.

Strategy (precision over recall — never block on ambiguity):

  1. Look up each cited post by id in the local `posts` table to recover its
     stored identifiers (id / url / permalink).
  2. Extract a verifiable identifier from those fields:
       - DOI   → verify against Crossref (`crossref.fetch_by_doi`).
       - arXiv → a well-formed arxiv.org URL is treated as resolvable; we do
                 NOT hit the network for it.
       - otherwise → "unresolvable" (we have nothing to check, so we never
                     block on it).
  3. A DOI that does NOT resolve (Crossref miss) is a fabrication signal and is
     the ONLY thing that marks the result as blocking.

Network access is best-effort: any exception from the DOI lookup downgrades to
"unresolvable" (never "missing"), so a transient network blip can never hard-
block a real citation.

This module never raises — `verify_citations` always returns a result dict.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone

from gapmap.core.db import get_db
from gapmap.sources import crossref

# ── Identifier patterns ─────────────────────────────────────────────────────
# DOI: the de-facto Crossref/registrant pattern. Matches a DOI embedded
# anywhere in an id / url / permalink string.
_DOI_RE = re.compile(r"10\.\d{4,9}/[-._;()/:A-Za-z0-9]+")

# arXiv: matches abs/pdf URLs and captures the bare arXiv identifier.
_ARXIV_URL_RE = re.compile(r"arxiv\.org/(?:abs|pdf)/([\w.\-/]+)", re.IGNORECASE)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _clean_doi(raw: str) -> str:
    """Normalise a matched DOI: drop any trailing punctuation / file suffix
    that the regex may have greedily captured from a URL."""
    doi = raw.strip()
    # A DOI inside a URL can pick up a trailing slash or a `.pdf` suffix; trim
    # the obvious offenders without touching legitimate DOI characters.
    doi = doi.rstrip("/.")
    if doi.lower().endswith(".pdf"):
        doi = doi[:-4]
    return doi


def _extract_identifier(row: dict) -> tuple[str, str]:
    """Pull a verifiable identifier from a post row.

    Returns a ``(kind, identifier)`` tuple where ``kind`` is one of
    ``"doi"``, ``"arxiv"`` or ``"none"``. Searches id, url and permalink in
    that order; DOI takes precedence over arXiv when both are present.
    """
    fields = [
        str(row.get("id") or ""),
        str(row.get("url") or ""),
        str(row.get("permalink") or ""),
    ]
    blob = "\n".join(fields)

    # DOI wins — it's directly verifiable against Crossref.
    m = _DOI_RE.search(blob)
    if m:
        return ("doi", _clean_doi(m.group(0)))

    # arXiv — a well-formed arxiv.org URL is resolvable by construction.
    m = _ARXIV_URL_RE.search(blob)
    if m:
        return ("arxiv", m.group(1).strip())

    # An id that explicitly starts with "arxiv" (e.g. "arxiv_2401.00001")
    # without a URL is still an arXiv reference.
    pid = fields[0].lower()
    if pid.startswith("arxiv"):
        # Best-effort: pull the trailing identifier after the prefix/separator.
        tail = re.sub(r"^arxiv[_:/\s-]*", "", fields[0], flags=re.IGNORECASE).strip()
        return ("arxiv", tail or fields[0])

    return ("none", "")


def _lookup_row(db, post_id: str) -> dict | None:
    """Fetch the stored post row for ``post_id`` (or None on miss/error)."""
    try:
        rows = list(
            db.query(
                "SELECT id, source_type, title, url, permalink "
                "FROM posts WHERE id = ?",
                [post_id],
            )
        )
    except Exception:  # noqa: BLE001 — a bad/locked DB must not hard-block.
        return None
    return rows[0] if rows else None


def _verify_one(db, post_id: str) -> dict:
    """Resolve a single cited post id to a citation verdict dict."""
    row = _lookup_row(db, post_id) or {}
    title = str(row.get("title") or "")
    kind, identifier = _extract_identifier(row) if row else ("none", "")

    if kind == "doi":
        # Best-effort network verification. Any exception → unresolvable, so a
        # network blip never produces a false "missing" (fabrication) signal.
        try:
            hit = crossref.fetch_by_doi(identifier)
        except Exception:  # noqa: BLE001
            status = "unresolvable"
        else:
            status = "verified" if hit is not None else "missing"
    elif kind == "arxiv":
        # A well-formed arXiv reference is treated as resolvable without a
        # network round-trip (precision over recall; avoids rate-limit churn).
        status = "verified"
    else:
        # Nothing verifiable extracted — never block on these.
        status = "unresolvable"

    return {
        "post_id": post_id,
        "identifier": identifier,
        "kind": kind,
        "status": status,
        "title": title,
    }


def verify_citations(post_ids: list[str], *, db=None) -> dict:
    """Verify that each cited academic paper actually exists in an external
    index. Deterministic, network-best-effort, and never raises.

    Args:
        post_ids: ids of cited papers (duplicates are de-duped).
        db: optional sqlite_utils Database; defaults to ``get_db()``. Injectable
            so tests can supply a stub.

    Returns a result dict (see module docstring for the contract). ``blocking``
    is True iff at least one citation had a DOI that did NOT resolve.
    """
    generated_at = _now_iso()

    # De-dupe while preserving first-seen order, and drop empties.
    seen: set[str] = set()
    ordered: list[str] = []
    for pid in post_ids or []:
        pid = str(pid or "").strip()
        if pid and pid not in seen:
            seen.add(pid)
            ordered.append(pid)

    # Empty input → trivially OK, nothing to verify, nothing blocking.
    if not ordered:
        return {
            "ok": True,
            "total": 0,
            "verified": 0,
            "unresolvable": 0,
            "missing": 0,
            "blocking": False,
            "citations": [],
            "generated_at": generated_at,
        }

    if db is None:
        db = get_db()

    citations: list[dict] = []
    verified = unresolvable = missing = 0
    for pid in ordered:
        verdict = _verify_one(db, pid)
        citations.append(verdict)
        if verdict["status"] == "verified":
            verified += 1
        elif verdict["status"] == "missing":
            missing += 1
        else:
            unresolvable += 1

    blocking = missing > 0
    return {
        # `ok` reflects "no fabrication detected" — same condition as not
        # blocking, exposed as a friendlier boolean for callers/UI.
        "ok": not blocking,
        "total": len(ordered),
        "verified": verified,
        "unresolvable": unresolvable,
        "missing": missing,
        "blocking": blocking,
        "citations": citations,
        "generated_at": generated_at,
    }
