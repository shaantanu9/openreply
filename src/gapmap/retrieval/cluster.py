"""Cluster near-duplicate findings by embedding + cosine similarity.

Runs AFTER the LLM extractor produces painpoints/features/workarounds/products
but BEFORE `upsert_semantic` persists them. Groups labels whose embeddings
share cosine similarity ≥ threshold, keeps the representative with the highest
frequency, and attaches the others as `aliases`.

Skip-gracefully: if chromadb isn't installed (no palace), returns the input
unchanged so the enrich path keeps working without the retrieval extras.
"""
from __future__ import annotations

import logging
import math
import os
from typing import Any

logger = logging.getLogger(__name__)


def _embeddings_available() -> bool:
    """Test seam — monkeypatch to simulate missing chromadb."""
    try:
        import chromadb  # noqa: F401
        return True
    except ImportError:
        return False


def _label_of(kind: str, item: dict) -> str:
    if kind == "painpoints":
        return item.get("painpoint") or item.get("title") or ""
    if kind == "feature_wishes":
        return item.get("feature") or item.get("title") or ""
    if kind == "product_complaints":
        return (item.get("product") or "") + " — " + (item.get("complaint") or "")
    if kind == "diy_workarounds":
        return item.get("workaround") or ""
    return item.get("title") or ""


def _freq(item: dict) -> int:
    f = item.get("frequency")
    if isinstance(f, int):
        return f
    if isinstance(f, str) and f.isdigit():
        return int(f)
    evc = item.get("example_post_ids") or []
    return len(evc)


def _embed_labels(labels: list[str]) -> list[list[float]] | None:
    """Embed via the shared embedder (default MiniLM or multilingual). None on any failure."""
    try:
        from .embedder import get_embedding_function
        fn = get_embedding_function()
        if fn is None:
            return None
        return fn(labels)
    except Exception as e:
        logger.debug("cluster: embedding failed, passthrough: %s", e)
        return None


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a)) or 1e-9
    nb = math.sqrt(sum(x * x for x in b)) or 1e-9
    return dot / (na * nb)


def _cluster_one_kind(kind: str, items: list[dict], threshold: float) -> list[dict]:
    """Greedy single-linkage clustering by cosine similarity ≥ threshold."""
    if len(items) < 2:
        return items
    labels = [_label_of(kind, it) for it in items]
    vectors = _embed_labels(labels)
    if vectors is None:
        return items

    parent = list(range(len(items)))
    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    def union(i: int, j: int) -> None:
        pi, pj = find(i), find(j)
        if pi != pj:
            parent[pi] = pj

    for i in range(len(items)):
        for j in range(i + 1, len(items)):
            if _cosine(vectors[i], vectors[j]) >= threshold:
                union(i, j)

    clusters: dict[int, list[int]] = {}
    for i in range(len(items)):
        clusters.setdefault(find(i), []).append(i)

    out: list[dict] = []
    for idxs in clusters.values():
        if len(idxs) == 1:
            out.append(items[idxs[0]])
            continue
        winner_idx = max(idxs, key=lambda i: _freq(items[i]))
        winner = dict(items[winner_idx])
        winner["aliases"] = [labels[i] for i in idxs if i != winner_idx]
        total_freq = sum(_freq(items[i]) for i in idxs)
        if total_freq:
            winner["frequency"] = total_freq
        merged: list[str] = []
        for i in idxs:
            merged.extend(items[i].get("example_post_ids") or [])
        if merged:
            seen = set()
            dedup = []
            for e in merged:
                if e not in seen:
                    seen.add(e)
                    dedup.append(e)
            winner["example_post_ids"] = dedup
        out.append(winner)
    return out


def cluster_findings(
    findings: dict[str, list[dict]],
    threshold: float | None = None,
) -> dict[str, list[dict]]:
    """Cluster near-duplicates within each finding kind.

    Args:
        findings: {"painpoints": [...], "feature_wishes": [...], ...}
        threshold: cosine similarity threshold. Falls back to
                   GAPMAP_CLUSTER_THRESHOLD env var, then 0.82.
    """
    if not _embeddings_available():
        return findings
    if threshold is None:
        try:
            threshold = float(os.getenv("GAPMAP_CLUSTER_THRESHOLD", "0.82"))
        except ValueError:
            threshold = 0.82

    out: dict[str, list[dict]] = {}
    for kind, items in findings.items():
        if isinstance(items, list):
            out[kind] = _cluster_one_kind(kind, items, threshold)
        else:
            out[kind] = items
    return out
