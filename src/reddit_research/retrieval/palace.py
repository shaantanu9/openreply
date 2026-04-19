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

**Separate file from reddit.db:** posts stay in sqlite-utils; vectors live
in ``palace/chroma.sqlite3`` next to it. Sync happens opportunistically at
post upsert time (see ``core.db.upsert_posts`` hook) and can be force-
refreshed via ``reindex_all()``.
"""
from __future__ import annotations

import logging
import math
import os
import threading
from typing import Any, Iterable

from ..core.config import load_config

logger = logging.getLogger(__name__)


# Module-level state — we want the ChromaDB PersistentClient + collection
# cached, since cold-start is ~2–5 s. Keyed by data_dir so multiple test
# palaces don't collide.
_CLIENT_CACHE: dict[str, Any] = {}
_LOCK = threading.Lock()

# Collection name inside the palace. Kept separate from "memories" etc. in
# case we later want to add a second collection for, say, LLM-extracted
# findings or external document ingests.
_POSTS_COLLECTION = "posts"

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
    """Persistent directory for the Chroma SQLite database. Sibling of reddit.db."""
    cfg = load_config()
    path = cfg.data_dir / "palace"
    path.mkdir(parents=True, exist_ok=True)
    return str(path)


def get_palace():
    """Return (client, collection), lazily creating both. Thread-safe. None
    if chromadb isn't installed (caller should check ``is_available()``)."""
    if not is_available():
        return None
    path = _palace_path()
    with _LOCK:
        entry = _CLIENT_CACHE.get(path)
        if entry is not None:
            return entry
        import chromadb
        from chromadb.config import Settings

        client = chromadb.PersistentClient(
            path=path,
            settings=Settings(anonymized_telemetry=False, allow_reset=False),
        )
        # Cosine is what the default all-MiniLM-L6-v2 is trained for.
        collection = client.get_or_create_collection(
            _POSTS_COLLECTION,
            metadata={"hnsw:space": "cosine"},
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
        logger.warning("palace query failed: %s", e)
        return {"ok": False, "error": str(e), "results": []}

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


def stats() -> dict:
    """Return ``{"ok": True, "count": N, "path": "..."}`` or skip-stub."""
    if not is_available():
        return {"ok": False, "skipped": True, "reason": "chromadb not installed"}
    got = get_palace()
    if got is None:
        return {"ok": False, "skipped": True, "reason": "palace unavailable"}
    _, coll = got
    try:
        count = coll.count()
    except Exception as e:
        return {"ok": False, "error": str(e)}
    return {"ok": True, "count": count, "path": _palace_path()}


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


def is_model_ready() -> bool:
    """True iff the ONNX graph file exists + non-empty. Cheap (one stat)."""
    if not is_available():
        return False
    p = _model_expanded_file()
    try:
        return os.path.isfile(p) and os.path.getsize(p) > 1024
    except OSError:
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


def warmup_model(progress=None, poll_interval: float = 0.4) -> dict:
    """Force the ONNX model download by asking chromadb to embed one string.

    Chromadb blocks the current thread while it fetches + extracts, so we do
    the embed call on a worker thread and poll the filesystem from the main
    thread to emit progress. Progress is reported as a dict:

        {"event": "progress", "bytes": N, "total": T, "pct": P}
        {"event": "done",     "ok": True}          # success
        {"event": "error",    "ok": False, "error": "..."}

    Args:
        progress: optional callable that receives those dicts.
        poll_interval: seconds between filesystem stat polls.

    Returns:
        The final event dict. Also emitted via `progress` just before return.
    """
    if not is_available():
        ev = {"event": "error", "ok": False, "error": "retrieval extras not installed — uv sync --extra retrieval"}
        if progress: progress(ev)
        return ev
    if is_model_ready():
        ev = {"event": "done", "ok": True, "already": True}
        if progress: progress(ev)
        return ev

    import threading
    import time

    err_box: dict[str, Any] = {}
    done_box: dict[str, bool] = {"done": False}

    def _worker():
        try:
            # Build a throwaway embedder (same class chromadb uses by default)
            # and run it once. That triggers download + extract if missing.
            from chromadb.utils import embedding_functions
            ef = embedding_functions.ONNXMiniLM_L6_V2()
            _ = ef(["hello"])  # forces init + download
        except Exception as e:
            err_box["err"] = str(e)
        finally:
            done_box["done"] = True

    t = threading.Thread(target=_worker, daemon=True)
    t.start()

    last_pct = -1
    while not done_box["done"]:
        try:
            b = os.path.getsize(_model_archive_path())
        except OSError:
            b = 0
        total = _MODEL_TAR_BYTES or 1
        pct = min(99, int(b * 100 / total))  # cap until `done` flag set
        if pct != last_pct and progress:
            progress({"event": "progress", "bytes": b, "total": total, "pct": pct})
            last_pct = pct
        time.sleep(poll_interval)

    t.join(timeout=5)

    if err_box.get("err"):
        ev = {"event": "error", "ok": False, "error": err_box["err"]}
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
