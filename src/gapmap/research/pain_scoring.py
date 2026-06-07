"""Pain scoring — a single 0-100 score per gap (painpoint).

Competitors (PainOnSocial) score each pain point so users can rank what to
build first. We do the same, transparently, from signals we already have:

    pain_score = 100 * (w_f·frequency_norm + w_i·intensity + w_r·recency)

  - frequency  : the LLM's per-painpoint post count, min-max normalised across
                 the topic's painpoints.
  - intensity  : severity (low/medium/high) blended with the real engagement
                 (score + comments) of the evidence posts.
  - recency    : exponential decay on the newest evidence post's age
                 (half-life ~90 days, env-tunable).

Painpoints come from ``research.gaps.find_gaps(only="painpoints")`` whose
extractor already returns ``{painpoint, evidence, severity, frequency,
example_post_ids}`` (see prompts/painpoints.yaml). Scores are cached per
(topic, gap_id) in the ``gap_scores`` table so the read path is LLM-free.

Weights and half-life are env-tunable:
    PAIN_W_FREQ=0.40  PAIN_W_INTENSITY=0.35  PAIN_W_RECENCY=0.25
    PAIN_RECENCY_HALFLIFE_DAYS=90
"""
from __future__ import annotations

import math
import os
import re as _re
import time
from datetime import datetime, timezone
from typing import Any

from ..core.db import get_db

SEVERITY_MAP = {"low": 0.34, "medium": 0.67, "high": 1.0}


def _slug(s: str) -> str:
    s = _re.sub(r"[^a-zA-Z0-9]+", "-", (s or "").strip().lower()).strip("-")
    return s[:80] or "unnamed"


def _weights() -> tuple[float, float, float]:
    def _f(name: str, default: float) -> float:
        try:
            return float(os.getenv(name) or default)
        except ValueError:
            return default
    wf = _f("PAIN_W_FREQ", 0.40)
    wi = _f("PAIN_W_INTENSITY", 0.35)
    wr = _f("PAIN_W_RECENCY", 0.25)
    total = wf + wi + wr
    if total <= 0:
        return 0.40, 0.35, 0.25
    return wf / total, wi / total, wr / total  # always normalised to sum 1


def _half_life_days() -> float:
    try:
        return float(os.getenv("PAIN_RECENCY_HALFLIFE_DAYS") or 90.0)
    except ValueError:
        return 90.0


def _ensure_table() -> None:
    db = get_db()
    db.execute(
        "CREATE TABLE IF NOT EXISTS gap_scores ("
        " topic TEXT NOT NULL,"
        " gap_id TEXT NOT NULL,"
        " title TEXT,"
        " evidence TEXT,"
        " severity TEXT,"
        " frequency INTEGER,"
        " frequency_norm REAL,"
        " intensity REAL,"
        " recency REAL,"
        " engagement REAL,"
        " pain_score REAL,"
        " sample_post_ids TEXT,"
        " provider TEXT,"
        " updated_at TEXT,"
        " PRIMARY KEY (topic, gap_id))"
    )
    db.conn.commit()


def _post_signals(post_ids: list[str]) -> tuple[float, float]:
    """Return (recency_norm, engagement_norm) for a set of evidence posts.

    recency_norm   = decay on the *newest* post's age (most recent evidence
                     dominates — a fresh complaint matters even amid old ones).
    engagement_norm= log-scaled max(score+comments) across the posts, capped 1.0.
    """
    if not post_ids:
        return 0.0, 0.0
    db = get_db()
    placeholders = ",".join("?" for _ in post_ids)
    rows = list(db.query(
        f"SELECT created_utc, coalesce(score,0) AS score,"
        f" coalesce(num_comments,0) AS num_comments"
        f" FROM posts WHERE id IN ({placeholders})",
        list(post_ids),
    ))
    if not rows:
        return 0.0, 0.0
    now = time.time()
    half_life = _half_life_days()
    newest_age_days = None
    best_engagement = 0.0
    for r in rows:
        cu = r.get("created_utc")
        if cu:
            try:
                age_days = max(0.0, (now - float(cu)) / 86400.0)
                if newest_age_days is None or age_days < newest_age_days:
                    newest_age_days = age_days
            except (TypeError, ValueError):
                pass
        eng = float(r.get("score") or 0) + float(r.get("num_comments") or 0)
        best_engagement = max(best_engagement, eng)
    recency = 0.0
    if newest_age_days is not None:
        recency = 0.5 ** (newest_age_days / half_life)
    # log scale: ~1k combined engagement → 1.0
    engagement = min(1.0, math.log10(best_engagement + 1.0) / 3.0)
    return round(recency, 4), round(engagement, 4)


def score_gaps(
    topic: str,
    *,
    provider: str | None = None,
    corpus_limit: int = 120,
    force: bool = False,
    progress=None,
) -> dict[str, Any]:
    """Compute and persist pain scores for a topic's painpoints.

    Re-runs the painpoint extractor (LLM) over the corpus, scores each
    painpoint, and upserts into ``gap_scores``. Use ``get(topic)`` for the
    LLM-free read path. Returns {ok, scored, top_score, rows} or {ok:False,…}.
    """
    _ensure_table()

    def _log(m: str) -> None:
        if progress:
            try:
                progress(m)
            except Exception:
                pass

    _log("extracting painpoints…")
    from .gaps import find_gaps
    res = find_gaps(topic, provider=provider, only="painpoints",
                    corpus_limit=corpus_limit)
    pains = res.get("painpoints")
    if isinstance(pains, dict) and pains.get("_parse_error"):
        return {"ok": False, "error": "painpoint extraction failed to parse",
                "topic": topic}
    if not isinstance(pains, list) or not pains:
        return {"ok": False, "error": res.get("error") or "no painpoints found",
                "topic": topic, "corpus_size": res.get("corpus_size")}

    wf, wi, wr = _weights()
    prov = res.get("provider") or ""
    # Normalisation base for frequency (min-max → 0..1 across this topic).
    freqs = []
    for p in pains:
        try:
            freqs.append(int(p.get("frequency") or 0))
        except (TypeError, ValueError):
            freqs.append(0)
    max_freq = max(freqs) if freqs else 0
    min_freq = min(freqs) if freqs else 0
    span = (max_freq - min_freq) or 1

    db = get_db()
    now_iso = datetime.now(timezone.utc).isoformat(timespec="seconds")
    scored_rows: list[dict[str, Any]] = []

    for i, p in enumerate(pains):
        title = (p.get("painpoint") or p.get("title") or "").strip()
        if not title:
            continue
        gap_id = _slug(title)
        try:
            freq = int(p.get("frequency") or 0)
        except (TypeError, ValueError):
            freq = 0
        freq_norm = (freq - min_freq) / span if span else 0.0
        severity = str(p.get("severity") or "medium").strip().lower()
        sev_val = SEVERITY_MAP.get(severity, 0.5)
        post_ids = p.get("example_post_ids") or p.get("post_ids") or []
        if not isinstance(post_ids, list):
            post_ids = []
        post_ids = [str(x) for x in post_ids][:10]
        recency, engagement = _post_signals(post_ids)
        # intensity = severity (subjective) blended with real engagement signal
        intensity = round(0.7 * sev_val + 0.3 * engagement, 4)
        pain_score = round(
            100.0 * (wf * freq_norm + wi * intensity + wr * recency), 1
        )
        import json as _json
        db.execute(
            "INSERT INTO gap_scores(topic,gap_id,title,evidence,severity,frequency,"
            "frequency_norm,intensity,recency,engagement,pain_score,sample_post_ids,"
            "provider,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
            " ON CONFLICT(topic,gap_id) DO UPDATE SET title=excluded.title,"
            " evidence=excluded.evidence, severity=excluded.severity,"
            " frequency=excluded.frequency, frequency_norm=excluded.frequency_norm,"
            " intensity=excluded.intensity, recency=excluded.recency,"
            " engagement=excluded.engagement, pain_score=excluded.pain_score,"
            " sample_post_ids=excluded.sample_post_ids, provider=excluded.provider,"
            " updated_at=excluded.updated_at",
            [topic, gap_id, title, str(p.get("evidence") or "")[:500], severity,
             freq, round(freq_norm, 4), intensity, recency, engagement, pain_score,
             _json.dumps(post_ids), prov, now_iso],
        )
        scored_rows.append({
            "gap_id": gap_id, "title": title, "pain_score": pain_score,
            "frequency": freq, "intensity": intensity, "recency": recency,
            "severity": severity, "sample_post_ids": post_ids,
        })

    db.conn.commit()
    scored_rows.sort(key=lambda r: r["pain_score"], reverse=True)
    _log(f"scored {len(scored_rows)} painpoints")
    return {
        "ok": True, "topic": topic, "scored": len(scored_rows),
        "top_score": scored_rows[0]["pain_score"] if scored_rows else 0,
        "weights": {"frequency": wf, "intensity": wi, "recency": wr},
        "rows": scored_rows,
    }


def get(topic: str) -> dict[str, Any]:
    """Return cached pain scores for a topic, highest first (LLM-free)."""
    _ensure_table()
    db = get_db()
    import json as _json
    rows = list(db.query(
        "SELECT gap_id, title, evidence, severity, frequency, frequency_norm,"
        " intensity, recency, engagement, pain_score, sample_post_ids,"
        " provider, updated_at FROM gap_scores WHERE topic = ?"
        " ORDER BY pain_score DESC",
        [topic],
    ))
    for r in rows:
        try:
            r["sample_post_ids"] = _json.loads(r.get("sample_post_ids") or "[]")
        except Exception:
            r["sample_post_ids"] = []
    return {"ok": True, "topic": topic, "count": len(rows), "rows": rows}


def export_csv(topic: str) -> dict[str, Any]:
    """Pain scores as CSV text (rank, title, score, frequency, severity)."""
    import csv
    import io
    data = get(topic)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["rank", "title", "pain_score", "frequency", "severity",
                "intensity", "recency"])
    for i, r in enumerate(data["rows"], 1):
        w.writerow([i, r.get("title", ""), r.get("pain_score", ""),
                    r.get("frequency", ""), r.get("severity", ""),
                    r.get("intensity", ""), r.get("recency", "")])
    return {"ok": True, "topic": topic, "count": data["count"], "csv": buf.getvalue()}


__all__ = ["score_gaps", "get", "export_csv", "SEVERITY_MAP"]
