"""Transcript chunker — groups consecutive whisper segments into ≤N-char
blocks while preserving the first/last timestamps so "jump to quote" links
stay accurate.

The whisper-segment shape is duck-typed: any object with ``.start``,
``.end``, ``.text`` attributes works (works for both our ``Segment``
dataclass and `faster_whisper.transcribe.Segment` directly)."""
from __future__ import annotations

from typing import Iterable


def _text_of(s) -> str:
    return (s.text if hasattr(s, "text") else s["text"]).strip()


def _start_of(s) -> float:
    return float(s.start if hasattr(s, "start") else s["start"])


def _end_of(s) -> float:
    return float(s.end if hasattr(s, "end") else s["end"])


def chunk_segments(segments: Iterable, max_chars: int = 500) -> list[dict]:
    """Return a list of ``{chunk_idx, text, timestamp_start, timestamp_end}``.

    Breaks at sentence boundaries where possible — we greedily pack segments
    until the next one would exceed ``max_chars``. Segments longer than
    ``max_chars`` on their own are emitted as a single chunk (we never split
    a segment's text — keeps the timestamp accurate to the word).
    """
    segs = list(segments)
    if not segs:
        return []

    out: list[dict] = []
    cur_text: list[str] = []
    cur_start: float | None = None
    cur_end: float | None = None

    for s in segs:
        t = _text_of(s)
        if not t:
            continue
        st, en = _start_of(s), _end_of(s)
        tentative_len = sum(len(x) + 1 for x in cur_text) + len(t)
        if cur_text and tentative_len > max_chars:
            out.append({
                "chunk_idx": len(out),
                "text": " ".join(cur_text).strip(),
                "timestamp_start": cur_start if cur_start is not None else 0.0,
                "timestamp_end":   cur_end   if cur_end   is not None else 0.0,
            })
            cur_text, cur_start, cur_end = [], None, None
        if cur_start is None:
            cur_start = st
        cur_end = en
        cur_text.append(t)

    if cur_text:
        out.append({
            "chunk_idx": len(out),
            "text": " ".join(cur_text).strip(),
            "timestamp_start": cur_start if cur_start is not None else 0.0,
            "timestamp_end":   cur_end   if cur_end   is not None else 0.0,
        })
    return out


def segments_to_srt(segments: Iterable) -> str:
    """Emit SubRip subtitle format from whisper segments. One block per segment."""
    def fmt(t: float) -> str:
        t = max(0.0, float(t))
        h, r = divmod(int(t), 3600)
        m, sec = divmod(r, 60)
        ms = int((t - int(t)) * 1000)
        return f"{h:02d}:{m:02d}:{sec:02d},{ms:03d}"

    lines: list[str] = []
    for i, s in enumerate(segments, 1):
        text = _text_of(s)
        if not text:
            continue
        lines.append(str(i))
        lines.append(f"{fmt(_start_of(s))} --> {fmt(_end_of(s))}")
        lines.append(text)
        lines.append("")
    return "\n".join(lines)
