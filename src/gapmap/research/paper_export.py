"""Paper-corpus exporters — BibTeX / RIS / APA / Markdown.

Input: a topic name.
Output: a string the user can paste into a reference manager (Zotero,
Mendeley), a LaTeX document (BibTeX), or a blog post (APA or Markdown).

Reads from `posts` + `topic_posts` — academic sources only. Every paper
becomes one citation entry. Safe to run many times (read-only).
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Iterable

from ..core.db import get_db

ACADEMIC_SOURCES = (
    "arxiv", "pubmed", "openalex", "scholar",
    "semantic_scholar", "crossref",
)


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", (s or "").lower()).strip("_")[:40] or "unnamed"


def _year(post: dict) -> str:
    ts = post.get("created_utc") or 0
    try:
        return str(datetime.fromtimestamp(float(ts), tz=timezone.utc).year) if ts else ""
    except (ValueError, OSError):
        return ""


def _split_title_venue(post: dict) -> tuple[str, str]:
    """Our paper rows pack the venue into `title` as 'Title — Venue'. Split
    them back apart so BibTeX / RIS fields stay semantically distinct.
    """
    t = (post.get("title") or "").strip()
    if "  — " in t:
        title, venue = t.split("  — ", 1)
        return title.strip(), venue.strip()
    return t, ""


def _first_author_lastname(post: dict) -> str:
    authors = (post.get("author") or "").split(",")
    if not authors:
        return "unknown"
    first = (authors[0] or "").strip()
    if not first:
        return "unknown"
    # "Given Last" or "Last, Given"
    parts = first.split()
    return (parts[-1] if parts else first).lower()


def _doi_from_url(url: str) -> str:
    u = url or ""
    if "doi.org/" in u:
        return u.split("doi.org/", 1)[1].strip("/")
    if u.startswith("10."):
        return u
    return ""


def _papers_for_topic(topic: str, limit: int | None = None) -> list[dict]:
    placeholders = ",".join("?" for _ in ACADEMIC_SOURCES)
    sql = (
        "SELECT p.* FROM posts p "
        "JOIN topic_posts tp ON tp.post_id = p.id "
        f"WHERE tp.topic = ? AND coalesce(p.source_type,'') IN ({placeholders}) "
        "ORDER BY coalesce(p.score,0) DESC"
    )
    rows = list(get_db().query(sql, [topic, *ACADEMIC_SOURCES]))
    return rows[: int(limit)] if limit else rows


# ─── formatters ──────────────────────────────────────────────────────────────

def to_bibtex(posts: Iterable[dict]) -> str:
    """LaTeX-ready BibTeX string. Entry type inferred from source_type."""
    out = []
    for p in posts:
        title, venue = _split_title_venue(p)
        year = _year(p)
        doi = _doi_from_url(p.get("url") or "")
        key = f"{_first_author_lastname(p)}{year}_{_slug(title)[:20]}"
        src = p.get("source_type") or ""
        kind = (
            "article"   if src in ("pubmed", "crossref", "scholar", "openalex") else
            "misc"      if src == "arxiv" else
            "article"
        )
        fields = [
            ("title",   title),
            ("author",  (p.get("author") or "").replace(",", " and ")),
            ("year",    year),
            ("journal", venue) if kind == "article" and venue else None,
            ("doi",     doi),
            ("url",     p.get("url")),
            ("note",    p.get("flair")),
        ]
        lines = [f"@{kind}{{{key},"]
        for pair in fields:
            if not pair: continue
            k, v = pair
            if not v: continue
            lines.append(f"  {k} = {{{v}}},")
        lines.append("}")
        out.append("\n".join(lines))
    return "\n\n".join(out) + "\n"


def to_ris(posts: Iterable[dict]) -> str:
    """RIS format — import target for Zotero, Mendeley, EndNote."""
    out = []
    for p in posts:
        title, venue = _split_title_venue(p)
        year = _year(p)
        doi = _doi_from_url(p.get("url") or "")
        src = p.get("source_type") or ""
        ty = "JOUR" if src in ("pubmed", "crossref", "scholar", "openalex") else "GEN"
        block = [f"TY  - {ty}"]
        # One AU line per author
        for author in (p.get("author") or "").split(","):
            a = author.strip()
            if a and a != "[unknown]":
                block.append(f"AU  - {a}")
        if title: block.append(f"TI  - {title}")
        if venue: block.append(f"JO  - {venue}")
        if year:  block.append(f"PY  - {year}")
        if doi:   block.append(f"DO  - {doi}")
        if p.get("url"): block.append(f"UR  - {p['url']}")
        if p.get("selftext"):
            abstr = (p["selftext"] or "").replace("\n", " ")[:1500]
            block.append(f"AB  - {abstr}")
        block.append("ER  - ")
        out.append("\n".join(block))
    return "\n\n".join(out) + "\n"


def to_apa(posts: Iterable[dict]) -> str:
    """APA-7-style formatted strings, one per paper. Good enough for a
    bibliography at the end of a blog post or essay — not a replacement
    for a citation manager on a thesis.
    """
    out = []
    for p in posts:
        title, venue = _split_title_venue(p)
        year = _year(p)
        doi = _doi_from_url(p.get("url") or "")
        authors = (p.get("author") or "").strip()
        # Compress "First Last, First Last" into APA "Last, F., & Last, F."
        apa_authors = []
        for a in authors.split(","):
            parts = a.strip().split()
            if not parts: continue
            last = parts[-1]
            initials = " ".join(f"{n[0]}." for n in parts[:-1] if n)
            apa_authors.append(f"{last}, {initials}".strip(", "))
        if len(apa_authors) > 1:
            author_s = ", ".join(apa_authors[:-1]) + f", & {apa_authors[-1]}"
        elif apa_authors:
            author_s = apa_authors[0]
        else:
            author_s = "Unknown."
        parts = [f"{author_s} ({year}).", f"{title}.", (f"*{venue}*." if venue else "")]
        if doi:
            parts.append(f"https://doi.org/{doi}")
        elif p.get("url"):
            parts.append(p["url"])
        out.append(" ".join(x for x in parts if x))
    return "\n\n".join(out) + "\n"


def to_markdown(posts: Iterable[dict]) -> str:
    """Pretty Markdown block for sharing in a doc / Notion / blog."""
    out = ["| # | Paper | Authors | Year | Citations | Source | Link |",
           "|---|---|---|---|---|---|---|"]
    for i, p in enumerate(posts, 1):
        title, venue = _split_title_venue(p)
        year = _year(p)
        authors = (p.get("author") or "").split(",")
        author_s = authors[0].strip() + (" et al." if len(authors) > 1 else "")
        cite = p.get("score") or 0
        src = p.get("source_type") or ""
        url = p.get("url") or ""
        # Escape pipes in title — Markdown tables break otherwise
        safe_title = title.replace("|", "\\|")
        if venue:
            safe_title += f" *({venue})*"
        out.append(f"| {i} | {safe_title} | {author_s} | {year} | {cite} | {src} | [link]({url}) |")
    return "\n".join(out) + "\n"


# ─── public API ──────────────────────────────────────────────────────────────

FORMATS = ("bibtex", "ris", "apa", "md")


def export_topic(topic: str, *, fmt: str = "bibtex", limit: int | None = None) -> dict[str, Any]:
    """Export every academic-source paper tagged to `topic` in `fmt`.

    Returns {ok, fmt, topic, count, text}. `text` is the serialised
    bibliography — UI / CLI caller decides whether to save it or display it.
    """
    if fmt not in FORMATS:
        return {"ok": False, "reason": f"unknown fmt {fmt!r}; options: {FORMATS}"}
    posts = _papers_for_topic(topic, limit=limit)
    if not posts:
        return {"ok": True, "fmt": fmt, "topic": topic, "count": 0, "text": ""}
    formatters = {"bibtex": to_bibtex, "ris": to_ris, "apa": to_apa, "md": to_markdown}
    return {
        "ok": True,
        "fmt": fmt,
        "topic": topic,
        "count": len(posts),
        "text": formatters[fmt](posts),
    }
