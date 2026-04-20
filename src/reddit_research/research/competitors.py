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


__all__ = ["build_matrix"]
