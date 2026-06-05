"""Regression: chat must not hang when a collect holds the ChromaDB palace.

Root cause (2026-06-02): during a collect, the long-lived `enrich-worker
--serve` process upserts embeddings into the SAME `palace/chroma.sqlite3` +
HNSW index that chat reads. ChromaDB's persistent store is not safe for
concurrent cross-process access, so chat's inline `_semantic_evidence`
(stats + search_posts) blocked on the writer's lock for the whole collect —
surfacing as "chat hangs while a collection is going". The fix bounds the
palace read and falls back to engagement-ranked SQL retrieval on timeout.
"""
import time

from gapmap.research import chat


def _patch_palace(monkeypatch, *, search_impl, stats_impl):
    import gapmap.retrieval.palace as palace
    monkeypatch.setattr(palace, "is_available", lambda: True)
    monkeypatch.setattr(palace, "is_model_ready", lambda: True)
    monkeypatch.setattr(palace, "stats", stats_impl)
    monkeypatch.setattr(palace, "search_posts", search_impl)


def test_blocking_palace_falls_back_fast(monkeypatch):
    """A palace query that blocks (collect holding the store) must NOT hang
    the chat — it returns the SQL-fallback sentinel within the ceiling."""
    def _blocking(**_kw):
        time.sleep(30)  # simulate the writer holding the ChromaDB lock
        return {"ok": True, "results": [{"id": "x"}]}

    # stats gate must pass so we actually reach the (blocking) search.
    _patch_palace(
        monkeypatch,
        search_impl=_blocking,
        stats_impl=lambda: {"by_topic": {"topic": 5}},
    )
    # _semantic_evidence now lives in chat/retrieval_context.py and reads the
    # timeout from that module's namespace — patch it where it's used.
    monkeypatch.setattr(chat.retrieval_context, "_PALACE_CHAT_TIMEOUT", 0.5)

    t0 = time.time()
    posts, label = chat._semantic_evidence("topic", "any question", 8)
    elapsed = time.time() - t0

    assert posts == [] and label == ""          # degraded to SQL fallback
    assert elapsed < 3.0, f"chat blocked {elapsed:.1f}s — timeout not honored"


def test_fast_palace_not_penalized(monkeypatch):
    """When the palace is free, an empty/normal result returns immediately
    (no spurious delay from the timeout wrapper)."""
    _patch_palace(
        monkeypatch,
        search_impl=lambda **_kw: {"ok": True, "results": []},
        stats_impl=lambda: {"by_topic": {"topic": 5}},
    )
    monkeypatch.setattr(chat.retrieval_context, "_PALACE_CHAT_TIMEOUT", 3.0)

    t0 = time.time()
    posts, label = chat._semantic_evidence("topic", "any question", 8)
    elapsed = time.time() - t0

    assert posts == [] and label == ""
    assert elapsed < 1.0, f"fast path took {elapsed:.1f}s — wrapper overhead too high"
