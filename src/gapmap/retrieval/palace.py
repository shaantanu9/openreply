"""Posts-corpus retrieval via ChromaDB (local, offline, single-file SQLite).

Pattern adapted from mempalace (github/mempalace). Stores one vector per post
alongside lightweight metadata (topic, source_type, sub, created_utc, url),
runs pure-vector + BM25-rerank hybrid search, and caches the HNSW index in
``<data_dir>/palace/chroma.sqlite3``.

**Graceful degradation:** if ``chromadb`` isn't installed, every public
function returns a skip-stub so the caller can keep functioning without the
retrieval layer. The optional `retrieval` extras group pulls it in.

**Offline-first:** uses ChromaDB's bundled `all-MiniLM-L6-v2` ONNX embedder.
Zero external API calls. First-use cold start is ~2–5 s (ONNX compile);
subsequent queries complete in ~15–30 ms p50 on 2K posts.

**Separate file from gapmap.db:** posts stay in sqlite-utils; vectors live
in ``palace/chroma.sqlite3`` next to it. Sync happens opportunistically at
post upsert time (see ``core.db.upsert_posts`` hook) and can be force-
refreshed via ``reindex_all()``.
"""
from __future__ import annotations

import logging
import math
import os
import threading
import time
from typing import Any, Iterable

from ..core.config import load_config

logger = logging.getLogger(__name__)


# Module-level state — we want the ChromaDB PersistentClient + collection
# cached, since cold-start is ~2–5 s. Keyed by data_dir so multiple test
# palaces don't collide.
#
# The historical name ``_CLIENT_CACHE`` is kept for back-compat; callers
# that need to drop the cache should use ``_drop_client_if_any()`` below,
# which handles multi-keyed caches and client teardown safely.
_CLIENT_CACHE: dict[str, Any] = {}
_LOCK = threading.Lock()

# Incremental-enrichment (2026-04-21, Task 4): lazy memory eviction for the
# ChromaDB singleton. The ONNX + client together pin ~150–200 MB of RSS; on
# a long-idle worker that balloon becomes the dominant process cost. Every
# embed-path function updates ``_LAST_EMBED_TS``; on next access, if we've
# been idle for more than ``_IDLE_EVICT_SECS`` we drop the cache before
# re-initializing. Pure lazy — no background timer thread to manage.
_LAST_EMBED_TS: float = 0.0
_IDLE_EVICT_SECS: float = 300.0  # 5 minutes


def _drop_client_if_any() -> None:
    """Drop every cached ChromaDB PersistentClient + its collection.

    Called by the enrichment worker's memory governor when RSS crosses its
    ceiling, and lazily by ``_maybe_evict_idle`` after long idle periods.

    Each entry in ``_CLIENT_CACHE`` is a ``(client, collection)`` tuple.
    ``client.reset()`` would wipe user data, so we only ``clear_system_cache``
    (if available) and drop the reference — the next ``get_palace()`` call
    re-creates a fresh client handle pointing at the same on-disk store.

    Swallows every exception: this runs on a hot path and must never raise.
    """
    global _CLIENT_CACHE
    with _LOCK:
        if not _CLIENT_CACHE:
            return
        for _path, entry in list(_CLIENT_CACHE.items()):
            try:
                client, _coll = entry
            except Exception:
                client = None
            # Best-effort teardown. ChromaDB doesn't expose a public "close",
            # but recent versions have a module-level ``clear_system_cache``
            # that releases the OnxRuntime session + HNSW index from RAM.
            try:
                import chromadb  # type: ignore
                if hasattr(chromadb.api.client.SharedSystemClient, "clear_system_cache"):
                    chromadb.api.client.SharedSystemClient.clear_system_cache()
            except Exception:
                pass
            # Drop our own reference either way — garbage collector handles
            # the rest once the tuple refcount hits zero.
            _ = client
        _CLIENT_CACHE = {}


# HNSW self-heal: when the on-disk vector index is corrupt (most often after
# a hard kill mid-write), Chroma raises errors like "Failed to apply logs to
# the hnsw segment writer" or "InvalidArgumentError: HNSW index". The fix
# is to drop the cached client, move the corrupt segment dirs aside, and
# let the next `get_palace()` rebuild a fresh empty store. The corpus is
# safe — it lives in `posts` / `topic_posts` and `reindex_all()` repopulates.
_HNSW_ERROR_MARKERS = (
    "hnsw segment writer",
    "hnsw index",
    "failed to apply logs",
    "invalidargumenterror: hnsw",
    "could not load",
    "no such file or directory",
    "segment id",
    "corrupt",
)


def _looks_like_hnsw_corruption(err: Exception) -> bool:
    msg = str(err).lower()
    return any(m in msg for m in _HNSW_ERROR_MARKERS)


def heal_corrupt_index() -> dict:
    """Move the on-disk palace dir aside so the next `get_palace()` call
    creates a fresh, empty store. Idempotent. Caller is expected to kick
    off `reindex_all()` afterwards (or let the lazy upsert path repopulate
    incrementally).

    Returns: ``{ok, healed: bool, backup_path?, reason?}``.
    """
    import os as _os
    import time as _time
    _drop_client_if_any()
    try:
        path = _palace_path()
    except Exception as e:
        return {"ok": False, "healed": False, "reason": f"path resolve: {e}"}
    if not _os.path.isdir(path):
        return {"ok": True, "healed": False, "reason": "no palace dir to heal"}
    backup = path.rstrip("/") + f".corrupt_backup_{int(_time.time())}"
    try:
        _os.rename(path, backup)
        _os.makedirs(path, exist_ok=True)
        logger.warning(
            "palace: HNSW index appears corrupt at %s — moved to %s; "
            "next query will return empty until reindex_all() runs.",
            path, backup,
        )
        return {"ok": True, "healed": True, "backup_path": backup}
    except OSError as e:
        return {"ok": False, "healed": False, "reason": f"rename failed: {e}"}


def _maybe_evict_idle() -> None:
    """If the cache has a live client but we haven't embedded in
    ``_IDLE_EVICT_SECS`` seconds, drop it before anyone else touches it.

    Called at the top of every embed-path entry point. Cheap — one monotonic
    read + one dict emptiness check when not idle. Resets ``_LAST_EMBED_TS``
    to "now" after eviction so a cold-start burst doesn't re-trigger the
    same eviction on the next call.
    """
    global _LAST_EMBED_TS
    # No client live or nothing to evict — nothing to do.
    if not _CLIENT_CACHE:
        return
    if _LAST_EMBED_TS <= 0:
        # First-ever embed; just stamp the timer.
        _LAST_EMBED_TS = time.monotonic()
        return
    if (time.monotonic() - _LAST_EMBED_TS) > _IDLE_EVICT_SECS:
        _drop_client_if_any()
        _LAST_EMBED_TS = time.monotonic()


def _bump_embed_ts() -> None:
    """Stamp the idle timer — called after every embed/search/upsert path."""
    global _LAST_EMBED_TS
    _LAST_EMBED_TS = time.monotonic()

# Collection name inside the palace. Kept separate from "memories" etc. in
# case we later want to add a second collection for, say, LLM-extracted
# findings or external document ingests.
_POSTS_COLLECTION = "posts"
# Second collection for academic-paper chunks. One vector per chunk
# (~40 chunks per paper at 1500-char target), with metadata carrying
# (post_id, section, ord) so paper-level rollup works at search time.
# Kept separate from `posts` because the lifecycle, retrieval pattern,
# and scoring are different (one-vector-per-doc vs many-vectors-per-doc).
_PAPER_CHUNKS_COLLECTION = "paper_chunks"

# How much of each post to embed. Empirically, concatenating title +
# first-2kB-of-body is a good tradeoff between recall and ingest throughput:
# most Reddit posts fit; long form essays get truncated but the hook + opener
# is what retrieves them anyway. 2048 chars ≈ 512 tokens ≈ MiniLM limit.
_MAX_EMBED_CHARS = 2048


def is_available() -> bool:
    """Return True iff the chromadb extras are installed and importable."""
    try:
        import chromadb  # noqa: F401
        return True
    except ImportError:
        return False


def _palace_path() -> str:
    """Persistent directory for the Chroma SQLite database. Sibling of gapmap.db."""
    cfg = load_config()
    path = cfg.data_dir / "palace"
    path.mkdir(parents=True, exist_ok=True)
    return str(path)


_HEAL_SENTINEL_NAME = ".palace_heal_v1.5.done"

def _detect_legacy_segment_format(palace_dir: str) -> bool:
    """Return True if the palace dir contains chromadb 0.4/0.5-era HNSW
    segment files (`data_level0.bin`, `header.bin`, `link_lists.bin`).
    chromadb >= 1.0's Rust backend segfaults at `coll.query()` /
    `coll.count()` when handed those files — observed on macOS arm64
    with chromadb 1.5.x. The legacy sidecar files were unique to the
    DuckDB+HNSW Python segment; the Rust backend uses a different
    segment-id directory layout (vectors/* and offsets/* parquet
    files), so their presence is a reliable proxy for "this palace was
    written by an incompatible chromadb version".
    """
    import os as _os
    if not _os.path.isdir(palace_dir):
        return False
    legacy_markers = {"data_level0.bin", "header.bin", "link_lists.bin", "length.bin", "index_metadata.pickle"}
    for entry in _os.listdir(palace_dir):
        sub = _os.path.join(palace_dir, entry)
        if not _os.path.isdir(sub):
            continue
        try:
            files = set(_os.listdir(sub))
        except OSError:
            continue
        # If any segment dir has 3+ legacy markers, it's the old format.
        if len(legacy_markers & files) >= 3:
            return True
    return False


def _heal_legacy_palace(palace_dir: str) -> bool:
    """Idempotent: if the palace dir has chromadb < 1.0 segment files
    AND we haven't already run a heal under the current major version,
    move the corrupt store to a backup path and let `get_palace()`
    create a fresh one. Returns True if a heal happened.

    The corpus stays intact — palace is a derived index built from
    `posts` / `topic_posts` in the main SQLite. Caller (or background
    worker) re-runs `reindex_all()` to repopulate. Without this, every
    process that imports palace eats a Rust-backend SEGFAULT the first
    time it tries to query, and the user has no escape.
    """
    import os as _os
    import shutil as _shutil
    import time as _time
    if not _detect_legacy_segment_format(palace_dir):
        return False
    sentinel = _os.path.join(palace_dir, _HEAL_SENTINEL_NAME)
    if _os.path.isfile(sentinel):
        return False  # already healed once; don't loop on a still-broken install
    backup = palace_dir.rstrip("/") + f".legacy_backup_{int(_time.time())}"
    try:
        _os.rename(palace_dir, backup)
        _os.makedirs(palace_dir, exist_ok=True)
        # Drop the sentinel so we don't heal a second time if the user
        # restores the legacy backup; future legacy detections after the
        # sentinel exists fall through to the regular query path (and
        # may segfault again — but at least we've left the user's data
        # alone). To force another heal, delete .palace_heal_v1.5.done.
        with open(sentinel, "w") as f:
            f.write(f"healed_at={int(_time.time())} backup={backup}\n")
        logger.warning(
            "palace: detected chromadb 0.x segment format under %s — "
            "moved to %s and reset palace. Run `palace.reindex_all()` "
            "to re-embed posts (≈30 min for 20k items).",
            palace_dir, backup,
        )
        return True
    except OSError as e:
        logger.error("palace heal failed: %s", e)
        return False


def get_palace():
    """Return (client, collection), lazily creating both. Thread-safe. None
    if chromadb isn't installed (caller should check ``is_available()``)."""
    if not is_available():
        return None
    # Lazy idle eviction: drops the cache if we haven't embedded in 5 min.
    # Cheap when fresh. Runs OUTSIDE the lock so a long eviction can't block
    # the happy path; the follow-up cache-hit check inside the lock catches
    # the race where two threads arrive at the same time.
    _maybe_evict_idle()
    path = _palace_path()
    with _LOCK:
        entry = _CLIENT_CACHE.get(path)
        if entry is not None:
            return entry
        # Auto-heal pre-1.0 chromadb segment files. Detects legacy
        # data_level0.bin / link_lists.bin / etc. and moves them to a
        # backup so the new Rust-backend client can boot fresh. No-op
        # on already-healed installs and on stores that are already
        # 1.x-format. Done BEFORE PersistentClient init because the
        # client constructor itself triggers segment loading and can
        # crash on the legacy format.
        try:
            _heal_legacy_palace(path)
        except Exception as _e:
            logger.warning("palace heal probe failed: %s", _e)
        import chromadb
        from chromadb.config import Settings

        client = chromadb.PersistentClient(
            path=path,
            settings=Settings(anonymized_telemetry=False, allow_reset=False),
        )
        # Cosine is what the default all-MiniLM-L6-v2 is trained for; the
        # multilingual MiniLM-L12-v2 is also cosine-normalised so the same
        # space metric holds across both modes. The embedding_function is
        # resolved via the shared helper so GAPMAP_EMBEDDING_MODEL controls
        # every ChromaDB consumer uniformly.
        kwargs: dict[str, Any] = {"metadata": {"hnsw:space": "cosine"}}
        try:
            from .embedder import get_embedding_function
            ef = get_embedding_function()
            if ef is not None:
                kwargs["embedding_function"] = ef
        except Exception:
            # Fall through and let Chroma use its bundled default — keeps
            # palace functional even if the helper import fails on an
            # unusual install.
            pass
        collection = client.get_or_create_collection(
            _POSTS_COLLECTION,
            **kwargs,
        )
        _CLIENT_CACHE[path] = (client, collection)
        return _CLIENT_CACHE[path]


class PalaceStore:
    """Thin OO wrapper around the module functions.

    Most callers should use the module-level functions directly; the class
    is here for places that want to inject a custom client (tests, benches).
    """

    def __init__(self, collection=None):
        self._collection = collection

    @property
    def collection(self):
        if self._collection is not None:
            return self._collection
        got = get_palace()
        if got is None:
            return None
        _, coll = got
        self._collection = coll
        return coll


def _build_embed_text(post: dict) -> str:
    """One text blob per post — title + body (truncated)."""
    title = (post.get("title") or "").strip()
    body = (post.get("selftext") or post.get("body") or "").strip()
    joined = title + "\n\n" + body if title and body else title or body
    return joined[:_MAX_EMBED_CHARS].strip()


def _build_metadata(post: dict) -> dict:
    """Subset of post fields kept in Chroma for filter / display. Chroma's
    `where` only supports flat key=value / $and / $or — so we flatten and
    coerce to JSON-safe scalars (str/int/float/bool)."""
    out: dict[str, Any] = {}

    def _put(k: str, v: Any) -> None:
        if v is None or v == "":
            return
        if isinstance(v, (str, int, float, bool)):
            out[k] = v
        else:
            out[k] = str(v)

    _put("topic",        post.get("topic"))         # may be None; set per-tag below
    _put("source_type",  post.get("source_type") or "reddit")
    _put("sub",          post.get("sub"))
    _put("url",          post.get("url") or post.get("permalink"))
    _put("author",       post.get("author"))
    _put("score",        post.get("score"))
    _put("num_comments", post.get("num_comments"))
    _put("created_utc",  post.get("created_utc"))
    return out


# ─── upsert ────────────────────────────────────────────────────────────────

def upsert_posts_many(posts: Iterable[dict], *, topic: str | None = None) -> dict:
    """Embed + upsert a batch of posts into the palace collection.

    Args:
        posts: iterable of dicts with at least {id, title, selftext|body, ...}.
        topic: optional; if set, every post's metadata gets `topic=topic` so
            we can filter search with ``where={"topic": topic}`` later.

    Returns:
        ``{"ok": True, "upserted": N, "skipped": M}`` on success,
        ``{"ok": False, "skipped": True, "reason": ...}`` when chromadb isn't
        installed (so callers can continue silently).
    """
    if not is_available():
        return {"ok": False, "skipped": True, "reason": "chromadb not installed"}

    got = get_palace()
    if got is None:
        return {"ok": False, "skipped": True, "reason": "palace unavailable"}
    _, coll = got

    ids: list[str] = []
    docs: list[str] = []
    metas: list[dict] = []
    skipped = 0
    for p in posts:
        pid = p.get("id")
        text = _build_embed_text(p)
        if not pid or not text:
            skipped += 1
            continue
        meta = _build_metadata(p)
        if topic:
            meta["topic"] = topic
        ids.append(str(pid))
        docs.append(text)
        metas.append(meta)

    if not ids:
        return {"ok": True, "upserted": 0, "skipped": skipped}

    # Chroma handles both insert + update via .upsert(); duplicates are safe.
    try:
        coll.upsert(ids=ids, documents=docs, metadatas=metas)
    except Exception as e:
        logger.warning("palace upsert failed: %s", e)
        return {"ok": False, "error": str(e), "upserted": 0, "skipped": skipped + len(ids)}
    _bump_embed_ts()
    return {"ok": True, "upserted": len(ids), "skipped": skipped}


def upsert_post(post: dict, *, topic: str | None = None) -> bool:
    """Convenience single-post upsert. Returns True on success."""
    r = upsert_posts_many([post], topic=topic)
    return bool(r.get("ok")) and r.get("upserted", 0) > 0


# ─── search ────────────────────────────────────────────────────────────────

def _bm25_scores(query: str, docs: list[str]) -> list[float]:
    """Rank the already-vector-retrieved docs with BM25 over just those docs
    (not the full corpus — IDF is local). Softens pure-vector's tendency to
    reward semantic neighbours that share no actual keywords.
    """
    try:
        from rank_bm25 import BM25Okapi
    except ImportError:
        return [0.0] * len(docs)
    if not docs:
        return []
    corpus = [d.lower().split() for d in docs]
    bm25 = BM25Okapi(corpus)
    scores = bm25.get_scores(query.lower().split())
    return [float(s) for s in scores]


def _normalize(vals: list[float]) -> list[float]:
    if not vals:
        return []
    lo, hi = min(vals), max(vals)
    if hi - lo < 1e-9:
        return [0.0 for _ in vals]
    return [(v - lo) / (hi - lo) for v in vals]


def search_posts(
    query: str,
    *,
    topic: str | None = None,
    source_type: str | None = None,
    k: int = 10,
    rerank: bool = True,
    vector_weight: float = 0.6,
    bm25_weight: float = 0.4,
) -> dict:
    """Hybrid semantic + keyword search.

    Returns:
        ``{"ok": True, "results": [{id, score, text, metadata, vector_score,
        bm25_score}, ...], "count": N}``
    """
    if not is_available():
        return {"ok": False, "skipped": True, "reason": "chromadb not installed", "results": []}
    if not (query or "").strip():
        return {"ok": True, "results": [], "count": 0}

    got = get_palace()
    if got is None:
        return {"ok": False, "skipped": True, "reason": "palace unavailable", "results": []}
    _, coll = got

    where: dict[str, Any] = {}
    if topic:
        where["topic"] = topic
    if source_type:
        where["source_type"] = source_type

    # Empty-collection guard. ChromaDB's Rust backend (chromadb >= 0.5)
    # SEGFAULTS in `chromadb/api/rust.py::_query` when called with a
    # `where` filter that matches zero documents — observed on macOS
    # arm64 with chromadb 0.5.x and a partially-populated palace
    # (e.g. some topics indexed, others not). The crash kills the entire
    # Python process, so try/except can't catch it. Short-circuit here:
    # check `count(where=…)` first, return empty if zero. `coll.count()`
    # accepts `where` from chromadb 0.4+ and is a fast metadata lookup.
    if where:
        try:
            matched = coll.count(where=where)
        except TypeError:
            # Older chromadb signatures don't accept `where=` on count.
            # Fall back to peek: a 1-item peek with the filter is cheap
            # and uses a different code path than `query`, so it doesn't
            # trigger the same Rust segfault.
            try:
                pk = coll.peek(limit=1)
                matched = 1 if pk and pk.get("ids") else 0
            except Exception:
                matched = 1  # don't block legitimate queries on probe failure
        except Exception as e:
            logger.warning("palace pre-count failed: %s", e)
            matched = 1
        if matched == 0:
            # No docs match the filter — return empty without invoking
            # `query()` (which would segfault). Caller will fall back to
            # engagement-ranked SQL retrieval (`_topic_context` in
            # research/chat.py handles this branch).
            return {"ok": True, "results": [], "count": 0, "skipped_reason": "no_indexed_docs_for_filter"}

    # Pull 3× the desired k from Chroma; BM25 rerank picks the top k
    # from that pool. Keeps latency sub-linear in k.
    n_results = max(k * 3, k + 5)
    try:
        raw = coll.query(
            query_texts=[query],
            n_results=n_results,
            where=where or None,
        )
    except Exception as e:
        # HNSW self-heal: corrupt on-disk index (e.g. after a hard kill
        # mid-write) raises distinctive errors. Move the broken store
        # aside and retry once with a fresh client. After heal the
        # palace is empty until `reindex_all()` runs, so the retry
        # returns an empty result-set rather than a crash. The caller
        # (search_all aggressive, GUI, MCP) sees `ok=True, results=[],
        # healed=True` and can fall back to SQL.
        if _looks_like_hnsw_corruption(e):
            logger.warning(
                "palace query hit HNSW corruption (%s) — auto-healing.", e,
            )
            heal = heal_corrupt_index()
            if heal.get("healed"):
                got2 = get_palace()
                if got2 is not None:
                    _, coll2 = got2
                    try:
                        raw = coll2.query(
                            query_texts=[query], n_results=n_results,
                            where=where or None,
                        )
                    except Exception as e2:
                        logger.warning("palace post-heal query failed: %s", e2)
                        return {
                            "ok": True, "results": [], "count": 0,
                            "healed": True,
                            "reason": "index_was_corrupt_now_empty",
                            "hint": "run reindex_all() to repopulate",
                        }
                else:
                    return {
                        "ok": True, "results": [], "count": 0,
                        "healed": True,
                        "reason": "index_was_corrupt_now_empty",
                        "hint": "run reindex_all() to repopulate",
                    }
            else:
                logger.warning("palace heal failed: %s", heal)
                return {"ok": False, "error": str(e)[:200], "results": []}
        else:
            logger.warning("palace query failed: %s", e)
            return {"ok": False, "error": str(e)[:200], "results": []}
    _bump_embed_ts()

    # Chroma returns lists of lists (one per query). We only have 1 query.
    ids = (raw.get("ids") or [[]])[0]
    docs = (raw.get("documents") or [[]])[0]
    dists = (raw.get("distances") or [[]])[0]
    metas = (raw.get("metadatas") or [[]])[0]

    if not ids:
        return {"ok": True, "results": [], "count": 0}

    # Cosine distance 0=identical, 2=opposite. Convert to a 0..1 similarity.
    vector_sims = [max(0.0, 1.0 - (d or 0.0) / 2.0) for d in dists]
    if rerank:
        bm25 = _bm25_scores(query, docs)
        bm25_n = _normalize(bm25)
        vec_n = _normalize(vector_sims)
        final = [
            vector_weight * v + bm25_weight * b
            for v, b in zip(vec_n, bm25_n)
        ]
        order = sorted(range(len(ids)), key=lambda i: final[i], reverse=True)
    else:
        final = vector_sims
        order = sorted(range(len(ids)), key=lambda i: vector_sims[i], reverse=True)

    results = []
    for i in order[:k]:
        results.append({
            "id": ids[i],
            "score": round(final[i], 4),
            "vector_score": round(vector_sims[i], 4),
            "bm25_score": round(_bm25_scores(query, [docs[i]])[0] if rerank else 0.0, 4),
            "text": docs[i][:600],
            "metadata": metas[i] or {},
        })
    return {"ok": True, "results": results, "count": len(results)}


def related_posts(post_id: str, *, k: int = 10, topic: str | None = None) -> dict:
    """Find the k most-similar posts to a given post_id.

    Uses Chroma's `query(query_embeddings=...)` path after pulling the target
    post's existing embedding. If the post isn't in the palace yet (or
    embedding isn't accessible), falls back to re-embedding its text.
    """
    if not is_available():
        return {"ok": False, "skipped": True, "reason": "chromadb not installed", "results": []}
    got = get_palace()
    if got is None:
        return {"ok": False, "skipped": True, "reason": "palace unavailable", "results": []}
    _, coll = got

    try:
        got_item = coll.get(ids=[str(post_id)], include=["documents", "embeddings"])
    except Exception as e:
        return {"ok": False, "error": str(e), "results": []}

    # Chromadb returns `embeddings` as a numpy array when present, so the
    # old `X or []` shortcut raises "truth value of an array is ambiguous".
    # Probe length/shape explicitly and fall back to re-embedding the text.
    docs_raw = got_item.get("documents")
    embs_raw = got_item.get("embeddings")
    docs = list(docs_raw) if docs_raw is not None else []
    if not docs:
        return {"ok": True, "results": [], "reason": f"post {post_id} not indexed"}

    # Pull out the first embedding if the array is non-empty.
    first_emb = None
    if embs_raw is not None:
        try:
            if hasattr(embs_raw, "__len__") and len(embs_raw) > 0:
                first_emb = embs_raw[0]
        except Exception:
            first_emb = None

    where = {"topic": topic} if topic else None
    try:
        if first_emb is not None:
            raw = coll.query(query_embeddings=[first_emb], n_results=k + 1, where=where)
        else:
            raw = coll.query(query_texts=[docs[0]], n_results=k + 1, where=where)
    except Exception as e:
        return {"ok": False, "error": str(e), "results": []}
    _bump_embed_ts()

    ids = (raw.get("ids") or [[]])[0]
    rdocs = (raw.get("documents") or [[]])[0]
    dists = (raw.get("distances") or [[]])[0]
    metas = (raw.get("metadatas") or [[]])[0]

    results = []
    for i, rid in enumerate(ids):
        if str(rid) == str(post_id):
            continue  # self
        results.append({
            "id": rid,
            "score": round(max(0.0, 1.0 - (dists[i] or 0.0) / 2.0), 4),
            "text": (rdocs[i] or "")[:600],
            "metadata": metas[i] or {},
        })
        if len(results) >= k:
            break
    return {"ok": True, "results": results, "count": len(results)}


# ─── reindex ───────────────────────────────────────────────────────────────

def reindex_all(*, batch_size: int = 200, progress=None) -> dict:
    """One-shot: walk every row in `posts` JOIN `topic_posts` and upsert into
    the palace. Safe to run multiple times (ids are stable → upsert is a
    no-op when content hasn't changed).

    Args:
        batch_size: how many posts to embed per Chroma call. Larger = faster
            throughput but more RAM / slower per-batch feedback.
        progress: optional callable(message: str) for stream logs.
    """
    if not is_available():
        return {"ok": False, "skipped": True, "reason": "chromadb not installed"}

    from ..core.db import get_db

    def _log(msg: str) -> None:
        if progress:
            try: progress(msg)
            except Exception: pass

    db = get_db()
    # Join so every (post, topic) pair gets a metadata entry. A single post
    # tagged to 2 topics gets 2 chroma rows with different ids — but Chroma
    # ids must be unique, so we key by (post_id, topic) ... or we just pick
    # one topic per post (the most-recent tagging). Going with the latter:
    # simpler, and searches with topic filter still work because we also
    # have topic-less queries.
    sql = """
        SELECT p.*,
               (SELECT tp.topic FROM topic_posts tp
                 WHERE tp.post_id=p.id
                 ORDER BY tp.added_at DESC LIMIT 1) AS topic
          FROM posts p
    """
    total = 0
    skipped = 0
    batch: list[dict] = []
    for row in db.query(sql):
        batch.append(dict(row))
        if len(batch) >= batch_size:
            r = upsert_posts_many(batch)
            total += r.get("upserted", 0)
            skipped += r.get("skipped", 0)
            _log(f"[palace] upserted {total} posts so far…")
            batch = []
    if batch:
        r = upsert_posts_many(batch)
        total += r.get("upserted", 0)
        skipped += r.get("skipped", 0)
    _log(f"[palace] done. upserted={total} skipped={skipped}")
    return {"ok": True, "upserted": total, "skipped": skipped}


# ─── paper_chunks collection (separate from `posts`) ─────────────────────
#
# Lifecycle and retrieval semantics are different from posts:
#   * one paper → many vectors (chunks); one post → one vector
#   * search returns chunk-level hits AND paper-level rollups
#   * metadata carries (post_id, section, ord) so the UI can show
#     "Limitations section of paper X, chunk 3" for every result
# A separate Chroma collection keeps these contracts clean — no mixing.

_PAPER_CHUNKS_CACHE: dict[str, Any] = {}


def get_paper_chunks_collection():
    """Return the ChromaDB collection used for paper chunks. Lazy-init.
    None when chromadb isn't available (caller falls back gracefully)."""
    if not is_available():
        return None
    path = _palace_path()
    cached = _PAPER_CHUNKS_CACHE.get(path)
    if cached is not None:
        return cached
    got = get_palace()
    if got is None:
        return None
    client, _ = got
    kwargs: dict[str, Any] = {"metadata": {"hnsw:space": "cosine"}}
    try:
        from .embedder import get_embedding_function
        ef = get_embedding_function()
        if ef is not None:
            kwargs["embedding_function"] = ef
    except Exception:
        pass
    coll = client.get_or_create_collection(_PAPER_CHUNKS_COLLECTION, **kwargs)
    _PAPER_CHUNKS_CACHE[path] = coll
    return coll


def upsert_paper_chunks(chunks: Iterable[dict], *, post_id: str | None = None,
                       topic: str | None = None) -> dict:
    """Embed + upsert paper chunks. Each chunk dict needs:
        ``{id, post_id, section, ord, text, char_count, hash}``.

    Idempotent (id is stable; same hash means re-embed is a no-op upsert).
    Returns ``{ok, upserted, skipped, backend}``.
    """
    if not is_available():
        return {"ok": False, "skipped": True, "reason": "chromadb not installed",
                "upserted": 0}
    coll = get_paper_chunks_collection()
    if coll is None:
        return {"ok": False, "skipped": True, "reason": "palace unavailable",
                "upserted": 0}

    ids: list[str] = []
    docs: list[str] = []
    metas: list[dict] = []
    skipped = 0
    for c in chunks:
        cid = c.get("id")
        text = (c.get("text") or "").strip()
        if not cid or not text:
            skipped += 1
            continue
        ids.append(str(cid))
        docs.append(text)
        meta = {
            "post_id": str(c.get("post_id") or ""),
            "section": str(c.get("section") or ""),
            "ord": int(c.get("ord") or 0),
            "char_count": int(c.get("char_count") or len(text)),
            "hash": str(c.get("hash") or ""),
        }
        if topic:
            meta["topic"] = topic
        metas.append(meta)

    if not ids:
        return {"ok": True, "upserted": 0, "skipped": skipped, "backend": ""}

    try:
        coll.upsert(ids=ids, documents=docs, metadatas=metas)
    except Exception as e:
        logger.warning("palace paper_chunks upsert failed: %s", e)
        return {"ok": False, "error": str(e), "upserted": 0,
                "skipped": skipped + len(ids)}
    _bump_embed_ts()

    backend = ""
    try:
        from .embedder import active_backend
        backend = active_backend()
    except Exception:
        pass
    return {"ok": True, "upserted": len(ids), "skipped": skipped,
            "backend": backend}


def _paper_post_ids_for_topic(topic: str) -> list[str]:
    """Resolve a topic to the post_ids of its papers (source of truth =
    ``topic_posts``). Used to filter paper-chunk search by topic membership
    instead of a stamped chunk metadata field. Best-effort: returns [] on any
    DB error so the caller can fall back. Capped so an enormous topic doesn't
    blow ChromaDB's ``$in`` clause."""
    try:
        from ..core.db import get_db
        db = get_db()
        rows = list(db.query(
            "SELECT DISTINCT post_id FROM topic_posts WHERE topic = ? LIMIT 5000",
            [topic],
        ))
        return [r["post_id"] for r in rows if r.get("post_id")]
    except Exception:
        return []


def search_paper_chunks(
    query: str,
    *,
    k: int = 12,
    topic: str | None = None,
    post_id: str | None = None,
    section_filter: list[str] | None = None,
    rerank: bool = True,
) -> dict:
    """Hybrid semantic + BM25 search over paper chunks.

    ``section_filter`` constrains hits to listed canonical section names
    (e.g. ``['methods', 'results', 'limitations']``). When set with more
    than one section, Chroma's `where` is built with ``$or``.

    Returns ``{ok, results: [{chunk_id, post_id, section, ord, text,
    score, vector_score, bm25_score}], count}``.
    """
    if not is_available():
        return {"ok": False, "skipped": True, "reason": "chromadb not installed",
                "results": []}
    if not (query or "").strip():
        return {"ok": True, "results": [], "count": 0}
    coll = get_paper_chunks_collection()
    if coll is None:
        return {"ok": False, "skipped": True, "reason": "palace unavailable",
                "results": []}

    where: dict[str, Any] = {}
    clauses: list[dict] = []
    if topic:
        # Topic membership lives in `topic_posts` (the source of truth), NOT on
        # the chunk metadata: a paper can belong to several topics, and the
        # ingest/auto-index path embeds chunks WITHOUT a `topic` field. So
        # filtering on a stamped `{"topic": ...}` field silently matched zero
        # chunks. Resolve topic → its paper post_ids and filter on those.
        # Falls back to the legacy stamped-topic clause if the topic resolves
        # to no posts (keeps older stamped chunks reachable). (2026-06-07)
        topic_pids = _paper_post_ids_for_topic(topic)
        if topic_pids:
            clauses.append({"post_id": {"$in": topic_pids}})
        else:
            clauses.append({"topic": topic})
    if post_id:
        clauses.append({"post_id": post_id})
    if section_filter:
        if len(section_filter) == 1:
            clauses.append({"section": section_filter[0]})
        else:
            clauses.append({"$or": [{"section": s} for s in section_filter]})
    if len(clauses) == 1:
        where = clauses[0]
    elif len(clauses) > 1:
        where = {"$and": clauses}

    n_results = max(k * 3, k + 5)
    try:
        # Empty-collection guard, mirrors search_posts.
        if where:
            try:
                matched = coll.count(where=where)
            except Exception:
                matched = 1
            if matched == 0:
                return {"ok": True, "results": [], "count": 0,
                        "skipped_reason": "no_indexed_chunks_for_filter"}
        raw = coll.query(
            query_texts=[query],
            n_results=n_results,
            where=where or None,
        )
    except Exception as e:
        logger.warning("palace paper_chunks query failed: %s", e)
        return {"ok": False, "error": str(e), "results": []}
    _bump_embed_ts()

    ids = (raw.get("ids") or [[]])[0]
    docs = (raw.get("documents") or [[]])[0]
    dists = (raw.get("distances") or [[]])[0]
    metas = (raw.get("metadatas") or [[]])[0]
    if not ids:
        return {"ok": True, "results": [], "count": 0}

    vector_sims = [max(0.0, 1.0 - (d or 0.0) / 2.0) for d in dists]
    if rerank:
        bm25 = _bm25_scores(query, docs)
        bm25_n = _normalize(bm25)
        vec_n = _normalize(vector_sims)
        final = [0.6 * v + 0.4 * b for v, b in zip(vec_n, bm25_n)]
        order = sorted(range(len(ids)), key=lambda i: final[i], reverse=True)
    else:
        final = vector_sims
        order = sorted(range(len(ids)), key=lambda i: vector_sims[i], reverse=True)

    results = []
    for i in order[:k]:
        m = metas[i] or {}
        results.append({
            "chunk_id": ids[i],
            "post_id": m.get("post_id", ""),
            "section": m.get("section", ""),
            "ord": int(m.get("ord", 0)),
            "score": round(final[i], 4),
            "vector_score": round(vector_sims[i], 4),
            "bm25_score": round(_bm25_scores(query, [docs[i]])[0] if rerank else 0.0, 4),
            "text": docs[i][:1000],
            "char_count": int(m.get("char_count", len(docs[i]))),
        })
    return {"ok": True, "results": results, "count": len(results)}


def search_papers(
    query: str,
    *,
    k: int = 8,
    topic: str | None = None,
    section_filter: list[str] | None = None,
    max_chunks_per_paper: int = 3,
) -> dict:
    """Chunk-level retrieval rolled up to paper level.

    Pulls the top ~k×4 chunks, groups by ``post_id``, keeps the strongest
    ``max_chunks_per_paper`` chunks per paper, and returns one row per
    paper. Useful for "which papers discuss X" — without this rollup,
    one verbose paper can monopolise the top-k.
    """
    n_chunks_pull = max(k * max_chunks_per_paper * 2, k * 4)
    chunks = search_paper_chunks(
        query, k=n_chunks_pull, topic=topic,
        section_filter=section_filter,
    )
    if not chunks.get("ok") or not chunks.get("results"):
        return {"ok": chunks.get("ok", True), "results": [], "count": 0,
                "reason": chunks.get("reason") or chunks.get("skipped_reason")}

    by_paper: dict[str, dict] = {}
    for ch in chunks["results"]:
        pid = ch["post_id"]
        if not pid:
            continue
        bucket = by_paper.setdefault(pid, {
            "post_id": pid, "best_score": 0.0,
            "chunks": [], "sections_hit": set(),
        })
        if len(bucket["chunks"]) < max_chunks_per_paper:
            bucket["chunks"].append(ch)
        bucket["best_score"] = max(bucket["best_score"], ch["score"])
        if ch.get("section"):
            bucket["sections_hit"].add(ch["section"])

    rolled = list(by_paper.values())
    rolled.sort(key=lambda r: r["best_score"], reverse=True)
    rolled = rolled[:k]

    # Enrich with title from `posts` so callers don't need a second query.
    if rolled:
        try:
            from ..core.db import get_db
            db = get_db()
            ids_in = ",".join(["?"] * len(rolled))
            title_rows = list(db.query(
                f"SELECT id, title, source_type, url FROM posts WHERE id IN ({ids_in})",
                [r["post_id"] for r in rolled],
            ))
            tmap = {r["id"]: r for r in title_rows}
            for r in rolled:
                t = tmap.get(r["post_id"]) or {}
                r["title"] = t.get("title", "")
                r["source_type"] = t.get("source_type", "")
                r["url"] = t.get("url", "")
                r["sections_hit"] = sorted(list(r["sections_hit"]))
        except Exception:
            for r in rolled:
                r["sections_hit"] = sorted(list(r["sections_hit"]))

    return {"ok": True, "results": rolled, "count": len(rolled)}


def paper_neighbors(post_id: str, *, k: int = 8, topic: str | None = None) -> dict:
    """Semantic neighbors of a paper (paper→paper). Mean-pools the paper's own
    chunk embeddings, queries the paper-chunk collection with that vector, rolls
    chunk hits up to paper level, drops self. Returns
    ``{ok, results: [{post_id, score, n_chunks}], count}`` (ranked desc)."""
    if not is_available():
        return {"ok": False, "skipped": True, "reason": "chromadb not installed", "results": []}
    coll = get_paper_chunks_collection()
    if coll is None:
        return {"ok": False, "skipped": True, "reason": "palace unavailable", "results": []}
    try:
        own = coll.get(where={"post_id": post_id}, include=["embeddings"])
    except Exception as e:
        logger.warning("paper_neighbors get failed: %s", e)
        return {"ok": False, "error": str(e), "results": []}
    _own_dict = own if isinstance(own, dict) else {}
    vecs = _own_dict.get("embeddings")
    if vecs is None or (hasattr(vecs, "__len__") and len(vecs) == 0):
        return {"ok": True, "results": [], "count": 0, "reason": "paper not embedded"}
    # Convert to list-of-lists to be safe before numpy
    import numpy as _np_pre
    vecs = _np_pre.asarray(vecs, dtype="float32")
    if vecs.ndim < 2 or vecs.shape[0] == 0:
        return {"ok": True, "results": [], "count": 0, "reason": "paper not embedded"}
    import numpy as np
    mean_vec = np.mean(vecs, axis=0).tolist()
    where = {"topic": topic} if topic else None
    # Empty-filter guard: chromadb's Rust backend SEGFAULTS (uncatchable — it
    # kills the whole Python sidecar) when query() is handed a `where` filter
    # that matches zero documents. Mirror the guard used in search_paper_chunks.
    # No-op when where is None (the crash is specific to zero-match filters,
    # not to the no-filter path).
    if where is not None:
        try:
            if coll.count(where=where) == 0:
                return {"ok": True, "results": [], "count": 0,
                        "skipped_reason": "no_indexed_chunks_for_filter"}
        except Exception:
            pass
    try:
        raw = coll.query(query_embeddings=[mean_vec], n_results=max(k * 6, 30), where=where)
    except Exception as e:
        logger.warning("paper_neighbors query failed: %s", e)
        return {"ok": False, "error": str(e), "results": []}
    _bump_embed_ts()
    metas = (raw.get("metadatas") or [[]])[0]
    dists = (raw.get("distances") or [[]])[0]
    best: dict[str, dict] = {}
    for m, d in zip(metas, dists):
        pid = (m or {}).get("post_id", "")
        if not pid or pid == post_id:
            continue
        sim = max(0.0, 1.0 - (d or 0.0) / 2.0)
        cur = best.get(pid)
        if cur is None:
            best[pid] = {"post_id": pid, "score": round(sim, 4), "n_chunks": 1}
        else:
            # Accumulate every matching chunk; keep the strongest score.
            cur["n_chunks"] += 1
            if sim > cur["score"]:
                cur["score"] = round(sim, 4)
    results = sorted(best.values(), key=lambda r: r["score"], reverse=True)[:k]
    return {"ok": True, "results": results, "count": len(results)}


def paper_chunks_stats() -> dict:
    """Return ``{ok, count, by_section, papers_indexed}`` for the
    paper_chunks collection. Best-effort SQLite-direct read first to
    avoid spinning up the full client; falls back to the chroma API."""
    if not is_available():
        return {"ok": False, "skipped": True, "reason": "chromadb not installed"}
    try:
        coll = get_paper_chunks_collection()
        if coll is None:
            return {"ok": False, "skipped": True, "reason": "palace unavailable"}
        count = coll.count()
        # Per-section + per-paper aggregates via metadata pull. Cap at
        # 50k peek to bound memory.
        by_section: dict[str, int] = {}
        papers: set[str] = set()
        try:
            peek = coll.get(include=["metadatas"], limit=50_000)
            for m in (peek.get("metadatas") or []):
                if not m:
                    continue
                sec = m.get("section") or ""
                by_section[sec] = by_section.get(sec, 0) + 1
                pid = m.get("post_id") or ""
                if pid:
                    papers.add(pid)
        except Exception:
            pass
        return {
            "ok": True, "count": int(count or 0),
            "by_section": by_section, "papers_indexed": len(papers),
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}


def stats() -> dict:
    """Return ``{"ok": True, "count": N, "path": "..."}`` or skip-stub."""
    if not is_available():
        return {"ok": False, "skipped": True, "reason": "chromadb not installed"}
    # Prefer a direct SQLite count against Chroma's persisted DB to avoid
    # triggering a full Chroma client/session init on lightweight health checks.
    # This avoids native crashes observed in some environments when calling
    # `coll.count()` from short-lived CLI processes.
    try:
        import sqlite3
        db_path = os.path.join(_palace_path(), "chroma.sqlite3")
        if not os.path.isfile(db_path):
            return {"ok": True, "count": 0, "path": _palace_path()}
        conn = sqlite3.connect(db_path)
        cur = conn.cursor()
        # Chroma stores one row per embedded id in `embeddings`, keyed by a
        # segment. For our single "posts" collection, counting rows in the
        # metadata segment is a stable proxy for indexed document count.
        row = cur.execute(
            "SELECT count(*) FROM embeddings e "
            "JOIN segments s ON s.id = e.segment_id "
            "WHERE s.scope = 'METADATA'"
        ).fetchone()
        count = int((row[0] if row else 0) or 0)
        # Per-topic count — same SQLite-direct trick. Powers the chat
        # tab's `indexed_for_topic` indicator and the empty-collection
        # short-circuit in `_semantic_evidence` (avoids triggering the
        # Rust-backend `coll.query()` SEGFAULT on filters that match no
        # docs — see the auto-heal block in this module). One row per
        # `(embedding_id, key='topic', string_value=<topic>)`.
        by_topic: dict[str, int] = {}
        try:
            for tname, n in cur.execute(
                "SELECT string_value, count(*) "
                "  FROM embedding_metadata "
                " WHERE key='topic' AND string_value IS NOT NULL "
                " GROUP BY string_value"
            ).fetchall():
                if tname:
                    by_topic[str(tname)] = int(n or 0)
        except Exception:
            # `embedding_metadata` table layout may differ on older
            # chromadb versions; treat absence as "not available".
            pass
        conn.close()
        return {
            "ok": True,
            "count": count,
            "path": _palace_path(),
            # ChromaDB's internal SQLite is the AUTHORITATIVE store; reading
            # counts via direct SQL is the FAST path (~5ms) versus going
            # through chroma_api (~50-200ms with collection open). The
            # "_fallback" suffix in the original label was misleading —
            # this is the preferred path, not a degraded one.
            "source": "chromadb_sqlite_fastpath",
            "by_topic": by_topic,
        }
    except Exception:
        # Last resort: use Chroma API.
        got = get_palace()
        if got is None:
            return {"ok": False, "skipped": True, "reason": "palace unavailable"}
        _, coll = got
        try:
            count = coll.count()
        except Exception as e:
            return {"ok": False, "error": str(e)}
        return {"ok": True, "count": count, "path": _palace_path(), "source": "chroma_api"}


# ─── model download / warmup ───────────────────────────────────────────────
#
# ChromaDB ships its default embedder (all-MiniLM-L6-v2, 384 dims) but does
# NOT bundle the ONNX weights inside the wheel — it fetches them the first
# time an embedding is requested, from https://chroma-onnx-models.s3.amazonaws.com/
# into `~/.cache/chroma/onnx_models/all-MiniLM-L6-v2/`. The tar.gz is ~79 MB;
# it expands to a directory with `onnx/model.onnx` + `tokenizer.json` etc.
#
# Hybrid strategy: ship the Python runtime (onnxruntime, chromadb,
# rank-bm25) in the DMG so the app is never broken at rest, but let the
# user opt in to the model download with explicit UI. Functions below let
# the frontend show a "Enable semantic search — 80 MB" card and monitor
# the download progress.

# Total size of the downloaded tar (chromadb 1.5.x shipped this file size).
# Used only as the denominator for progress %. If the real download differs,
# we cap pct at 99 until the extraction is actually finished.
_MODEL_TAR_BYTES = 79 * 1024 * 1024


def _model_cache_dir() -> str:
    return os.path.join(
        os.path.expanduser("~"),
        ".cache", "chroma", "onnx_models", "all-MiniLM-L6-v2",
    )


def _model_archive_path() -> str:
    return os.path.join(_model_cache_dir(), "onnx.tar.gz")


def _model_expanded_file() -> str:
    # chromadb unpacks the tar into an `onnx/` subdir; the actual graph is here.
    return os.path.join(_model_cache_dir(), "onnx", "model.onnx")


def _bundled_onnx_tar() -> str | None:
    """Path to the pre-bundled ONNX tarball inside the PyInstaller sidecar,
    or None if the build didn't ship it.

    The PyInstaller spec (`gapmap.spec`) downloads the tar once per
    build host and places it under `bundled_onnx/onnx.tar.gz` inside the
    sidecar's `_MEIPASS` temp-extract dir. Dev (running from source) has
    no `_MEIPASS` — returns None, and we fall through to the live
    download path.
    """
    import sys
    meipass = getattr(sys, "_MEIPASS", None)
    if not meipass:
        return None
    candidate = os.path.join(meipass, "bundled_onnx", "onnx.tar.gz")
    if os.path.isfile(candidate) and os.path.getsize(candidate) > 70_000_000:
        return candidate
    return None


def _seed_model_from_bundle() -> bool:
    """If the sidecar bundle ships the ONNX tar AND the user's cache is
    empty, copy the bundled tar into the cache dir. Returns True if a copy
    happened. Called lazily from is_model_ready() / warmup_model() so dev
    (no _MEIPASS) and prod (with bundle) both work seamlessly.
    """
    src = _bundled_onnx_tar()
    if not src:
        return False
    dst = _model_archive_path()
    # Already have it (possibly from a prior run) — nothing to do.
    if os.path.isfile(dst) and os.path.getsize(dst) > 70_000_000:
        return False
    try:
        os.makedirs(_model_cache_dir(), exist_ok=True)
        import shutil
        shutil.copy2(src, dst)
        logger.info("palace: seeded ONNX model from bundle → %s", dst)
        return True
    except Exception as e:
        logger.warning("palace: seed-from-bundle failed: %s", e)
        return False


def is_model_ready() -> bool:
    """True iff the ONNX graph file exists + non-empty. Cheap (one stat).

    Also triggers a bundle → cache seed on first call, so users running
    a DMG that shipped the model get a True result without an explicit
    Enable click. Dev / lean builds (no bundle) just see False until
    the user runs warmup_model().
    """
    if not is_available():
        return False
    # Fast path — weights already extracted.
    p = _model_expanded_file()
    try:
        if os.path.isfile(p) and os.path.getsize(p) > 1024:
            return True
    except OSError:
        pass
    # Check if we have the tar but haven't extracted yet — could be from
    # a prior run or from the bundle seed. Either way, we can't use it
    # until chromadb extracts on next embed(). Return False so the UI
    # shows "Enable" which will trigger extraction (fast — <2 s).
    try:
        tar = _model_archive_path()
        if os.path.isfile(tar) and os.path.getsize(tar) > 70_000_000:
            return False  # tar present, weights not yet extracted
    except OSError:
        pass
    # No weights, no tar — try seeding from the PyInstaller bundle
    # (no-op in dev). If seeded, caller sees False but a subsequent
    # warmup_model() completes instantly (no network).
    _seed_model_from_bundle()
    return False


def model_status() -> dict:
    """UI-facing status payload. Works whether retrieval extras are
    installed or not — so the Settings card can show an accurate state on
    any sidecar build."""
    installed = is_available()
    ready = is_model_ready() if installed else False
    # Current on-disk size of the download, for the "partial download — Resume"
    # hint on resumed warmups.
    archive_bytes = 0
    try:
        archive_bytes = os.path.getsize(_model_archive_path())
    except OSError:
        pass
    return {
        "ok": True,
        "installed": installed,  # retrieval extras wheel installed in Python
        "ready": ready,          # ONNX weights cached locally
        "archive_bytes": archive_bytes,
        "expected_bytes": _MODEL_TAR_BYTES,
        "cache_dir": _model_cache_dir() if installed else None,
    }


_MODEL_URL = (
    "https://chroma-onnx-models.s3.amazonaws.com/all-MiniLM-L6-v2/onnx.tar.gz"
)


def warmup_model(progress=None, chunk_size: int = 262_144) -> dict:
    """Download + extract the all-MiniLM-L6-v2 ONNX model for first use.

    Replaces chromadb's built-in downloader (which goes through the same S3
    URL but has no resume, no retry, and consistently times out at 50 %
    from this host). Streams the tarball with httpx — supports resume via
    an explicit ``Range: bytes=N-`` header so the user can hit Enable twice
    after a network blip and the second attempt picks up where the first
    left off. Emits one progress event per chunk:

        {"event": "progress", "bytes": N, "total": T, "pct": P}
        {"event": "done",     "ok": True}
        {"event": "error",    "ok": False, "error": "..."}

    Once the tarball lands we run one throwaway embed call to let chromadb
    extract it and compile the ONNX session — so ``is_model_ready()`` flips
    True by the time the function returns.
    """
    if not is_available():
        ev = {"event": "error", "ok": False, "error": "retrieval extras not installed — uv sync --extra retrieval"}
        if progress: progress(ev)
        return ev
    if is_model_ready():
        ev = {"event": "done", "ok": True, "already": True}
        if progress: progress(ev)
        return ev
    # If the PyInstaller bundle shipped the tar, seed the cache from
    # it (fast, local copy) BEFORE we reach for the network. That turns
    # the prod DMG experience from "wait for 80 MB download" into
    # "wait 2 s for extraction".
    if _seed_model_from_bundle():
        # Tar now in the cache; skip network and fall through to the
        # extraction step below.
        if progress:
            progress({"event": "progress", "bytes": _MODEL_TAR_BYTES, "total": _MODEL_TAR_BYTES, "pct": 99})

    import httpx

    cache_dir = _model_cache_dir()
    os.makedirs(cache_dir, exist_ok=True)
    archive = _model_archive_path()
    tmp = archive + ".part"

    # Resume support — if a previous Enable got partway, pick up from the
    # existing byte offset. Users hitting Enable twice in a row should never
    # re-download what they already have.
    already = 0
    for candidate in (tmp, archive):
        try:
            size = os.path.getsize(candidate)
            if size > 0 and size < _MODEL_TAR_BYTES:
                already = size
                if candidate != tmp:
                    os.rename(candidate, tmp)
                break
        except OSError:
            continue
    # If the existing file is already the expected size, skip straight to
    # the extract step.
    if already >= _MODEL_TAR_BYTES:
        try: os.rename(tmp, archive)
        except OSError: pass
        already = _MODEL_TAR_BYTES

    last_pct = -1
    total = _MODEL_TAR_BYTES

    def _emit_progress(b: int) -> None:
        nonlocal last_pct
        pct = min(99, int(b * 100 / total))
        if pct != last_pct and progress:
            progress({"event": "progress", "bytes": b, "total": total, "pct": pct})
            last_pct = pct

    if already < total:
        headers = {}
        if already > 0:
            headers["Range"] = f"bytes={already}-"
        mode = "ab" if already > 0 else "wb"
        try:
            # Long read timeout: the S3 endpoint throttles hard, but we
            # DO want to fail fast on connection problems. Retry once
            # implicitly via the 2-attempt loop if the first stream dies.
            for attempt in range(2):
                try:
                    with httpx.stream(
                        "GET", _MODEL_URL,
                        headers=headers,
                        timeout=httpx.Timeout(connect=20.0, read=120.0, write=60.0, pool=20.0),
                        follow_redirects=True,
                    ) as resp:
                        resp.raise_for_status()
                        downloaded = already
                        with open(tmp, mode) as f:
                            for chunk in resp.iter_bytes(chunk_size):
                                if not chunk:
                                    continue
                                f.write(chunk)
                                downloaded += len(chunk)
                                _emit_progress(downloaded)
                        break
                except (httpx.ReadTimeout, httpx.RemoteProtocolError, httpx.ReadError) as e:
                    if attempt >= 1:
                        raise
                    # Retry from wherever we got to.
                    try:
                        already = os.path.getsize(tmp)
                    except OSError:
                        already = 0
                    headers = {"Range": f"bytes={already}-"} if already > 0 else {}
                    mode = "ab" if already > 0 else "wb"
        except Exception as e:
            ev = {"event": "error", "ok": False, "error": f"download failed: {e}"}
            if progress: progress(ev)
            return ev
        # Atomic rename once the full tarball is on disk.
        try:
            os.rename(tmp, archive)
        except OSError as e:
            ev = {"event": "error", "ok": False, "error": f"rename {tmp} → {archive}: {e}"}
            if progress: progress(ev)
            return ev

    # Tarball is on disk — now have chromadb extract + compile the ONNX
    # graph so is_model_ready() flips True.
    try:
        if progress:
            progress({"event": "progress", "bytes": total, "total": total, "pct": 99})
        from chromadb.utils import embedding_functions
        ef = embedding_functions.ONNXMiniLM_L6_V2()
        _ = ef(["hello"])  # triggers extract + ONNX session init
    except Exception as e:
        ev = {"event": "error", "ok": False, "error": f"extract: {e}"}
        if progress: progress(ev)
        return ev

    # Confirm file actually landed.
    if not is_model_ready():
        ev = {"event": "error", "ok": False,
              "error": "download finished but ONNX file is missing"}
        if progress: progress(ev)
        return ev

    ev = {"event": "done", "ok": True, "pct": 100}
    if progress: progress(ev)
    return ev
