"""Author-clustering helpers for the audience-personas pipeline.

Pure-deterministic. Two-stage approach:

1. **Embed** each author's concatenated post history with the existing
   ChromaDB MiniLM model (already shipped in the palace). Reusing that
   embedder means zero extra deps and the embeddings live in the same
   vector space the rest of the app already knows.

2. **Cluster** with k-means at k ∈ {3, 5, 7} and pick the k with the
   highest silhouette score. Uses sklearn's k-means when it's installed,
   otherwise falls back to a pure-numpy k-means++ + silhouette
   implementation (`_np_kmeans` / `_np_silhouette`). numpy is always
   present whenever clustering runs (the chromadb embedder pulls it), so
   no new requirement is added — and a sklearn-less venv/bundle no longer
   breaks the Audience tab.

Outputs are stable: each cluster carries a centroid, member author IDs,
and a tightness score. Re-running on the same corpus produces the same
labels (with k-means++ seed pinned).

Importable from `research/audience.py`. No I/O — pure compute.
"""
from __future__ import annotations

import math
from collections import Counter, defaultdict
from typing import Any, Iterable, Sequence

# Module-level lazy imports so a missing optional dep never crashes
# import-time of this file (every other research/ helper imports cleanly
# even without the retrieval extras installed).
_NUMPY = None
_KMEANS = None
_SILHOUETTE = None


def _lazy_numpy():
    global _NUMPY
    if _NUMPY is None:
        import numpy as np  # type: ignore
        _NUMPY = np
    return _NUMPY


def _lazy_sklearn():
    global _KMEANS, _SILHOUETTE
    if _KMEANS is None:
        from sklearn.cluster import KMeans  # type: ignore
        from sklearn.metrics import silhouette_score  # type: ignore
        _KMEANS = KMeans
        _SILHOUETTE = silhouette_score
    return _KMEANS, _SILHOUETTE


# ── Author feature vectors ────────────────────────────────────────────

def author_post_blocks(rows: Iterable[dict]) -> dict[str, list[dict]]:
    """Group post rows by author. Drops [deleted]/AutoModerator/blank."""
    out: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        a = (r.get("author") or "").strip()
        if not a or a in ("[deleted]", "AutoModerator", "deleted"):
            continue
        out[a].append(r)
    return out


def filter_min_posts(blocks: dict[str, list[dict]], min_posts: int = 3) -> dict[str, list[dict]]:
    """Drop authors with fewer than `min_posts` to avoid drive-by noise."""
    return {a: rows for a, rows in blocks.items() if len(rows) >= min_posts}


def author_concatenated_text(rows: Sequence[dict], char_cap: int = 4000) -> str:
    """One blob per author: titles + bodies joined, capped to char_cap.
    Recent posts come first so trimming preserves the latest signal."""
    rows = sorted(rows, key=lambda r: r.get("created_utc") or 0, reverse=True)
    parts: list[str] = []
    total = 0
    for r in rows:
        t = (r.get("title") or "").strip()
        b = (r.get("selftext") or r.get("body") or "").strip()
        chunk = (t + ("\n" + b if b else "")).strip()
        if not chunk:
            continue
        if total + len(chunk) > char_cap:
            chunk = chunk[: max(0, char_cap - total)]
        parts.append(chunk)
        total += len(chunk)
        if total >= char_cap:
            break
    return "\n\n".join(parts).strip()


def embed_authors(blocks: dict[str, list[dict]]) -> tuple[list[str], list[list[float]]] | None:
    """Embed each author's concatenated text via the palace's embedding
    function. Returns (author_ids, vectors) or None when the embedder
    is unavailable (caller falls back to a feature-vector cluster)."""
    try:
        from ..retrieval.embedder import get_embedding_function
    except Exception:
        return None
    ef = None
    try:
        ef = get_embedding_function()
    except Exception:
        return None
    if ef is None:
        return None
    authors = sorted(blocks.keys())
    docs = [author_concatenated_text(blocks[a]) or a for a in authors]
    try:
        vecs = ef(docs)
    except Exception:
        return None
    # ChromaDB's embedder may return numpy arrays or list-of-list; coerce.
    out: list[list[float]] = []
    for v in vecs:
        try:
            out.append(list(map(float, v)))
        except Exception:
            return None
    return authors, out


# ── Clustering ────────────────────────────────────────────────────────

def pick_k(n_samples: int, candidates: Sequence[int] = (3, 5, 7)) -> list[int]:
    """k must be ≥2 and ≤ n_samples − 1 to be usable for silhouette."""
    return [k for k in candidates if 2 <= k <= max(2, n_samples - 1)]


def _np_kmeans(np, X, k: int, seed: int, n_iter: int = 50):
    """Pure-numpy k-means++ — deterministic for a fixed seed. Returns
    (labels int-array, centroids float-array). Fallback for when sklearn
    isn't installed; numpy is always present whenever clustering runs."""
    rng = np.random.default_rng(seed)
    n = X.shape[0]
    # k-means++ seeding: each new center is chosen with prob ∝ squared
    # distance to the nearest already-chosen center.
    centers = [X[int(rng.integers(n))]]
    for _ in range(1, k):
        C = np.asarray(centers, dtype="float32")
        d2 = ((X[:, None, :] - C[None, :, :]) ** 2).sum(axis=2).min(axis=1)
        total = float(d2.sum())
        if total <= 1e-12:
            centers.append(X[int(rng.integers(n))])
        else:
            centers.append(X[int(rng.choice(n, p=d2 / total))])
    C = np.asarray(centers, dtype="float32")
    labels = np.full(n, -1, dtype="int64")
    for _ in range(n_iter):
        # assign via ‖x-c‖² = ‖x‖² + ‖c‖² − 2x·c (n×k, memory-cheap)
        d = (X ** 2).sum(1)[:, None] + (C ** 2).sum(1)[None, :] - 2.0 * (X @ C.T)
        new_labels = d.argmin(axis=1)
        new_C = np.stack([
            X[new_labels == j].mean(axis=0) if bool((new_labels == j).any()) else C[j]
            for j in range(k)
        ]).astype("float32")
        done = np.array_equal(new_labels, labels) and np.allclose(new_C, C)
        labels, C = new_labels, new_C
        if done:
            break
    return labels, C


def _np_silhouette(np, X, labels) -> float:
    """Mean silhouette coefficient (numpy). O(n²) pairwise distance — fine
    for the tens-to-low-hundreds of authors audience clustering produces."""
    labels = np.asarray(labels)
    n = X.shape[0]
    sq = (X ** 2).sum(axis=1)
    D = np.sqrt(np.maximum(sq[:, None] + sq[None, :] - 2.0 * (X @ X.T), 0.0))
    uniq = list(dict.fromkeys(labels.tolist()))
    sil = np.zeros(n, dtype="float64")
    for i in range(n):
        same = labels == labels[i]
        same[i] = False
        a = float(D[i, same].mean()) if bool(same.any()) else 0.0
        b = math.inf
        for c in uniq:
            if c == labels[i]:
                continue
            m = labels == c
            if bool(m.any()):
                b = min(b, float(D[i, m].mean()))
        denom = max(a, b)
        sil[i] = 0.0 if (b is math.inf or denom <= 0.0) else (b - a) / denom
    return float(sil.mean())


def kmeans_with_silhouette(
    vectors: Sequence[Sequence[float]],
    candidates: Sequence[int] = (3, 5, 7),
    *,
    random_state: int = 42,
) -> dict[str, Any]:
    """Try each k in `candidates`, pick the one with the highest
    silhouette score. Returns
    `{ok, k, labels, silhouette, centroids, all_scores, backend}`.
    Returns `{ok: False, reason}` only when vectors are missing/too small —
    a missing sklearn now falls back to a pure-numpy implementation rather
    than failing the whole Audience build."""
    if not vectors:
        return {"ok": False, "reason": "no vectors"}
    try:
        np = _lazy_numpy()
    except Exception as e:
        return {"ok": False, "reason": f"numpy unavailable: {e!s:.150}"}

    arr = np.asarray(vectors, dtype="float32")
    if arr.ndim != 2 or arr.shape[0] < 4:
        return {"ok": False, "reason": "need ≥4 samples to cluster"}

    valid_k = pick_k(arr.shape[0], candidates=candidates)
    if not valid_k:
        return {"ok": False, "reason": "no valid k for this sample size"}

    # Prefer sklearn when installed (battle-tested); otherwise the numpy
    # fallback keeps Audience working. The old code assumed sklearn was a
    # transitive dep of chromadb/sentence-transformers — it isn't, in the
    # venv OR the PyInstaller bundle, which broke the whole tab.
    try:
        KMeans, silhouette_score = _lazy_sklearn()
        use_sklearn = True
    except Exception:
        use_sklearn = False

    best: dict[str, Any] | None = None
    all_scores: dict[int, float] = {}
    for k in valid_k:
        try:
            if use_sklearn:
                km = KMeans(n_clusters=k, n_init=10, random_state=random_state)
                labels_arr = km.fit_predict(arr)
                centroids = km.cluster_centers_.tolist()
            else:
                labels_arr, centroids_arr = _np_kmeans(np, arr, k, random_state)
                centroids = centroids_arr.tolist()
            labels_list = labels_arr.tolist()
            # Need at least 2 distinct labels for silhouette to be defined.
            if len(set(labels_list)) < 2:
                continue
            score = (
                float(silhouette_score(arr, labels_arr)) if use_sklearn
                else _np_silhouette(np, arr, labels_arr)
            )
            all_scores[k] = score
            if best is None or score > best["silhouette"]:
                best = {
                    "k": k,
                    "labels": labels_list,
                    "silhouette": score,
                    "centroids": centroids,
                }
        except Exception:
            continue

    if best is None:
        return {"ok": False, "reason": "no k produced ≥2 clusters"}
    best["ok"] = True
    best["all_scores"] = all_scores
    best["backend"] = "sklearn" if use_sklearn else "numpy"
    return best


def per_cluster_tightness(
    vectors: Sequence[Sequence[float]],
    labels: Sequence[int],
    centroids: Sequence[Sequence[float]],
) -> dict[int, float]:
    """Mean cosine similarity of each member to its centroid. 1.0 = tight."""
    np = _lazy_numpy()
    arr = np.asarray(vectors, dtype="float32")
    cents = np.asarray(centroids, dtype="float32")
    out: dict[int, float] = {}
    for cid in sorted(set(labels)):
        members = arr[np.asarray(labels) == cid]
        if len(members) == 0:
            out[cid] = 0.0
            continue
        c = cents[cid]
        # Cosine sim
        denom = (np.linalg.norm(members, axis=1) * (np.linalg.norm(c) + 1e-9) + 1e-9)
        sims = (members @ c) / denom
        out[cid] = float(np.mean(sims))
    return out


# ── Cluster summarization (pure-text features) ────────────────────────

_STOPWORDS = frozenset({
    "a", "an", "and", "or", "the", "of", "to", "for", "in", "on", "at",
    "by", "with", "from", "as", "is", "are", "was", "were", "be", "been",
    "this", "that", "these", "those", "it", "its", "i", "we", "you", "they",
    "my", "our", "your", "but", "not", "no", "so", "if", "then", "than",
    "do", "does", "did", "have", "has", "had", "will", "would", "can",
    "could", "should", "may", "might", "about", "into", "out", "over",
    "after", "before", "while", "when", "what", "which", "who", "how",
    "just", "really", "very", "much", "more", "some", "any", "all", "every",
    "one", "two", "three", "like", "also", "well", "even", "still", "ever",
    "never", "always", "their", "them", "there", "here", "now", "then",
    "im", "ive", "id", "ill", "youre", "youve", "thats", "isnt", "dont",
    "didnt", "wasnt", "arent", "doesnt", "wont", "cant",
})


def _tokens(text: str) -> list[str]:
    """Simple alphanumeric tokenizer with lowercasing + stopword removal."""
    import re
    return [
        t for t in re.findall(r"[a-zA-Z][a-zA-Z0-9_+#-]{2,}", (text or "").lower())
        if t not in _STOPWORDS
    ]


def vocab_signatures(
    cluster_text: str,
    corpus_texts: Sequence[str],
    top_k: int = 20,
) -> list[str]:
    """TF-IDF-style top-k tokens that distinguish this cluster from the
    rest of the corpus. Pure Python — no numpy required."""
    cluster_tokens = _tokens(cluster_text)
    if not cluster_tokens:
        return []
    cluster_freq = Counter(cluster_tokens)
    cluster_n = len(cluster_tokens)
    corpus_freqs = [Counter(_tokens(t)) for t in corpus_texts]
    n_docs = max(1, len(corpus_texts))
    out: list[tuple[str, float]] = []
    for term, count in cluster_freq.items():
        if count < 2:
            continue
        tf = count / cluster_n
        df = sum(1 for cf in corpus_freqs if term in cf)
        if df == n_docs:
            continue  # term in every cluster — not distinctive
        idf = math.log((n_docs + 1) / (df + 1)) + 1.0
        out.append((term, tf * idf))
    out.sort(key=lambda x: -x[1])
    return [w for w, _ in out[:top_k]]


def top_subs_for_cluster(
    rows: Iterable[dict],
    *,
    top_n: int = 3,
) -> list[dict[str, Any]]:
    """Return the top sub × source for a cluster's posts."""
    counts: Counter = Counter()
    for r in rows:
        ctype = (r.get("source_type") or "reddit").strip()
        sub = (r.get("sub") or ctype).strip()
        counts[(ctype, sub)] += 1
    return [
        {"type": ctype, "name": sub, "posts": n}
        for (ctype, sub), n in counts.most_common(top_n)
    ]


def activity_heatmap(rows: Iterable[dict]) -> list[list[float]]:
    """7 × 24 matrix of avg engagement (score + comments). Empty cells stay 0."""
    from datetime import datetime, timezone
    grid: list[list[list[float]]] = [[[] for _ in range(24)] for _ in range(7)]
    for r in rows:
        ts = r.get("created_utc")
        if not ts:
            continue
        try:
            dt = datetime.fromtimestamp(float(ts), tz=timezone.utc)
        except (TypeError, ValueError, OSError):
            continue
        eng = float((r.get("score") or 0) + (r.get("num_comments") or 0))
        grid[dt.weekday()][dt.hour].append(eng)
    return [
        [round(sum(c) / len(c), 2) if c else 0.0 for c in row]
        for row in grid
    ]


def says_wants_hates(rows: Iterable[dict]) -> dict[str, list[str]]:
    """Lightweight extraction of clauses by linguistic cue.

    Pure heuristic — looks for sentences starting with cue patterns.
    Doesn't beat an LLM but produces something on offline / no-key
    installs. The LLM augment overrides these when present.

    SAYS  : sentences that look like quotes / first-person reports
    WANTS : "I wish / I'd love / I want / it would be great if"
    HATES : "I hate / I can't stand / annoyed / frustrating"
    """
    import re
    says, wants, hates = [], [], []
    SAYS_CUES = re.compile(r"\b(I (?:think|feel|believe|find|noticed)|to be honest|honestly)\b", re.I)
    WANT_CUES = re.compile(r"\b(I wish|I want|I'?d love|would (?:be )?(?:great|nice)|need(?:s|ed)?)\b", re.I)
    HATE_CUES = re.compile(r"\b(hate|can'?t stand|annoy(?:s|ed|ing)|frustrat(?:e|ed|ing)|bug(?:s|ged)?|broken)\b", re.I)
    seen: set[str] = set()
    for r in rows:
        text = ((r.get("title") or "") + " " + (r.get("selftext") or "")).strip()
        if not text:
            continue
        for sent in re.split(r"(?<=[.!?])\s+", text)[:8]:
            s = sent.strip()
            if not s or len(s) > 240:
                continue
            key = s.lower()[:120]
            if key in seen:
                continue
            seen.add(key)
            if SAYS_CUES.search(s):
                says.append(s)
            if WANT_CUES.search(s):
                wants.append(s)
            if HATE_CUES.search(s):
                hates.append(s)
            if len(says) >= 6 and len(wants) >= 6 and len(hates) >= 6:
                break
        if len(says) >= 6 and len(wants) >= 6 and len(hates) >= 6:
            break
    return {"says": says[:6], "wants": wants[:6], "hates": hates[:6]}


def exemplar_post(rows: Iterable[dict]) -> dict | None:
    """Highest-engagement single post in a cluster."""
    best = None
    best_eng = -1
    for r in rows:
        eng = (r.get("score") or 0) + 2 * (r.get("num_comments") or 0)
        if eng > best_eng:
            best_eng = eng
            best = r
    return dict(best) if best is not None else None
