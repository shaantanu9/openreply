"""Section-aware parsing for academic-paper full text.

Walk the flat text produced by ``paper_fulltext.get_full_text`` and
identify the standard section boundaries: Abstract, Introduction,
Related Work, Background, Methods/Methodology/Approach, Experiments,
Results, Discussion, Limitations, Future Work, Conclusion, References.

Why a separate module: ``paper_fulltext.py`` already does enough work
(downloading, encoding fixes, caching). Sectioning is layered on top
so it can be re-run without re-downloading and so a future
OpenFileLoader-backed parser can swap in here without disturbing the
download pipeline.

Failure mode: when no recognised heading is found we return a single
``body`` row covering the whole text. Downstream chunker still works —
the gap-finding heuristics that depend on section names just don't get
the boost.

Public API (all idempotent, all best-effort, none raise):

    parse_sections_for(post_id, *, force=False) -> dict
    get_sections(post_id) -> list[dict]
    get_section_text(post_id, section) -> str | None
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

from ..core.db import get_db
from .paper_fulltext import _cache_path

# Canonical section names — what we store in `paper_sections.name`.
# Aliases below map raw printed headings to a canonical name so callers
# can filter by `section='methods'` regardless of whether the paper
# called it "Methods" or "Methodology" or "Approach".
CANONICAL_SECTIONS = (
    "abstract",
    "introduction",
    "background",
    "related_work",
    "methods",
    "experiments",
    "results",
    "evaluation",
    "discussion",
    "limitations",
    "future_work",
    "conclusion",
    "acknowledgments",
    "references",
    "appendix",
)

_HEADING_ALIASES: dict[str, str] = {
    # Each key is a regex (case-insensitive); value is the canonical name.
    r"abstract": "abstract",
    r"introduction|motivation": "introduction",
    r"background|preliminaries": "background",
    r"related[\s-]?work|prior[\s-]?work|literature[\s-]?review": "related_work",
    r"method(s|ology)?|approach|model|architecture|our[\s-]?method": "methods",
    r"experiment(s|al[\s-]?setup)?|setup": "experiments",
    r"results?|findings?": "results",
    r"evaluation|benchmark(s)?": "evaluation",
    r"discussion": "discussion",
    r"limitation(s)?|threats[\s-]?to[\s-]?validity": "limitations",
    r"future[\s-]?work|open[\s-]?problems": "future_work",
    r"conclusion(s)?|summary": "conclusion",
    r"acknowledg(e)?ment(s)?|funding": "acknowledgments",
    r"references|bibliography|works[\s-]?cited": "references",
    r"appendix|supplementary|appendices": "appendix",
}

# Compiled once. Headings are matched on a separate-line basis so we
# don't false-positive on body-text occurrences of the words.
# Match patterns:
#   "1 Introduction", "1. Introduction", "I. Introduction",
#   "INTRODUCTION", "Introduction", "Introduction\n========", etc.
# Anchor on start-of-line + allow numeric/roman prefix.
_HEADING_RE = re.compile(
    r"""
    ^[ \t]*
    (?:
        (?:[0-9]+(?:\.[0-9]+)*\.?)            # 1, 1.2, 3.4.1
      | (?:[IVXivx]+\.?)                      # I, II, III
    )?
    [ \t]*
    (?P<heading>[A-Za-z][A-Za-z \t/&-]{2,40}?)
    [ \t]*
    [:\.]?
    [ \t]*$
    """,
    re.MULTILINE | re.VERBOSE,
)


def _ensure_table() -> None:
    """Create paper_sections idempotently. Indexes on (post_id, name) for
    the common 'pull every Limitations section in a topic' query."""
    db = get_db()
    if "paper_sections" not in db.table_names():
        db["paper_sections"].create(
            {
                "id": int,
                "post_id": str,
                "name": str,
                "raw_heading": str,
                "ord": int,
                "char_start": int,
                "char_end": int,
                "char_count": int,
                "created_at": str,
            },
            pk="id",
        )
        db["paper_sections"].create_index(["post_id"])
        db["paper_sections"].create_index(["name"])
        db["paper_sections"].create_index(["post_id", "name"])


def _classify_heading(raw: str) -> str | None:
    """Return the canonical section name for a raw heading line, or None
    when the line doesn't look like a recognised section header."""
    s = raw.strip().lower()
    if not s or len(s) > 60:
        return None
    # Strict mode: heading must be ALL alpha (with spaces/punct), no
    # commas (commas almost always mean it's a sentence). We rely on
    # the regex's alpha-only character class for the bulk of this.
    for pat, canonical in _HEADING_ALIASES.items():
        if re.fullmatch(pat, s, flags=re.IGNORECASE):
            return canonical
    return None


def _detect_sections(text: str) -> list[dict]:
    """Walk the text, returning a list of section spans. Each entry:
    ``{name, raw_heading, ord, char_start, char_end}``. Empty list when
    no section was found — callers fall back to a single ``body`` span.
    """
    spans: list[dict] = []
    seen_names: set[str] = set()
    for m in _HEADING_RE.finditer(text):
        raw = (m.group("heading") or "").strip()
        canonical = _classify_heading(raw)
        if not canonical:
            continue
        # We only keep the FIRST match for each canonical name to avoid
        # mis-detecting body-text occurrences as fresh sections (e.g.
        # the word "Results" appearing inside Discussion). This skews
        # toward false-negatives, which is the safer error.
        if canonical in seen_names:
            continue
        seen_names.add(canonical)
        spans.append({
            "name": canonical,
            "raw_heading": raw,
            "char_start": m.start(),
            # char_end is filled in below once we know the next span.
            "char_end": -1,
        })
    if not spans:
        return []
    spans.sort(key=lambda s: s["char_start"])
    for i, s in enumerate(spans):
        s["ord"] = i
        s["char_end"] = spans[i + 1]["char_start"] if i + 1 < len(spans) else len(text)
    # Discard tiny spans (<200 chars) — they're heading mis-classifications.
    return [s for s in spans if (s["char_end"] - s["char_start"]) >= 200]


def parse_sections_for(post_id: str, *, force: bool = False) -> dict[str, Any]:
    """Parse sections from the cached full text for a paper. Persists rows
    into ``paper_sections``. Idempotent: re-runs replace prior rows.

    Returns ``{ok, post_id, sections: [{name, ord, char_count, ...}]}``
    or ``{ok: False, error}`` if no full text is cached for the post.
    """
    db = get_db()
    rows = list(db.query(
        "SELECT source FROM paper_full_texts WHERE post_id = ? AND status = 'ok'",
        [post_id],
    ))
    if not rows:
        return {"ok": False, "post_id": post_id,
                "error": "no full-text cache for this post (run paper-fulltext first)"}
    source = rows[0]["source"]
    cache = _cache_path(source, post_id)
    if not cache.exists():
        return {"ok": False, "post_id": post_id,
                "error": f"cache file missing on disk: {cache}"}
    text = cache.read_text(encoding="utf-8", errors="replace")

    _ensure_table()
    if not force:
        existing = list(db.query(
            "SELECT count(*) AS n FROM paper_sections WHERE post_id = ?",
            [post_id],
        ))
        if existing and existing[0]["n"] > 0:
            return {
                "ok": True, "post_id": post_id, "cached": True,
                "sections": list(db.query(
                    "SELECT name, ord, char_start, char_end, char_count, raw_heading"
                    " FROM paper_sections WHERE post_id = ? ORDER BY ord", [post_id],
                )),
            }

    spans = _detect_sections(text)
    if not spans:
        # Whole-document fallback so chunking still has something to work with.
        spans = [{
            "name": "body", "raw_heading": "",
            "ord": 0, "char_start": 0, "char_end": len(text),
        }]

    # Replace any prior rows for this post (idempotent re-runs).
    db.execute("DELETE FROM paper_sections WHERE post_id = ?", [post_id])
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    rows_out: list[dict] = []
    for s in spans:
        char_count = s["char_end"] - s["char_start"]
        row = {
            "post_id": post_id,
            "name": s["name"],
            "raw_heading": s.get("raw_heading", "")[:200],
            "ord": s["ord"],
            "char_start": s["char_start"],
            "char_end": s["char_end"],
            "char_count": char_count,
            "created_at": now,
        }
        rows_out.append(row)
    if rows_out:
        db["paper_sections"].insert_all(rows_out, alter=True)

    return {
        "ok": True, "post_id": post_id, "cached": False,
        "sections": [{"name": r["name"], "ord": r["ord"],
                      "char_start": r["char_start"], "char_end": r["char_end"],
                      "char_count": r["char_count"], "raw_heading": r["raw_heading"]}
                     for r in rows_out],
    }


def get_sections(post_id: str) -> list[dict]:
    """Return the persisted section spans for a paper, ordered."""
    _ensure_table()
    db = get_db()
    return list(db.query(
        "SELECT name, ord, char_start, char_end, char_count, raw_heading"
        " FROM paper_sections WHERE post_id = ? ORDER BY ord",
        [post_id],
    ))


def get_section_text(post_id: str, section: str) -> str | None:
    """Return the verbatim text of a named section, or None when absent.

    ``section`` is matched against the canonical names (see
    CANONICAL_SECTIONS). Returns the longest matching span when a paper
    has multiple sub-sections sharing a canonical name (rare; we only
    keep first occurrence today, but future-proof anyway)."""
    sections = get_sections(post_id)
    matches = [s for s in sections if s["name"] == section]
    if not matches:
        return None
    db = get_db()
    src_rows = list(db.query(
        "SELECT source FROM paper_full_texts WHERE post_id = ? AND status='ok'",
        [post_id],
    ))
    if not src_rows:
        return None
    cache = _cache_path(src_rows[0]["source"], post_id)
    if not cache.exists():
        return None
    text = cache.read_text(encoding="utf-8", errors="replace")
    best = max(matches, key=lambda s: s["char_count"])
    return text[best["char_start"]:best["char_end"]]


__all__ = [
    "CANONICAL_SECTIONS",
    "parse_sections_for",
    "get_sections",
    "get_section_text",
]
