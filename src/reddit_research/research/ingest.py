"""Topic-scoped ingest helpers.

Single-file ingest (TXT / PDF / MD / JSON / VTT / SRT / CSV-with-generic-
columns) is already covered by ``reddit_research.sources.local_file``. This
module adds a *structured* CSV path tailored to the post schema — columns
that mirror what a Reddit fetch would have produced (post_id, title, body,
author, url, created_utc, source_type). Missing columns are tolerated
except ``title``; everything else has a sensible fallback.

Why a second entry point: the generic ``_parse_csv`` in ``local_file.py``
coalesces 'text' / 'body' / 'message' and synthesises IDs. For bulk export
from another research repo (where post ids already exist) we want to
preserve them, so the same URL / ID doesn't duplicate on re-ingest.
"""
from __future__ import annotations

import csv
import hashlib
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _stable_id(prefix: str, content: str) -> str:
    h = hashlib.sha1(content.encode("utf-8", errors="ignore")).hexdigest()[:12]
    return f"{prefix}_{h}"


def _parse_created(ts: Any) -> float:
    if ts is None or ts == "":
        return 0.0
    s = str(ts).strip()
    # ISO-8601 first (with or without Z).
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
    except (ValueError, TypeError):
        pass
    try:
        return float(s)
    except (ValueError, TypeError):
        return 0.0


def _row_from_csv(
    r: dict,
    *,
    source_type_default: str,
    sub: str,
) -> dict[str, Any] | None:
    """Map one CSV row → canonical post dict, or None to skip (no title)."""
    title = (r.get("title") or "").strip()
    if not title:
        return None
    body = (r.get("body") or r.get("selftext") or r.get("text") or "").strip()
    src_type = (r.get("source_type") or source_type_default or "csv").strip() or "csv"
    url = (r.get("url") or r.get("permalink") or "").strip()
    author = (r.get("author") or "").strip() or "[csv]"
    created = _parse_created(r.get("created_utc") or r.get("created_at") or r.get("date"))
    pid = (r.get("post_id") or r.get("id") or "").strip()
    if not pid:
        content_key = f"{src_type}|{sub}|{title}|{body[:200]}|{url}"
        pid = _stable_id(src_type, content_key)
    return {
        "id": pid,
        "sub": sub,
        "source_type": src_type,
        "author": author,
        "title": title[:300],
        "selftext": body[:5000],
        "url": url,
        "score": int(r.get("score") or 0) if str(r.get("score") or "").strip() else 0,
        "upvote_ratio": None,
        "num_comments": int(r.get("num_comments") or 0) if str(r.get("num_comments") or "").strip() else 0,
        "created_utc": created,
        "is_self": 1,
        "over_18": 0,
        "flair": r.get("flair") or None,
        "permalink": url or None,
        "fetched_at": _now_iso(),
    }


def ingest_csv(
    path: str | Path,
    topic: str,
    source_type_default: str = "csv",
    *,
    dry_run: bool = False,
) -> dict[str, Any]:
    """Bulk CSV ingest with the canonical post-column set.

    Expected headers: ``post_id, title, body, author, url, created_utc,
    source_type``. Everything but ``title`` is tolerated missing. Each row
    gets upserted into ``posts`` and tagged into ``topic_posts`` via the
    existing ``_tag_posts`` path (which runs the relevance gate).

    Args:
        path: path to the CSV file.
        topic: topic to tag each post under.
        source_type_default: fallback value for rows missing a source_type.
        dry_run: if True, parse + return counts but skip DB writes.

    Returns:
        ``{"ok": bool, "parsed": N, "skipped": N, "tagged": N, "dry_run": bool, "path": str, "topic": str}``.
    """
    p = Path(path).expanduser()
    if not p.exists():
        raise FileNotFoundError(p)
    if p.suffix.lower() != ".csv":
        raise ValueError(f"ingest_csv expects a .csv file, got {p.suffix!r}")

    sub = f"csv:{p.stem}"
    rows: list[dict] = []
    skipped = 0
    with p.open(encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for r in reader:
            row = _row_from_csv(r, source_type_default=source_type_default, sub=sub)
            if row is None:
                skipped += 1
                continue
            rows.append(row)

    parsed = len(rows)
    result = {
        "ok": True,
        "parsed": parsed,
        "skipped": skipped,
        "tagged": 0,
        "dry_run": dry_run,
        "path": str(p),
        "topic": topic,
    }
    if dry_run or parsed == 0:
        return result

    # Lazy imports to keep this module cheap when only dry-running.
    from ..core.db import log_fetch_end, log_fetch_start, upsert_posts
    from .collect import _tag_posts

    fid = log_fetch_start(
        "csv_ingest", {"path": str(p), "topic": topic, "source_type": source_type_default}
    )
    try:
        upsert_posts(rows)
        tagged = _tag_posts(topic, [r["id"] for r in rows], source=f"csv:{p.name}")
        result["tagged"] = tagged
        log_fetch_end(fid, rows=tagged)
    except Exception as e:
        log_fetch_end(fid, rows=0, error=str(e))
        raise
    return result
