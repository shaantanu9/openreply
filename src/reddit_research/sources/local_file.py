"""Local-file ingest — private-signal gap closer.

Addresses three CHRONIC painpoints from the UX-research corpus:
  - "Customer signal in Slack/tickets never reaches the research repo"
  - "No single source of truth across CRM/Slack/calls/tickets"
  - The DIY workaround of "#customer-voice Slack channel IS our research repo"

By letting users drop their own exports (CSV of interviews, TXT of Slack
messages, VTT/SRT of call transcripts), private-signal flows into the graph
alongside Reddit/HN/App Store data — triangulation finally includes what
your users actually said to you.

Supported formats:
  .csv        — expects columns: text (required); optionally title, author, score, created_at, url
  .json       — list of dicts with the same keys
  .txt        — each blank-line-separated paragraph becomes a row
  .vtt / .srt — subtitle formats (call transcripts); each caption becomes a row
  .md         — top-level headers become titles, each block becomes a row
"""
from __future__ import annotations

import csv
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _hash_id(prefix: str, content: str) -> str:
    h = hashlib.sha1(content.encode("utf-8", errors="ignore")).hexdigest()[:12]
    return f"{prefix}_{h}"


def _row(
    *,
    source_type: str,
    sub: str,
    text: str,
    title: str | None = None,
    author: str | None = None,
    score: int | None = None,
    url: str | None = None,
    created_utc: float | None = None,
) -> dict[str, Any]:
    """Build a post row in the canonical shape."""
    content_key = f"{source_type}|{sub}|{(title or '')}|{text[:200]}"
    return {
        "id": _hash_id(source_type, content_key),
        "sub": sub,
        "source_type": source_type,
        "author": author or "[local]",
        "title": (title or "")[:300],
        "selftext": (text or "")[:5000],
        "url": url or "",
        "score": int(score) if score is not None else 0,
        "upvote_ratio": None,
        "num_comments": 0,
        "created_utc": float(created_utc) if created_utc is not None else 0.0,
        "is_self": 1,
        "over_18": 0,
        "flair": None,
        "permalink": url,
        "fetched_at": _now_iso(),
    }


# ── format parsers ──────────────────────────────────────────────────────────

def _parse_csv(path: Path, source_type: str, sub: str) -> list[dict]:
    rows: list[dict] = []
    with path.open(encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for r in reader:
            text = (r.get("text") or r.get("body") or r.get("message") or "").strip()
            if not text:
                continue
            ts_str = r.get("created_at") or r.get("date") or r.get("timestamp")
            created = 0.0
            if ts_str:
                try:
                    created = datetime.fromisoformat(str(ts_str).replace("Z", "+00:00")).timestamp()
                except (ValueError, TypeError):
                    try:
                        created = float(ts_str)
                    except (ValueError, TypeError):
                        pass
            rows.append(_row(
                source_type=source_type, sub=sub,
                text=text,
                title=r.get("title") or r.get("subject"),
                author=r.get("author") or r.get("user") or r.get("username"),
                score=r.get("score") or r.get("rating") or 0,
                url=r.get("url") or r.get("link") or r.get("permalink"),
                created_utc=created,
            ))
    return rows


def _parse_json(path: Path, source_type: str, sub: str) -> list[dict]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, dict):
        data = data.get("messages") or data.get("rows") or data.get("data") or [data]
    rows: list[dict] = []
    for d in data or []:
        if not isinstance(d, dict):
            continue
        text = (d.get("text") or d.get("body") or d.get("message") or "").strip()
        if not text:
            continue
        rows.append(_row(
            source_type=source_type, sub=sub, text=text,
            title=d.get("title"), author=d.get("author") or d.get("user"),
            score=d.get("score") or 0,
            url=d.get("url") or d.get("link"),
            created_utc=d.get("created_utc") or 0,
        ))
    return rows


def _parse_txt(path: Path, source_type: str, sub: str) -> list[dict]:
    raw = path.read_text(encoding="utf-8", errors="replace")
    paragraphs = [p.strip() for p in re.split(r"\n{2,}", raw) if p.strip()]
    return [
        _row(source_type=source_type, sub=sub, text=p, title=p.splitlines()[0][:100])
        for p in paragraphs
    ]


def _parse_vtt(path: Path, source_type: str, sub: str) -> list[dict]:
    """WebVTT / SRT transcript parser — each caption is a row."""
    raw = path.read_text(encoding="utf-8", errors="replace")
    # Both VTT and SRT: blocks separated by blank lines, first line cue id or
    # start-->end timestamp. Caption text follows.
    blocks = re.split(r"\n{2,}", raw.strip())
    rows: list[dict] = []
    for b in blocks:
        lines = [line.strip() for line in b.splitlines() if line.strip()]
        if not lines or lines[0].upper() in ("WEBVTT",) or lines[0].startswith("NOTE "):
            continue
        # Skip numeric cue id
        if lines[0].isdigit():
            lines = lines[1:]
        # Skip timestamp line
        if lines and "-->" in lines[0]:
            ts_line = lines[0]
            lines = lines[1:]
        else:
            ts_line = ""
        if not lines:
            continue
        text = " ".join(lines)
        rows.append(_row(
            source_type=source_type, sub=sub, text=text, title=ts_line[:60] or None,
        ))
    return rows


def _parse_md(path: Path, source_type: str, sub: str) -> list[dict]:
    raw = path.read_text(encoding="utf-8", errors="replace")
    # Split on top-level headers (# or ##)
    chunks = re.split(r"\n(?=#{1,2} )", raw)
    rows: list[dict] = []
    for chunk in chunks:
        chunk = chunk.strip()
        if not chunk:
            continue
        m = re.match(r"^(#{1,2})\s+(.+?)\n", chunk)
        title = m.group(2).strip() if m else None
        text = chunk[m.end():].strip() if m else chunk
        if not text:
            continue
        rows.append(_row(source_type=source_type, sub=sub, text=text, title=title))
    return rows


_PARSERS = {
    ".csv": _parse_csv,
    ".json": _parse_json,
    ".txt": _parse_txt,
    ".vtt": _parse_vtt,
    ".srt": _parse_vtt,
    ".md": _parse_md,
}


# ── public API ──────────────────────────────────────────────────────────────

def ingest_file(
    path: str | Path,
    source_type: str = "local",
    sub: str | None = None,
) -> list[dict]:
    """Parse a local file into post rows. Format detected by extension.

    Args:
        path: file path.
        source_type: free-form tag, e.g. 'slack_export', 'interviews', 'gong_calls'.
        sub: sub identifier (defaults to '<source_type>:<filename>').
    """
    p = Path(path).expanduser()
    if not p.exists():
        raise FileNotFoundError(p)
    ext = p.suffix.lower()
    parser = _PARSERS.get(ext)
    if not parser:
        raise ValueError(
            f"Unsupported extension {ext!r}. Supported: {list(_PARSERS.keys())}"
        )
    sub_final = sub or f"{source_type}:{p.stem}"
    return parser(p, source_type, sub_final)


def ingest_and_persist(
    path: str | Path,
    topic: str,
    source_type: str = "local",
    sub: str | None = None,
) -> int:
    """Parse + upsert + tag under topic. Returns rows tagged."""
    from ..core.db import log_fetch_end, log_fetch_start, upsert_posts
    from ..research.collect import _tag_posts

    fid = log_fetch_start(
        "local_file", {"path": str(path), "source_type": source_type, "topic": topic}
    )
    try:
        rows = ingest_file(path=path, source_type=source_type, sub=sub)
        if rows:
            upsert_posts(rows)
            n = _tag_posts(topic, [r["id"] for r in rows], source=f"local:{Path(path).name}")
        else:
            n = 0
        log_fetch_end(fid, rows=n)
        return n
    except Exception as e:
        log_fetch_end(fid, rows=0, error=str(e))
        raise
