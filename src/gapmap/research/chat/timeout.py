"""Wall-clock timeout wrapper for blocking palace/ChromaDB calls.

The palace store is NOT safe for concurrent cross-process access: while a collect
runs, the long-lived `enrich-worker --serve` process upserts embeddings into the
SAME `palace/chroma.sqlite3` + HNSW index, and a chat's inline read
(`stats()` / `search_posts()`) can then block on the writer's lock for the whole
duration of the collect — surfacing as "chat hangs while a collection is going".
Bounding the read converts that indefinite hang into a short, graceful degrade.

Extracted from the old monolithic chat.py so the timeout behaviour can be
unit-tested in isolation (see tests/test_chat_timeout.py).
"""
from __future__ import annotations

import os
import threading
from typing import Any, Callable

# Env-tunable for slow disks. Default 3 s — a warm semantic query returns in
# <1 s, so 3 s only trips under real contention.
PALACE_CHAT_TIMEOUT = float(os.environ.get("GAPMAP_PALACE_CHAT_TIMEOUT") or 3.0)


def call_with_timeout(fn: Callable[[], Any], timeout_s: float) -> tuple[bool, Any]:
    """Run a blocking palace/ChromaDB call under a wall-clock ceiling.

    Returns (True, result) if `fn` finished in time, else (False, None) on
    timeout OR any exception. On timeout the worker thread is left running as a
    daemon — it can't be force-killed, but it's harmless: it finishes its
    ChromaDB read once the writer releases the store, then exits. We never block
    waiting for it (that's the whole point), so we do NOT use a
    ThreadPoolExecutor `with`-block here — its __exit__ calls shutdown(wait=True),
    which would re-introduce the very hang we're killing.
    """
    box: dict = {}

    def _run() -> None:
        try:
            box["v"] = fn()
        except Exception as e:  # noqa: BLE001 — any failure → SQL fallback
            box["e"] = e

    t = threading.Thread(target=_run, name="palace-chat-lookup", daemon=True)
    t.start()
    t.join(timeout_s)
    if t.is_alive() or "e" in box:
        return False, None
    return True, box.get("v")


# Backward-compatible aliases (old private names used across the chat package).
_PALACE_CHAT_TIMEOUT = PALACE_CHAT_TIMEOUT
_call_with_timeout = call_with_timeout
