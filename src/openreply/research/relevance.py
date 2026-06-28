"""Topic relevance gate — stops garbage posts from landing in topic_posts
and drops off-topic findings before they hit the graph.

Why this exists: Reddit search on "meditation and sound frequency brainwave
app" happily returns posts from r/politics, r/news, r/Disney — short token
overlap, wildly unrelated semantics. Without a gate, 9,500 garbage posts →
LLM → "Lack of transparency in law enforcement" painpoint surfaced for a
meditation app.

Three public functions, all embedding-based (ChromaDB MiniLM):

  * `score_posts(topic, posts, batch_size=64)` → list of (post_id, score)
  * `filter_topic_posts(topic, threshold=0.30, apply=False)` → drop/untag off-topic
  * `filter_findings(topic, findings, threshold=0.45)` → drop off-topic findings

Thresholds intentionally different:
  * Post gate 0.30 (recall-leaning — a single on-topic sentence in a 500-word
    post should still pass)
  * Finding gate 0.45 (precision-leaning — a finding that isn't semantically
    close to the topic means the LLM hallucinated or mis-clustered)

Graceful degradation: if chromadb missing, returns everything as passing and
stamps `_relevance_skipped: true` — never silently drop data when the gate
can't run.
"""
from __future__ import annotations

import logging
import math
from typing import Any, Iterable

from ..core.db import get_db

logger = logging.getLogger(__name__)


# ─── Embedding helpers ─────────────────────────────────────────────────
def _embeddings_available() -> bool:
    try:
        import chromadb  # noqa: F401
        return True
    except ImportError:
        return False


def _embed(texts: list[str]) -> list[list[float]] | None:
    """Single batched call through the shared embedder (default or multilingual)."""
    if not texts:
        return []
    try:
        from ..retrieval.embedder import get_embedding_function
        fn = get_embedding_function()
        if fn is None:
            return None
        return fn(texts)
    except Exception as e:
        logger.debug("relevance: embed failed: %s", e)
        return None


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a)) or 1e-9
    nb = math.sqrt(sum(x * x for x in b)) or 1e-9
    return dot / (na * nb)


def _post_text(row: dict) -> str:
    """What we feed the embedder for a post. Title + first 600 chars of body.

    Clamping selftext keeps embedding cost bounded on novella-length posts.
    Reddit and HN titles usually carry most of the topic signal; we add body
    for the short-title case ("Help?" with meaningful content beneath).
    """
    t = (row.get("title") or "").strip()
    body = (row.get("selftext") or "").strip()
    return (t + "\n" + body[:600]).strip() or "(empty post)"


# ─── Public API ────────────────────────────────────────────────────────
def score_posts(
    topic: str,
    posts: list[dict] | None = None,
    batch_size: int = 64,
) -> list[tuple[str, float]]:
    """Return [(post_id, cosine_to_topic)]. Higher = more relevant.

    If `posts` is None, scores all posts currently tagged under `topic`.
    """
    if not _embeddings_available():
        return []
    db = get_db()
    if posts is None:
        posts = list(db.query(
            "SELECT p.id, p.title, p.selftext "
            "FROM posts p JOIN topic_posts tp ON tp.post_id = p.id "
            "WHERE tp.topic = ?",
            [topic],
        ))
    if not posts:
        return []

    # Embed the topic once; each post once. Single 2-step batch.
    topic_vec_list = _embed([topic])
    if not topic_vec_list:
        return []
    topic_vec = topic_vec_list[0]

    out: list[tuple[str, float]] = []
    for i in range(0, len(posts), batch_size):
        chunk = posts[i:i + batch_size]
        texts = [_post_text(r) for r in chunk]
        vectors = _embed(texts)
        if vectors is None:
            # Partial failure — count everything remaining as passing so we
            # don't silently drop user data on a transient embed error.
            for r in chunk:
                out.append((r["id"], 1.0))
            continue
        for row, vec in zip(chunk, vectors):
            out.append((row["id"], _cosine(topic_vec, vec)))
    return out


def filter_topic_posts(
    topic: str,
    threshold: float = 0.30,
    apply: bool = False,
    min_keep: int = 20,
) -> dict[str, Any]:
    """Un-tag posts whose cosine to the topic falls below `threshold`.

    Args:
        topic: topic slug
        threshold: min cosine to keep (default 0.30 — recall-leaning)
        apply: if False (default), dry-run; returns what would be dropped
                without touching the DB. If True, deletes from topic_posts.
        min_keep: safety floor — never drop below this many posts even if
                  everything scores low (prevents nuking a nascent topic
                  from a cold embedder).

    Returns:
        {ok, topic, scored, kept, dropped, dropped_ids, threshold,
         dry_run, skipped?}
    """
    if not _embeddings_available():
        return {"ok": True, "skipped": True,
                "reason": "chromadb missing — install retrieval extras to filter corpus"}

    scores = score_posts(topic)
    if not scores:
        return {"ok": True, "topic": topic, "scored": 0,
                "kept": 0, "dropped": 0, "dropped_ids": [],
                "reason": "no posts tagged to this topic"}

    # Sort ascending so min_keep protection preserves the best survivors.
    scores.sort(key=lambda t: t[1])
    n_total = len(scores)
    n_to_keep_floor = max(min_keep, n_total - len([s for s in scores if s[1] < threshold]))
    # Candidates for drop = bottom-scoring below threshold, BUT never enough
    # drops to bring total below n_to_keep_floor.
    candidates = [(pid, sc) for pid, sc in scores if sc < threshold]
    max_drops = max(0, n_total - max(min_keep, 0))
    drops = candidates[:max_drops]

    dropped_ids = [pid for pid, _ in drops]
    if apply and dropped_ids:
        db = get_db()
        placeholders = ",".join(["?"] * len(dropped_ids))
        db.conn.execute(
            f"DELETE FROM topic_posts WHERE topic = ? AND post_id IN ({placeholders})",
            [topic, *dropped_ids],
        )
        db.conn.commit()

    # Small sample of what was / would be dropped for the UI
    sample_dropped = []
    if drops:
        db = get_db()
        sample_ids = [pid for pid, _ in drops[:10]]
        ph = ",".join(["?"] * len(sample_ids))
        sample = list(db.query(
            f"SELECT id, title, sub FROM posts WHERE id IN ({ph})",
            sample_ids,
        ))
        score_by_id = dict(drops)
        for r in sample:
            sample_dropped.append({
                "id": r["id"],
                "title": (r.get("title") or "")[:120],
                "sub": r.get("sub") or "",
                "score": round(score_by_id.get(r["id"], 0), 3),
            })

    return {
        "ok": True,
        "topic": topic,
        "threshold": threshold,
        "scored": n_total,
        "kept": n_total - len(dropped_ids),
        "dropped": len(dropped_ids),
        "dropped_ids": dropped_ids[:500],  # cap payload
        "sample_dropped": sample_dropped,
        "dry_run": not apply,
        "min_keep": min_keep,
    }


def filter_findings(
    topic: str,
    findings: list[dict],
    threshold: float = 0.45,
    label_key: str = "title",
    alt_keys: tuple[str, ...] = ("painpoint", "feature", "workaround", "name"),
) -> dict[str, Any]:
    """Drop findings whose label is semantically off-topic.

    The LLM, handed a garbage corpus, will extract garbage findings — this
    is the last gate before persisting to the graph. Precision-leaning
    threshold (0.45) because a finding that doesn't match the topic is
    almost certainly wrong, not borderline.

    Args:
        findings: list of dicts as returned by find_gaps() / insights
        threshold: min cosine to keep
        label_key: primary field to read for the label
        alt_keys: fallback fields if primary is missing

    Returns:
        {ok, threshold, kept: [...], dropped: [...], scored_count,
         skipped?}

    Dropped findings carry `_relevance_score` + `_dropped_reason` so the
    UI can surface a "dropped 3 off-topic findings" pill.
    """
    if not _embeddings_available():
        return {"ok": True, "skipped": True, "kept": findings, "dropped": [],
                "reason": "chromadb missing"}
    if not findings:
        return {"ok": True, "threshold": threshold,
                "kept": [], "dropped": [], "scored_count": 0}

    def label_of(f: dict) -> str:
        v = f.get(label_key)
        if v: return v
        for k in alt_keys:
            if f.get(k):
                return f[k]
        return ""

    labels = [label_of(f) for f in findings]
    # If any label is empty, skip (we won't gate on nothing — return as passing)
    if any(not lbl for lbl in labels):
        passing_idx = {i for i, lbl in enumerate(labels) if lbl}
        # Embed only non-empty; short-circuit empties through as kept.
        pass
    topic_vec_list = _embed([topic])
    if not topic_vec_list:
        return {"ok": True, "skipped": True, "kept": findings, "dropped": [],
                "reason": "embed topic failed"}
    topic_vec = topic_vec_list[0]

    # Embed non-empty labels only.
    label_idx_map = [i for i, lbl in enumerate(labels) if lbl]
    label_texts = [labels[i] for i in label_idx_map]
    vectors = _embed(label_texts)
    if vectors is None:
        return {"ok": True, "skipped": True, "kept": findings, "dropped": [],
                "reason": "embed labels failed"}
    score_by_orig_idx: dict[int, float] = {}
    for local_idx, orig_idx in enumerate(label_idx_map):
        score_by_orig_idx[orig_idx] = _cosine(topic_vec, vectors[local_idx])

    kept: list[dict] = []
    dropped: list[dict] = []
    for i, f in enumerate(findings):
        sc = score_by_orig_idx.get(i)
        if sc is None:
            # Empty label — let it through rather than silently drop.
            kept.append(f); continue
        if sc >= threshold:
            out = dict(f); out["_relevance_score"] = round(sc, 3)
            kept.append(out)
        else:
            out = dict(f)
            out["_relevance_score"] = round(sc, 3)
            out["_dropped_reason"] = f"relevance {sc:.2f} < {threshold:.2f}"
            dropped.append(out)

    return {
        "ok": True,
        "threshold": threshold,
        "kept": kept,
        "dropped": dropped,
        "scored_count": len(findings),
        "dropped_count": len(dropped),
        "kept_count": len(kept),
    }


__all__ = ["score_posts", "filter_topic_posts", "filter_findings"]
