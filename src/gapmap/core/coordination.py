"""Cross-process chat ⇄ enrich-worker coordination.

The enrich-worker (`research enrich-worker --serve`) upserts embeddings into
the ChromaDB *memory palace* while a collect drains the extraction queue. Chat
reads the SAME palace store from a DIFFERENT process. ChromaDB's persistent
store isn't safe for concurrent cross-process access, so the worker's writes
can starve a live chat — forcing it to fall back to engagement-ranked SQL
retrieval (or, before the read timeout landed, hang).

This module is a tiny heartbeat protocol so the worker can *yield* while a chat
is actively reading the palace:

  * chat calls ``mark_chat_active()`` around each palace read (a cheap touch of
    a flag file with the current time).
  * the worker calls ``is_chat_active()`` before draining a batch and defers
    (short nap, rows stay queued) while the heartbeat is fresh — with a
    starvation cap in the worker so enrichment still progresses during
    continuous chatting.

Everything here is best-effort: any failure degrades to "not coordinating"
(the read-timeout fallback in chat still prevents a hang), never an error.
"""
from __future__ import annotations

import os
import time
from pathlib import Path

# How long a single heartbeat keeps "chat active" true. A warm palace read
# returns in <1 s; chat refreshes the beat on every read, so this only needs to
# bridge the gap between consecutive reads within one chat turn plus a short
# tail. Env-tunable.
_DEFAULT_TTL = float(os.environ.get("GAPMAP_CHAT_ACTIVE_TTL") or 10.0)

_FLAG_PATH: Path | None = None


def _flag_path() -> Path | None:
    """`<data_dir>/.chat_active` — sibling of gapmap.db. Cached after first
    resolve; returns None if config can't be read (coordination then no-ops)."""
    global _FLAG_PATH
    if _FLAG_PATH is not None:
        return _FLAG_PATH
    try:
        from .config import load_config
        _FLAG_PATH = Path(load_config().db_path).parent / ".chat_active"
    except Exception:
        return None
    return _FLAG_PATH


def mark_chat_active() -> None:
    """Heartbeat — call around any palace read in the chat process."""
    p = _flag_path()
    if p is None:
        return
    try:
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(str(time.time()))
    except Exception:
        pass  # best-effort; coordination is an optimization, never required


def is_chat_active(ttl: float = _DEFAULT_TTL) -> bool:
    """True if a chat heartbeat landed within ``ttl`` seconds."""
    p = _flag_path()
    if p is None:
        return False
    try:
        if not p.exists():
            return False
        return (time.time() - p.stat().st_mtime) < ttl
    except Exception:
        return False
