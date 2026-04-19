"""Per-paper LLM analysis for the Research tab.

For each academic paper (arxiv / openalex / pubmed / scholar posts), run a
small LLM call that returns:
  - summary:   2-3 sentence TL;DR of what the paper found
  - relevance: 1-2 sentences on how it applies to the topic
  - takeaway:  one imperative-verb sentence a builder can act on

Cached forever in `paper_analyses` (keyed on post_id). Skip-gracefully when
no LLM is configured — returns `{ok: False, skipped: True, reason: ...}`
without raising. Defensive JSON parsing same as the canonicalize pattern.
"""
from __future__ import annotations

import json as _json
import os
import re as _re
from datetime import datetime, timezone
from typing import Any

from ..core.db import get_db


_ACADEMIC_SOURCES = ("arxiv", "openalex", "pubmed", "scholar")

_SYSTEM_PROMPT = (
    "You read academic papers and help a builder decide if the paper is "
    "worth their time for a specific topic. Return JSON only. No prose."
)

_USER_PROMPT_TMPL = (
    'Topic: "{topic}"\n'
    'Paper title: "{title}"\n'
    'Paper abstract: """\n{abstract}\n"""\n\n'
    "Return JSON:\n"
    "{{\n"
    '  "summary": "<2-3 sentence TL;DR of what the paper investigated and '
    'found. Concrete > vague. Skip the title.>",\n'
    '  "relevance_to_topic": "<1-2 sentences: HOW the findings apply to the '
    'topic. Be honest about stretch relevance.>",\n'
    '  "builder_takeaway": "<ONE sentence starting with an imperative verb '
    '(Instrument..., Measure..., Add..., Skip this paper — ...). The single '
    "action a builder shipping this topic could take.>\"\n"
    "}}\n\n"
    "Rules:\n"
    "- No fluff. No restating the title.\n"
    "- If the paper is irrelevant, say so in builder_takeaway.\n"
)


def _llm_paper_call(topic: str, title: str, abstract: str) -> str:
    """Call the configured LLM. Raises on provider errors — callers catch."""
    from ..analyze.providers.base import get_provider

    provider = get_provider()
    return provider.complete(
        prompt=_USER_PROMPT_TMPL.format(
            topic=topic,
            title=title or "",
            abstract=(abstract or "")[:3000],  # abstracts should fit; guard anyway
        ),
        system=_SYSTEM_PROMPT,
        max_tokens=400,
        temperature=0.2,
    )


def _parse_analysis(raw: str) -> dict | None:
    """Same 3-strategy parser as canonicalize."""
    text = (raw or "").strip()
    parsed = None
    for attempt in (
        lambda: _json.loads(text),
        lambda: _json.loads(text.strip("`").lstrip("json").strip()),
        lambda: (
            _json.loads(_re.search(r"\{.*\}", text, _re.DOTALL).group(0))
            if _re.search(r"\{.*\}", text, _re.DOTALL)
            else None
        ),
    ):
        try:
            parsed = attempt()
            if isinstance(parsed, dict):
                break
            parsed = None
        except Exception:
            continue
    return parsed if isinstance(parsed, dict) else None


def _load_paper_row(post_id: str) -> dict | None:
    """Fetch title + abstract from posts for one post id."""
    db = get_db()
    rows = list(db.query(
        "SELECT id, title, coalesce(selftext,'') AS selftext, "
        "coalesce(source_type,'reddit') AS source "
        "FROM posts WHERE id = ?",
        [post_id],
    ))
    return rows[0] if rows else None


def _write_analysis(post_id: str, topic: str, parsed: dict, provider: str, model: str) -> dict:
    db = get_db()
    summary = str(parsed.get("summary") or "").strip()
    relevance = str(parsed.get("relevance_to_topic") or "").strip()
    takeaway = str(parsed.get("builder_takeaway") or "").strip()
    row = {
        "post_id": post_id,
        "topic": topic,
        "summary": summary,
        "relevance": relevance,
        "takeaway": takeaway,
        "ts": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "provider": provider,
        "model": model,
    }
    db["paper_analyses"].upsert(row, pk="post_id")
    return row


def analyze_paper(topic: str, post_id: str, force: bool = False) -> dict[str, Any]:
    """Analyze a single paper. Returns the analysis row shape, or skip payload."""
    db = get_db()
    if not force:
        existing = list(db.query(
            "SELECT * FROM paper_analyses WHERE post_id = ?", [post_id],
        ))
        if existing:
            return {"ok": True, "cached": True, **existing[0]}

    paper = _load_paper_row(post_id)
    if not paper:
        return {"ok": False, "error": f"no such post: {post_id}", "post_id": post_id}

    # Provider gate — fail soft if nothing is configured.
    try:
        from ..analyze.providers.base import resolve_provider
        provider_name = resolve_provider(None)
    except Exception as e:
        return {
            "ok": False, "skipped": True,
            "reason": str(e),
            "post_id": post_id,
        }

    try:
        raw = _llm_paper_call(topic, paper["title"] or "", paper["selftext"] or "")
    except Exception as e:
        return {
            "ok": False, "error": f"llm call failed: {e}",
            "post_id": post_id,
        }

    parsed = _parse_analysis(raw)
    if parsed is None:
        return {
            "ok": False, "skipped": True, "reason": "parse_failed",
            "post_id": post_id,
        }

    model = os.getenv("LLM_MODEL") or ""
    return {
        "ok": True,
        "cached": False,
        **_write_analysis(post_id, topic, parsed, provider_name, model),
    }


def analyze_papers_bulk(
    topic: str,
    limit: int | None = None,
    force: bool = False,
    progress=None,
) -> dict[str, Any]:
    """Walk academic papers for topic, analyze those without an existing row.

    Returns {ok, analyzed, skipped, errored, total, first_error?}.
    """
    db = get_db()
    # Find academic-source posts for this topic that lack an analysis.
    placeholders = ",".join("?" for _ in _ACADEMIC_SOURCES)
    if force:
        where_missing = ""
        args = [topic, *_ACADEMIC_SOURCES]
    else:
        where_missing = " AND p.id NOT IN (SELECT post_id FROM paper_analyses)"
        args = [topic, *_ACADEMIC_SOURCES]
    sql = (
        "SELECT p.id FROM posts p "
        "JOIN topic_posts tp ON tp.post_id = p.id "
        f"WHERE tp.topic = ? AND coalesce(p.source_type,'reddit') IN ({placeholders})"
        f"{where_missing} "
        "ORDER BY coalesce(p.score,0) DESC"
    )
    rows = list(db.query(sql, args))
    post_ids = [r["id"] for r in rows]
    if limit:
        post_ids = post_ids[: int(limit)]

    total = len(post_ids)
    analyzed = 0
    skipped: list[dict] = []
    errored: list[dict] = []
    first_error: str | None = None

    def _log(msg: str) -> None:
        if progress:
            try:
                progress(msg)
            except Exception:
                pass

    if total == 0:
        _log("no unanalyzed papers for this topic.")
        return {"ok": True, "analyzed": 0, "skipped": [], "errored": [], "total": 0}

    _log(f"analyzing {total} paper{'s' if total != 1 else ''} for '{topic}'…")
    for i, pid in enumerate(post_ids, 1):
        _log(f"[{i}/{total}] {pid}")
        try:
            r = analyze_paper(topic, pid, force=force)
        except Exception as e:
            errored.append({"post_id": pid, "error": str(e)})
            first_error = first_error or str(e)
            continue
        if r.get("ok"):
            analyzed += 1
            if r.get("cached"):
                _log(f"  ↳ cached (no LLM call)")
            else:
                _log(f"  ↳ ✓ {r.get('takeaway', '')[:80]}")
        elif r.get("skipped"):
            skipped.append({"post_id": pid, "reason": r.get("reason", "")})
            _log(f"  ↳ skipped: {r.get('reason', '')}")
            # A provider-missing skip will hit every paper — bail early.
            if "no LLM" in str(r.get("reason", "")).lower() \
               or "api_key" in str(r.get("reason", "")).lower():
                _log("bailing: no LLM configured")
                break
        else:
            errored.append({"post_id": pid, "error": r.get("error", "unknown")})
            first_error = first_error or r.get("error", "unknown")

    _log(f"done. analyzed={analyzed} skipped={len(skipped)} errored={len(errored)}")
    return {
        "ok": True,
        "analyzed": analyzed,
        "skipped": skipped,
        "errored": errored,
        "total": total,
        "first_error": first_error,
    }


def get_analyses(topic: str) -> list[dict[str, Any]]:
    """Return all analyses for academic papers under this topic."""
    db = get_db()
    rows = list(db.query(
        "SELECT pa.post_id, pa.topic, pa.summary, pa.relevance, pa.takeaway, "
        "pa.ts, pa.provider, pa.model, p.title "
        "FROM paper_analyses pa LEFT JOIN posts p ON p.id = pa.post_id "
        "WHERE pa.topic = ? "
        "ORDER BY pa.ts DESC",
        [topic],
    ))
    return rows
