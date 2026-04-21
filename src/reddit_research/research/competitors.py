"""Phase-9 — Competitor matrix.

Takes the `competitors` array from a topic_insights report and pivots
it into a feature × competitor table. Each cell indicates whether the
competitor has / lacks / partially-has that feature based on the
LLM's enumerated feature lists per product.

No new LLM calls — reads already-synthesized data. See docs/ROADMAP.md §9.
"""
from __future__ import annotations

import json
import re
from typing import Any

from ..core.db import get_db


def _norm(feature: str) -> str:
    """Normalize a feature label to a dedup key.

    Strips capitalization, punctuation, filler words. Two near-duplicate
    features ("sleep stories" vs "Sleep Stories.") collapse to the same key.
    """
    s = feature.lower().strip()
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    s = re.sub(r"\s+", " ", s)
    stop = {"the", "a", "an", "of", "to", "and", "with", "for"}
    words = [w for w in s.split() if w and w not in stop]
    return " ".join(words)[:40]


def _load_competitors(topic: str) -> list[dict]:
    db = get_db()
    if "topic_insights" not in db.table_names():
        return []
    rows = list(db.query(
        "SELECT report_json FROM topic_insights WHERE topic = ?",
        [topic],
    ))
    if not rows:
        return []
    try:
        report = json.loads(rows[0]["report_json"] or "{}")
    except Exception:
        return []
    return report.get("competitors") or []


def build_matrix(topic: str) -> dict[str, Any]:
    """Build feature × competitor table.

    Cell values:
      - 'has':     feature is in competitor's `features` list
      - 'missing': feature is in another competitor's list but NOT this one
      - 'weakness': feature overlaps with competitor's `weaknesses` (gap signal)
      - 'unknown': no signal either way

    Returns:
        {
          "topic": str,
          "competitors": [{name, pricing_signal}, …],
          "features": [feature_label, …],   # de-duped, sorted by coverage
          "matrix": { feature_key: { competitor_name: status } },
          "coverage_by_feature": { feature_key: n_competitors_with },
          "gap_features": [feature_key, …]  # features NO competitor has
        }
    """
    comps = _load_competitors(topic)
    if not comps:
        return {
            "topic": topic, "competitors": [], "features": [],
            "matrix": {}, "coverage_by_feature": {}, "gap_features": [],
        }

    # Normalize all features across competitors to de-duped keys
    feature_keys: dict[str, str] = {}  # norm_key -> human label (first-seen wording)
    per_competitor_features: dict[str, set[str]] = {}
    per_competitor_weaknesses: dict[str, set[str]] = {}

    for c in comps:
        name = (c.get("name") or "").strip()
        if not name:
            continue
        cfs: set[str] = set()
        cws: set[str] = set()
        for f in c.get("features") or []:
            k = _norm(f)
            if not k:
                continue
            if k not in feature_keys:
                feature_keys[k] = f.strip()
            cfs.add(k)
        for w in c.get("weaknesses") or []:
            k = _norm(w)
            if not k:
                continue
            if k not in feature_keys:
                feature_keys[k] = w.strip()
            cws.add(k)
        per_competitor_features[name] = cfs
        per_competitor_weaknesses[name] = cws

    # Coverage counts — how many competitors have each feature
    coverage = {k: 0 for k in feature_keys}
    for cfs in per_competitor_features.values():
        for k in cfs:
            coverage[k] += 1

    # Build the matrix
    matrix: dict[str, dict[str, str]] = {}
    for k in feature_keys:
        row = {}
        for name in per_competitor_features:
            if k in per_competitor_features[name]:
                row[name] = "has"
            elif k in per_competitor_weaknesses[name]:
                row[name] = "weakness"
            elif coverage[k] > 0:
                # Someone else has it but this one doesn't
                row[name] = "missing"
            else:
                row[name] = "unknown"
        matrix[k] = row

    # Sort features by coverage desc (most-common first)
    sorted_features = sorted(feature_keys.items(),
                             key=lambda kv: (-coverage[kv[0]], kv[1]))
    features_out = [{"key": k, "label": label, "coverage": coverage[k]}
                    for k, label in sorted_features]

    # Gap features — low coverage + many weaknesses suggest unmet needs
    gap_features = [
        f["key"] for f in features_out
        if f["coverage"] == 0 or all(
            matrix[f["key"]][name] in ("weakness", "missing")
            for name in per_competitor_features
        )
    ]

    competitors_out = [
        {"name": (c.get("name") or "").strip(),
         "pricing_signal": c.get("pricing_signal")}
        for c in comps if (c.get("name") or "").strip()
    ]

    return {
        "topic": topic,
        "competitors": competitors_out,
        "features": features_out,
        "matrix": matrix,
        "coverage_by_feature": coverage,
        "gap_features": gap_features,
    }


# ── AG-C: global competitor dedup (T2.5) ──────────────────────────────
#
# Reads `graph_nodes WHERE kind='product'` across ALL topics and clusters
# products whose labels are cosine-similar (≥0.80) via the ChromaDB MiniLM
# embedder used by `graph/relations.py`. Each cluster becomes a unified
# "canonical" competitor with alias list and per-topic breakdown.
#
# No new LLM calls — pure embedding similarity + SQL aggregation. Skips
# gracefully when chromadb isn't installed (returns `skipped:True`) so the
# feature degrades instead of raising in minimal installs.


def _embed_labels(labels: list[str]):
    """Batched embedding via the shared ChromaDB MiniLM function.

    Mirrors `graph/relations.py::_embed` — same model, same fallback path.
    Returns None if embeddings are unavailable (missing `retrieval` extras).
    """
    try:
        from ..retrieval.embedder import get_embedding_function
    except ImportError:
        return None
    try:
        fn = get_embedding_function()
        if fn is None:
            return None
        return fn(labels)
    except Exception:
        return None


def _cosine_sim(a, b) -> float:
    """Cosine similarity between two equal-length float vectors."""
    import math
    dot = 0.0
    na = 0.0
    nb = 0.0
    for x, y in zip(a, b):
        dot += x * y
        na += x * x
        nb += y * y
    if na <= 0 or nb <= 0:
        return 0.0
    return dot / (math.sqrt(na) * math.sqrt(nb))


def _canonical_name(labels: list[str]) -> str:
    """Pick the shortest non-empty label as the canonical form.

    Short labels ("Notion") beat long ones ("Notion – The all-in-one
    workspace for notes & docs") — users want the brand name, not the
    marketing tagline.
    """
    candidates = [l.strip() for l in labels if l and l.strip()]
    if not candidates:
        return "(unnamed)"
    candidates.sort(key=lambda s: (len(s), s.lower()))
    return candidates[0]


def global_competitors(min_topics: int = 2, threshold: float = 0.80) -> dict[str, Any]:
    """Cluster product-kind graph nodes across topics by label similarity.

    Args:
        min_topics: only surface clusters that appear in at least this many
                    distinct topics. Default 2 keeps the output relevant
                    (single-topic products are already visible per-topic).
        threshold: cosine similarity floor for two labels to cluster.
                   0.80 matches our other finding-relevance gates — tight
                   enough to merge "Notion" / "notion.so" but keep "Notion
                   Calendar" separate.

    Returns:
        {
          "ok": bool,
          "skipped": bool,             # true when chromadb unavailable
          "total_products_seen": int,
          "clusters_returned": int,
          "threshold": float,
          "min_topics": int,
          "competitors": [
            {
              "canonical_name": "Notion",
              "aliases": ["notion", "notion.so", ...],   # de-duped labels
              "topics": ["productivity", "notes", ...],  # distinct topics
              "total_mentions": 12,    # sum of node rows (pre-dedup)
            },
            ...
          ]
        }
    """
    db = get_db()
    if "graph_nodes" not in db.table_names():
        return {
            "ok": True, "skipped": True,
            "reason": "graph_nodes table absent — run `research graph build` first",
            "competitors": [],
        }

    rows = list(db.query(
        "SELECT topic, label FROM graph_nodes "
        "WHERE kind = 'product' AND label IS NOT NULL AND label != ''"
    ))
    if not rows:
        return {
            "ok": True, "total_products_seen": 0, "clusters_returned": 0,
            "threshold": threshold, "min_topics": min_topics,
            "competitors": [],
        }

    # Each "item" is one (topic, label) occurrence — preserves per-topic
    # breakdown while we cluster over the unique label set.
    items = [{"topic": (r.get("topic") or "").strip(),
              "label": (r.get("label") or "").strip()} for r in rows]
    items = [i for i in items if i["label"]]

    # Cluster over UNIQUE labels (keeps embedding work bounded even when
    # the same product is mentioned dozens of times across topics).
    unique_labels = sorted({i["label"] for i in items})
    vectors = _embed_labels(unique_labels)
    if vectors is None:
        return {
            "ok": True, "skipped": True,
            "reason": "chromadb embedder unavailable — install `retrieval` extras",
            "total_products_seen": len(items),
            "competitors": [],
        }

    # Greedy single-link clustering. For each label in order, assign to the
    # first existing cluster whose centroid cosine ≥ threshold, else start
    # a new cluster. Good enough at our scale (few hundred products); swap
    # for agglomerative/DBSCAN if we ever break 10k.
    clusters: list[dict[str, Any]] = []  # [{labels, centroid_sum, size}, ...]
    label_to_cluster: dict[str, int] = {}
    for idx, lab in enumerate(unique_labels):
        vec = vectors[idx]
        best_i = -1
        best_sim = 0.0
        for ci, cl in enumerate(clusters):
            centroid = [x / cl["size"] for x in cl["centroid_sum"]]
            sim = _cosine_sim(vec, centroid)
            if sim > best_sim:
                best_sim = sim
                best_i = ci
        if best_i >= 0 and best_sim >= threshold:
            cl = clusters[best_i]
            cl["labels"].append(lab)
            cl["centroid_sum"] = [a + b for a, b in zip(cl["centroid_sum"], vec)]
            cl["size"] += 1
            label_to_cluster[lab] = best_i
        else:
            clusters.append({
                "labels": [lab],
                "centroid_sum": list(vec),
                "size": 1,
            })
            label_to_cluster[lab] = len(clusters) - 1

    # Aggregate items into their cluster buckets.
    bucket: dict[int, dict[str, Any]] = {}
    for it in items:
        ci = label_to_cluster.get(it["label"])
        if ci is None:
            continue
        b = bucket.setdefault(ci, {
            "aliases": set(),
            "topics": set(),
            "total_mentions": 0,
        })
        b["aliases"].add(it["label"])
        if it["topic"]:
            b["topics"].add(it["topic"])
        b["total_mentions"] += 1

    # Build output, filtered to clusters spanning >= min_topics.
    out: list[dict[str, Any]] = []
    for ci, b in bucket.items():
        topics = sorted(b["topics"])
        if len(topics) < min_topics:
            continue
        aliases = sorted(b["aliases"])
        out.append({
            "canonical_name": _canonical_name(aliases),
            "aliases": aliases,
            "topics": topics,
            "total_mentions": b["total_mentions"],
        })

    # Sort by topic-span desc, then mentions desc — most "cross-cutting"
    # competitors surface first in the UI grid.
    out.sort(key=lambda c: (-len(c["topics"]), -c["total_mentions"],
                            c["canonical_name"].lower()))

    return {
        "ok": True,
        "total_products_seen": len(items),
        "clusters_returned": len(out),
        "threshold": threshold,
        "min_topics": min_topics,
        "competitors": out,
    }


__all__ = ["build_matrix", "global_competitors"]
