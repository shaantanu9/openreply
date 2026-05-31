"""Regression: author clustering must work WITHOUT scikit-learn.

`_clustering.py` was written assuming sklearn was transitively present
(it isn't — not in the venv, not in the PyInstaller bundle), so the
Audience screen failed with "clustering failed: sklearn unavailable:
No module named 'sklearn'". numpy IS always present whenever clustering
runs (the chromadb embedder pulls it), so clustering must fall back to a
pure-numpy k-means + silhouette implementation.
"""
import numpy as np
import pytest

from gapmap.research._clustering import kmeans_with_silhouette


def _blobs(seed: int = 0) -> np.ndarray:
    """3 well-separated 8-dim blobs, 5 points each (15 samples)."""
    rng = np.random.default_rng(seed)
    return np.vstack([rng.normal(m, 0.05, (5, 8)) for m in (0.0, 5.0, 10.0)])


def test_clusters_without_sklearn():
    res = kmeans_with_silhouette(_blobs().tolist())
    assert res.get("ok") is True, res  # must NOT be {ok: False, sklearn unavailable}
    assert res["k"] == 3
    assert len(res["labels"]) == 15
    assert len(set(res["labels"])) == 3          # 3 distinct clusters recovered
    assert res["silhouette"] > 0.7               # well-separated → high score
    assert len(res["centroids"]) == 3


def test_too_few_samples_still_rejected():
    res = kmeans_with_silhouette(np.zeros((3, 4)).tolist())
    assert res.get("ok") is False
    assert "samples" in res.get("reason", "") or "≥4" in res.get("reason", "")


def test_empty_vectors_rejected():
    assert kmeans_with_silhouette([]).get("ok") is False


def test_deterministic_labels():
    a = kmeans_with_silhouette(_blobs().tolist())
    b = kmeans_with_silhouette(_blobs().tolist())
    assert a["labels"] == b["labels"]            # pinned seed → stable
