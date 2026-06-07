"""Literature-review matrix — the classic PhD comparison grid.

For each academic paper in a topic, an LLM extracts a structured row:
  method · data/dataset · sample/participants · key findings · limitations · metric

Rows are cached per (topic, post_id) in the ``lit_matrix`` table so a re-run
only processes new papers. The UI renders them as a sortable/filterable/
exportable table — the literature-review matrix every researcher builds by hand.

Reuses the abstract-or-full-text content tier and the BYOK provider + defensive
JSON parsing from ``paper_analyze``. Skips gracefully when no LLM is configured.
"""
from __future__ import annotations

import json as _json
import os
import re as _re
from datetime import datetime, timezone
from typing import Any

from ..core.db import get_db

_ACADEMIC_SOURCES = ("arxiv", "openalex", "pubmed", "scholar",
                     "semantic_scholar", "crossref", "europepmc", "dblp")

# The matrix columns. Order matters — it's the table column order in the UI.
FIELDS = ["method", "dataset", "sample", "findings", "limitations", "metric"]

_SYSTEM = (
    "You build literature-review matrices. You read one paper and extract a "
    "compact, comparable row of structured fields. Return JSON only — no prose."
)

_USER_TMPL = (
    'Topic: "{topic}"\n'
    'Paper title: "{title}"\n'
    'Paper text (may be truncated):\n"""\n{body}\n"""\n\n'
    "Extract a literature-review row as JSON with EXACTLY these keys:\n"
    "{{\n"
    '  "method": "<the approach / study design / model, in <=12 words>",\n'
    '  "dataset": "<data or corpus used, or n/a>",\n'
    '  "sample": "<sample size / participants / scale, or n/a>",\n'
    '  "findings": "<the 1-2 most important concrete findings, <=24 words>",\n'
    '  "limitations": "<key limitation(s) the authors note or that are evident, or n/a>",\n'
    '  "metric": "<headline metric / effect size / result number, or n/a>"\n'
    "}}\n\n"
    "Rules: be specific and quantitative when the text is. Use \"n/a\" when a "
    "field genuinely isn't present. No restating the title. JSON only."
)


def _ensure_table() -> None:
    db = get_db()
    db.execute(
        "CREATE TABLE IF NOT EXISTS lit_matrix ("
        " post_id TEXT NOT NULL,"
        " topic TEXT NOT NULL,"
        " method TEXT, dataset TEXT, sample TEXT,"
        " findings TEXT, limitations TEXT, metric TEXT,"
        " content_tier TEXT, ts TEXT, provider TEXT, model TEXT,"
        " PRIMARY KEY (topic, post_id))"
    )
    db.conn.commit()


def _parse(raw: str) -> dict | None:
    text = (raw or "").strip()
    for attempt in (
        lambda: _json.loads(text),
        lambda: _json.loads(text.strip("`").lstrip("json").strip()),
        lambda: (_json.loads(_re.search(r"\{.*\}", text, _re.DOTALL).group(0))
                 if _re.search(r"\{.*\}", text, _re.DOTALL) else None),
    ):
        try:
            p = attempt()
            if isinstance(p, dict):
                return p
        except Exception:
            continue
    return None


def _papers_for_topic(topic: str, limit: int | None = None) -> list[dict]:
    db = get_db()
    placeholders = ",".join("?" for _ in _ACADEMIC_SOURCES)
    rows = list(db.query(
        "SELECT p.id, p.title FROM posts p JOIN topic_posts tp ON tp.post_id = p.id"
        f" WHERE tp.topic = ? AND coalesce(p.source_type,'reddit') IN ({placeholders})"
        " ORDER BY coalesce(p.score,0) DESC",
        [topic, *_ACADEMIC_SOURCES],
    ))
    return rows[: int(limit)] if limit else rows


def build_row(topic: str, post_id: str, *, force: bool = False) -> dict[str, Any]:
    """Extract (or return cached) one matrix row for a paper."""
    _ensure_table()
    db = get_db()
    if not force:
        existing = list(db.query(
            "SELECT * FROM lit_matrix WHERE topic = ? AND post_id = ?", [topic, post_id]))
        if existing:
            return {"ok": True, "cached": True, **existing[0]}

    prow = list(db.query("SELECT id, title, coalesce(selftext,'') AS abstract FROM posts WHERE id = ?", [post_id]))
    if not prow:
        return {"ok": False, "error": f"no paper {post_id}"}
    title = prow[0]["title"] or ""

    try:
        from ..analyze.providers.base import get_provider, resolve_provider
        provider_name = resolve_provider(None)
        provider = get_provider()
    except Exception as e:
        return {"ok": False, "skipped": True, "reason": str(e), "post_id": post_id}

    try:
        from .paper_fulltext import get_full_text_or_abstract
        cp = get_full_text_or_abstract(post_id, max_chars=24_000)
        body = cp.get("text") or prow[0]["abstract"] or ""
        tier = cp.get("tier", "abstract")
    except Exception:
        body = prow[0]["abstract"] or ""
        tier = "abstract"

    try:
        raw = provider.complete(
            prompt=_USER_TMPL.format(topic=topic, title=title, body=body[:24_000]),
            system=_SYSTEM, max_tokens=400, temperature=0.2,
        )
    except Exception as e:
        return {"ok": False, "error": f"llm call failed: {e}", "post_id": post_id}

    parsed = _parse(raw)
    if parsed is None:
        return {"ok": False, "skipped": True, "reason": "parse_failed", "post_id": post_id}

    row = {
        "post_id": post_id, "topic": topic,
        "content_tier": tier, "ts": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "provider": provider_name, "model": os.getenv("LLM_MODEL") or "",
    }
    for f in FIELDS:
        row[f] = str(parsed.get(f) or "n/a").strip()[:400]
    db.execute(
        "INSERT INTO lit_matrix(post_id,topic,method,dataset,sample,findings,limitations,metric,content_tier,ts,provider,model)"
        " VALUES(?,?,?,?,?,?,?,?,?,?,?,?)"
        " ON CONFLICT(topic,post_id) DO UPDATE SET method=excluded.method, dataset=excluded.dataset,"
        " sample=excluded.sample, findings=excluded.findings, limitations=excluded.limitations,"
        " metric=excluded.metric, content_tier=excluded.content_tier, ts=excluded.ts,"
        " provider=excluded.provider, model=excluded.model",
        [post_id, topic, row["method"], row["dataset"], row["sample"], row["findings"],
         row["limitations"], row["metric"], tier, row["ts"], row["provider"], row["model"]],
    )
    db.conn.commit()
    return {"ok": True, "cached": False, "content_tier": tier, **row}


def build(topic: str, *, limit: int | None = None, force: bool = False, progress=None) -> dict[str, Any]:
    """Build the matrix for a topic's papers (highest-cited first).

    PROGRESSIVE by default: only papers that don't yet have a row are processed,
    capped at ``limit`` — so a click on a 273-paper topic builds the next batch
    instead of running hundreds of LLM calls and appearing to hang. Re-running
    picks up where it left off. ``force=True`` re-extracts the top ``limit``.

    Returns ``{ok, built, cached, errored, total, total_topic, remaining}``.
    """
    _ensure_table()
    db = get_db()
    all_papers = _papers_for_topic(topic)            # all academic papers, score-desc
    total_topic = len(all_papers)
    if force:
        papers = all_papers[: int(limit)] if limit else all_papers
    else:
        have = {r["post_id"] for r in db.query(
            "SELECT post_id FROM lit_matrix WHERE topic = ?", [topic])}
        todo = [p for p in all_papers if p["id"] not in have]
        papers = todo[: int(limit)] if limit else todo
    total = len(papers)
    built = cached = errored = 0

    def _log(m: str) -> None:
        if progress:
            try: progress(m)
            except Exception: pass

    if total == 0:
        reason = ("no academic papers for this topic" if total_topic == 0
                  else "all papers already in the matrix")
        return {"ok": True, "built": 0, "cached": 0, "errored": 0, "total": 0,
                "total_topic": total_topic, "remaining": 0, "reason": reason}
    _log(f"building lit-matrix for {total} of {total_topic} papers…")
    for i, p in enumerate(papers, 1):
        _log(f"[{i}/{total}] {p['id']}")
        r = build_row(topic, p["id"], force=force)
        if r.get("ok") and r.get("cached"):
            cached += 1
        elif r.get("ok"):
            built += 1
        else:
            errored += 1
            if "no LLM" in str(r.get("reason", "")).lower() or "api_key" in str(r.get("reason", "")).lower():
                _log("bailing: no LLM configured")
                break
    remaining = max(0, total_topic - len(list(db.query(
        "SELECT post_id FROM lit_matrix WHERE topic = ?", [topic]))))
    return {"ok": True, "built": built, "cached": cached, "errored": errored,
            "total": total, "total_topic": total_topic, "remaining": remaining}


def get(topic: str) -> dict[str, Any]:
    """Return the matrix rows for a topic (joined with title), newest first."""
    _ensure_table()
    db = get_db()
    rows = list(db.query(
        "SELECT lm.post_id, p.title AS title, coalesce(p.source_type,'') AS source_type,"
        " lm.method, lm.dataset, lm.sample, lm.findings, lm.limitations, lm.metric,"
        " lm.content_tier, lm.ts FROM lit_matrix lm"
        " LEFT JOIN posts p ON p.id = lm.post_id WHERE lm.topic = ?"
        " ORDER BY lm.ts DESC",
        [topic],
    ))
    return {"ok": True, "count": len(rows), "fields": FIELDS, "rows": rows}


def export_csv(topic: str) -> dict[str, Any]:
    """Matrix as CSV text (title + the 6 fields)."""
    import csv
    import io
    data = get(topic)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["title", *FIELDS])
    for r in data["rows"]:
        w.writerow([r.get("title", ""), *[r.get(f, "") for f in FIELDS]])
    return {"ok": True, "topic": topic, "count": data["count"], "csv": buf.getvalue()}


__all__ = ["build", "build_row", "get", "export_csv", "FIELDS"]
