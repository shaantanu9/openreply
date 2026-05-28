"""Source-aware corpus formatting for LLM prompts.

The LLM needs to know which rows are peer-reviewed papers, which are Reddit
threads, which are app-store reviews, and which are ingested local documents
— its citations, confidence, and weighting should differ accordingly. All
LLM-facing modules (gaps / chat / report_pro) route through here so the
format is identical everywhere.

Output shape per row, one of:
  [r_abc123] r/rust (12↑ 5c) Title
  <snippet>

  [arxiv:2401.12345] arXiv — Title
  <snippet>

  [pubmed:12345] PubMed — Title
  <snippet>

  [scholar:hash] Scholar (340 cites) — Title
  <snippet>

  [oa:W12345] OpenAlex (120 cites) — Title
  <snippet>

  [appstore:MyApp] App Store review (4★) — Title
  <snippet>

  [hn:story42] Hacker News (85↑) — Title
  <snippet>

  [github:repo/issues/9] GitHub issue — Title
  <snippet>

  [ingest:filename.pdf] Local file — Title
  <snippet>
"""
from __future__ import annotations

import re
from typing import Any, Iterable


# Ordering matters: most specific first (e.g. 'github_issues' before 'github').
_SOURCE_FORMATTERS = {
    "arxiv":         lambda r: f"[arxiv:{_arxiv_id(r)}] arXiv",
    "pubmed":        lambda r: f"[pubmed:{r['id']}] PubMed",
    "scholar":       lambda r: f"[scholar:{r['id']}] Scholar ({r.get('score') or 0} cites)",
    "openalex":      lambda r: f"[oa:{r['id']}] OpenAlex ({r.get('score') or 0} cites)",
    "hn":            lambda r: f"[hn:{r['id']}] Hacker News ({r.get('score',0)}↑)",
    "appstore":      lambda r: f"[appstore:{r['id']}] App Store review ({_stars(r)})",
    "playstore":     lambda r: f"[playstore:{r['id']}] Play Store review ({_stars(r)})",
    "github":        lambda r: f"[github:{r['id']}] GitHub repo ({r.get('score',0)}⭐)",
    "github_issues": lambda r: f"[gh-issue:{r['id']}] GitHub issue",
    "github_issue":  lambda r: f"[gh-issue:{r['id']}] GitHub issue",
    "devto":         lambda r: f"[devto:{r['id']}] dev.to",
    "lemmy":         lambda r: f"[lemmy:{r['id']}] Lemmy ({r.get('score',0)}↑)",
    "mastodon":      lambda r: f"[masto:{r['id']}] Mastodon",
    "gnews":         lambda r: f"[news:{r['id']}] News",
    "stackoverflow": lambda r: f"[so:{r['id']}] StackOverflow ({r.get('score',0)}↑)",
    "ingest":        lambda r: f"[ingest:{_ingest_name(r)}] Local file",
    "wikipedia":     lambda r: f"[wiki:{r['id']}] Wikipedia",
    "discourse":     lambda r: f"[discourse:{r['id']}] Forum",
    # ── YouTube: three distinct content kinds, each labelled so the LLM
    # knows what it's reading (user reaction vs speaker-authored). The
    # ``sub`` column carries the channel name for all three. Without
    # these entries the default Reddit fallback would tag a transcript
    # chunk as ``r/<channel> (0↑ 0c)`` which the LLM might read as a
    # low-engagement Reddit post.
    "youtube":             lambda r: f"[yt:{r['id']}] YouTube comment on “{(r.get('sub') or '?')}” ({r.get('score',0)}↑)",
    "youtube_description": lambda r: f"[yt-desc:{r['id']}] YouTube video description — channel “{(r.get('sub') or '?')}”",
    "youtube_transcript":  lambda r: f"[yt-tx:{r['id']}] YouTube transcript chunk — channel “{(r.get('sub') or '?')}” (speaker's words)",
}


def _arxiv_id(row: dict) -> str:
    """Pull the arxiv ID from URL if available, else fall back to row id."""
    url = (row.get("url") or "").strip()
    m = re.search(r"arxiv\.org/abs/([^/?#]+)", url)
    if m:
        return m.group(1)
    return str(row.get("id", ""))


def _stars(row: dict) -> str:
    s = row.get("score")
    if s in (None, 0):
        return "no rating"
    return f"{s}★"


def _ingest_name(row: dict) -> str:
    """Use the post `sub` field for ingest (we store filename there)."""
    return (row.get("sub") or row.get("id") or "file").strip()


def _format_row(row: dict[str, Any], excerpt_chars: int = 600) -> str:
    source = (row.get("source_type") or "reddit").lower()
    title = (row.get("title") or "").strip()
    body = (row.get("selftext") or "")[:excerpt_chars].strip()

    fmt = _SOURCE_FORMATTERS.get(source)
    if fmt is None:
        # Default = Reddit.
        header = (
            f"[{row['id']}] r/{row.get('sub','?')} "
            f"({row.get('score',0)}↑ {row.get('num_comments',0)}c)"
        )
    else:
        header = fmt(row)

    if title:
        header = f"{header} — {title}"
    return f"{header}\n{body}" if body else header


def format_corpus(rows: Iterable[dict[str, Any]], excerpt_chars: int = 600) -> str:
    """Render a corpus for an LLM prompt, source-aware.

    Each row gets a prefix that tells the LLM what kind of source it is —
    arXiv paper, Reddit thread, app-store review, ingested PDF, etc. — so
    the model's downstream citations, confidence, and weighting can reflect
    evidence quality. Reddit posts fall back to the legacy format for
    backward compatibility with prompts that grep for `r/sub`.
    """
    rendered = [_format_row(r, excerpt_chars=excerpt_chars) for r in rows]
    return "\n\n".join(rendered)
