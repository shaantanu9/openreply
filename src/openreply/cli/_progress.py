"""Map collect/learn human progress strings to structured stream events.

Kept pure + separately testable so the `agent refresh --stream` UI has a stable
event contract instead of the frontend regex-parsing free-text. The non-stream
CLI path still prints the original strings; this only runs for --stream."""
from __future__ import annotations

import re

# "[19/23] [hn] ✓ 125 posts (60.3s)"
_SRC_DONE = re.compile(r"\[(\d+)/(\d+)\]\s*\[([^\]]+)\]\s*✓\s*(\d+)\s*posts")
# "  ! [youtube] ✗ timed out after 240s — skipped"
_SRC_ERR = re.compile(r"\[([^\]]+)\]\s*✗")


def to_structured_event(msg: str) -> dict:
    s = (msg or "").strip()
    m = _SRC_DONE.search(s)
    if m:
        return {"event": "source", "name": m.group(3), "status": "done",
                "count": int(m.group(4)), "index": int(m.group(1)), "total": int(m.group(2))}
    m = _SRC_ERR.search(s)
    if m:
        return {"event": "source", "name": m.group(1), "status": "error"}
    low = s.lower()
    if low.startswith("canonicalizing"):
        return {"event": "phase", "name": "canonicalize"}
    if low.startswith("learning"):
        return {"event": "phase", "name": "learn"}
    return {"event": "log", "msg": s}
