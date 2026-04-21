"""Phase-4 Monitoring Engine — weekly topic refresh + delta tracking.

Runs on schedule (launchd/cron) to re-collect scheduled topics, re-run
the Insight Engine synthesis, and record **what changed** vs. the
previous run. The delta feeds the Dashboard's "What's changed this
week" card — the retention hook that pulls users back every Monday.

See docs/ROADMAP.md §"Phase 4 — Monitoring Mode + Weekly Delta View"
for the spec. Companion to:
  - research/insights.py (synthesis engine)
  - research/hypothesis_tracker.py (Phase 3)
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any

from ..core.db import get_db


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _report_hash(report: dict) -> str:
    """Stable hash of the report's substantive content (ignores timestamps).

    Used to dedup near-identical re-runs — if the user refreshes at 10am
    and 10:05am, the deltas row can be skipped. Only hashes findings
    titles + opportunity scores + competitor names — coarse enough to
    ignore prose variation in the executive_summary but fine enough to
    detect any real change in opportunity ranking.
    """
    signature = {
        "findings": sorted([
            (f.get("title"), round(f.get("opportunity_score", 0), 1))
            for f in (report.get("findings") or [])
        ]),
        "competitors": sorted([c.get("name") for c in (report.get("competitors") or [])]),
    }
    h = hashlib.sha256(
        json.dumps(signature, sort_keys=True, default=str).encode("utf-8")
    )
    return h.hexdigest()[:16]


def compute_delta(
    prev_report: dict | None, cur_report: dict
) -> dict[str, Any]:
    """Diff two Insight Engine reports, return a delta summary.

    Returns dict with:
      - findings_added: list of {title, opportunity_score, kind}
      - findings_removed: list of {title, opportunity_score, kind}
      - score_changes: list of {title, prev_score, cur_score, delta} for
        findings that exist in both but with score drift ≥ 1.0
      - competitors_added: list of {name}
      - competitors_removed: list of {name}
      - new_academic_papers: count of papers cited in cur that weren't in prev
      - corpus_size_change: cur - prev (posts considered)
      - total_change_magnitude: sum of absolute changes (for ranking topics)

    First-run case (prev_report=None): everything in cur_report is
    "added". Used for the initial seed.
    """
    if not prev_report:
        return {
            "findings_added": [
                {
                    "title": f.get("title", ""),
                    "opportunity_score": f.get("opportunity_score", 0),
                    "kind": f.get("kind", ""),
                }
                for f in (cur_report.get("findings") or [])
            ],
            "findings_removed": [],
            "score_changes": [],
            "competitors_added": [
                {"name": c.get("name", "")}
                for c in (cur_report.get("competitors") or [])
            ],
            "competitors_removed": [],
            "new_academic_papers": _count_unique_papers(cur_report),
            "corpus_size_change": (
                (cur_report.get("corpus_coverage") or {}).get("total_posts_considered") or 0
            ),
            "is_first_run": True,
            "total_change_magnitude": 999,  # first runs always top the dashboard
        }

    prev_findings = {f.get("title"): f for f in (prev_report.get("findings") or []) if f.get("title")}
    cur_findings = {f.get("title"): f for f in (cur_report.get("findings") or []) if f.get("title")}

    findings_added = [
        {
            "title": title,
            "opportunity_score": f.get("opportunity_score", 0),
            "kind": f.get("kind", ""),
        }
        for title, f in cur_findings.items() if title not in prev_findings
    ]
    findings_removed = [
        {
            "title": title,
            "opportunity_score": f.get("opportunity_score", 0),
            "kind": f.get("kind", ""),
        }
        for title, f in prev_findings.items() if title not in cur_findings
    ]
    score_changes = []
    for title in set(prev_findings) & set(cur_findings):
        prev_s = float(prev_findings[title].get("opportunity_score") or 0)
        cur_s = float(cur_findings[title].get("opportunity_score") or 0)
        if abs(cur_s - prev_s) >= 1.0:  # only surface meaningful drift
            score_changes.append({
                "title": title,
                "prev_score": round(prev_s, 1),
                "cur_score": round(cur_s, 1),
                "delta": round(cur_s - prev_s, 1),
            })
    # Sort score changes by magnitude (biggest movers first)
    score_changes.sort(key=lambda x: abs(x["delta"]), reverse=True)

    prev_competitors = {c.get("name") for c in (prev_report.get("competitors") or [])}
    cur_competitors = {c.get("name") for c in (cur_report.get("competitors") or [])}
    competitors_added = [{"name": n} for n in (cur_competitors - prev_competitors) if n]
    competitors_removed = [{"name": n} for n in (prev_competitors - cur_competitors) if n]

    prev_posts = (prev_report.get("corpus_coverage") or {}).get("total_posts_considered") or 0
    cur_posts = (cur_report.get("corpus_coverage") or {}).get("total_posts_considered") or 0

    # Magnitude drives dashboard ranking: what "moved" most this run?
    magnitude = (
        len(findings_added) * 3
        + len(findings_removed) * 2
        + sum(abs(c["delta"]) for c in score_changes)
        + len(competitors_added) * 2
        + len(competitors_removed)
    )

    return {
        "findings_added": findings_added,
        "findings_removed": findings_removed,
        "score_changes": score_changes,
        "competitors_added": competitors_added,
        "competitors_removed": competitors_removed,
        "new_academic_papers": max(
            0,
            _count_unique_papers(cur_report) - _count_unique_papers(prev_report),
        ),
        "corpus_size_change": cur_posts - prev_posts,
        "is_first_run": False,
        "total_change_magnitude": round(magnitude, 1),
    }


def _count_unique_papers(report: dict) -> int:
    """Count distinct academic paper post_ids cited anywhere in the report."""
    ids = set()
    for f in report.get("findings") or []:
        for pid in f.get("academic_backing") or []:
            if pid:
                ids.add(pid)
    return len(ids)


def record_run(
    topic: str,
    trigger: str,
    report: dict | None,
    error: str | None = None,
    prev_report: dict | None = None,
) -> int:
    """Persist a topic_runs row. Computes delta if prev_report given.

    `report` should be the return value of `synthesize_insights`. Pass
    `error` (string) instead of report if the refresh failed — the row
    is still recorded so the UI can show failed runs.

    Returns the row id.
    """
    db = get_db()
    now = _utc_now()
    delta = compute_delta(prev_report, report) if report else None
    corpus_size = 0
    findings_count = 0
    report_hash = ""
    if report:
        corpus_size = (report.get("corpus_coverage") or {}).get("total_posts_considered") or 0
        findings_count = len(report.get("findings") or [])
        report_hash = _report_hash(report)
    row = {
        "topic": topic,
        "run_at": now,
        "ended_at": now,  # for now, same as run_at; streaming later
        "trigger": trigger,
        "corpus_size": corpus_size,
        "findings_count": findings_count,
        "delta_json": json.dumps(delta or {}, ensure_ascii=False),
        "report_hash": report_hash,
        "error": error,
    }
    pk = db["topic_runs"].insert(row).last_pk
    return int(pk)


def get_previous_report(topic: str) -> dict | None:
    """Fetch the most recent saved synthesis report for this topic.

    Returns the `report_json` from `topic_insights`. Returns None if
    no prior report exists (first-ever run on this topic).
    """
    from .insights import load_insights
    return load_insights(topic)


def list_recent_runs(
    topic: str | None = None, limit: int = 20
) -> list[dict]:
    """Return recent refresh runs, newest first. Hydrates delta_json."""
    db = get_db()
    if topic:
        rows = list(db.query(
            "SELECT * FROM topic_runs WHERE topic = ? "
            "ORDER BY run_at DESC LIMIT ?",
            [topic, limit],
        ))
    else:
        rows = list(db.query(
            "SELECT * FROM topic_runs ORDER BY run_at DESC LIMIT ?",
            [limit],
        ))
    out = []
    for r in rows:
        d = dict(r)
        try:
            d["delta"] = json.loads(d.get("delta_json") or "{}")
        except Exception:
            d["delta"] = {}
        out.append(d)
    return out


def dashboard_deltas(limit: int = 10, since_days: int = 7) -> list[dict]:
    """Top-N most impactful deltas across all topics for the dashboard.

    "Impactful" = sorted by `total_change_magnitude` (new findings count
    more than score shifts, which count more than competitor list churn).
    Only returns runs within the last `since_days`.
    """
    from datetime import timedelta
    cutoff = (datetime.now(timezone.utc) - timedelta(days=since_days)).isoformat(timespec="seconds")
    db = get_db()
    rows = list(db.query(
        "SELECT * FROM topic_runs WHERE run_at >= ? AND error IS NULL "
        "ORDER BY run_at DESC",
        [cutoff],
    ))
    # Parse deltas, sort by magnitude, take top N
    hydrated = []
    for r in rows:
        d = dict(r)
        try:
            d["delta"] = json.loads(d.get("delta_json") or "{}")
        except Exception:
            d["delta"] = {}
        hydrated.append(d)
    # Dedup to most recent run per topic
    seen_topics = set()
    deduped = []
    for r in hydrated:
        if r["topic"] in seen_topics:
            continue
        seen_topics.add(r["topic"])
        deduped.append(r)
    deduped.sort(
        key=lambda r: float((r.get("delta") or {}).get("total_change_magnitude") or 0),
        reverse=True,
    )
    return deduped[:limit]


def run_topic_refresh(
    topic: str,
    trigger: str = "manual",
    skip_collect: bool = False,
) -> dict[str, Any]:
    """Re-run collect + synthesize for a topic, record the delta.

    `skip_collect=True` skips the Reddit/source collect and only re-runs
    synthesize on the existing corpus. Useful when the data is fresh
    but the prompt/model changed. `skip_collect=False` (default) does
    a full collect first.

    Returns:
        {
          "ok": True,
          "topic": topic,
          "run_id": int,
          "delta": {...},
          "report": {...},  # full synthesized report
        }
    or:
        {"ok": False, "topic": topic, "error": "..."}
    """
    from .insights import synthesize_insights

    # Grab previous report BEFORE re-running synth so we can diff
    prev = get_previous_report(topic)
    if prev and prev.get("_cached"):
        # Strip cache markers — not part of the report content
        prev = {k: v for k, v in prev.items() if not k.startswith("_")}

    # (Optional) re-collect. For now, skip unless caller asked — reuse
    # existing corpus. Full collect in monitor mode is expensive; leave
    # that to the user's explicit "Run collect" button.
    if not skip_collect:
        try:
            from .collect import collect
            # No aggressive flag — monitor runs stay cheap
            collect(topic=topic, progress=None)
        except Exception as e:
            # Don't block synth if collect fails — use whatever corpus exists
            pass

    try:
        report = synthesize_insights(topic=topic, persist=True)
    except Exception as e:
        run_id = record_run(topic, trigger, None, error=str(e))
        return {"ok": False, "topic": topic, "error": str(e), "run_id": run_id}

    if not report or not report.get("ok"):
        err = (report or {}).get("error") or (report or {}).get("reason") or "synth returned no report"
        run_id = record_run(topic, trigger, None, error=err)
        # Propagate structured error fields (error_code, provider) so the UI
        # can render a direct-action CTA — e.g. "Switch provider in Settings"
        # when error_code='credits_exhausted' instead of a generic Retry.
        return {
            "ok": False,
            "topic": topic,
            "error": err,
            "run_id": run_id,
            "error_code": (report or {}).get("error_code"),
            "provider": (report or {}).get("provider"),
        }

    run_id = record_run(topic, trigger, report, prev_report=prev)
    delta = compute_delta(prev, report)
    return {
        "ok": True,
        "topic": topic,
        "run_id": run_id,
        "delta": delta,
        "report": report,
    }


def tick(skip_collect: bool = True) -> dict[str, Any]:
    """Process all scheduled topics — called by launchd weekly cron.

    Finds topics where `topic_prefs.scheduled = 1`, runs refresh on
    each, returns a summary. Errors per-topic don't block the rest.
    """
    db = get_db()
    if "topic_prefs" not in db.table_names():
        return {"ok": True, "processed": 0, "note": "no scheduled topics"}
    scheduled = [
        r["topic"]
        for r in db.query(
            "SELECT topic FROM topic_prefs WHERE scheduled = 1"
        )
    ]
    results = []
    for t in scheduled:
        results.append(run_topic_refresh(t, trigger="scheduled", skip_collect=skip_collect))
    return {
        "ok": True,
        "processed": len(scheduled),
        "results": results,
    }


__all__ = [
    "compute_delta",
    "record_run",
    "list_recent_runs",
    "dashboard_deltas",
    "run_topic_refresh",
    "tick",
]
