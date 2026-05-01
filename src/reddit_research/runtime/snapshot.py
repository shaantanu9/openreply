"""runtime_snapshot — one-shot view of every queue/job surface.

Categories returned:
    - active   : running collects + active streams + running mcp jobs
    - queued   : extraction_queue rows pending + queued mcp jobs
    - recent   : last 25 finished operations across all categories
    - usage    : today's token spend + last 7 days totals
    - meta     : counts, db file path, last-error summary

Each row is a dict with a stable shape:
    { id, kind, status, title, subtitle, started_at, ended_at,
      duration_ms, progress_pct, progress_msg, error, params }

The kind values are namespaced by source to keep the UI legend simple:
    collect / stream / extract / mcp / sweep / paper

Idempotent and read-only. Safe to poll every 2 s.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any

from ..core.db import get_db, init_schema


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _duration_ms(started: str | None, ended: str | None) -> int | None:
    """ISO-8601 → ms. Returns None for missing or unparseable values."""
    if not started:
        return None
    try:
        s = datetime.fromisoformat(str(started).replace("Z", "+00:00"))
        e = (
            datetime.fromisoformat(str(ended).replace("Z", "+00:00"))
            if ended
            else datetime.now(timezone.utc)
        )
        delta_s = (e - s).total_seconds()
        return max(0, int(delta_s * 1000))
    except Exception:
        return None


def _safe_json(s: str | None) -> dict[str, Any]:
    if not s:
        return {}
    try:
        v = json.loads(s)
        return v if isinstance(v, dict) else {}
    except Exception:
        return {}


def _row_collect(r: dict[str, Any], *, running: bool) -> dict[str, Any]:
    params = _safe_json(r.get("params_json"))
    topic = (params.get("topic") or params.get("source") or "").strip() or "—"
    started = r.get("started_at")
    ended = r.get("ended_at")
    return {
        "id": f"fetch:{r.get('id')}",
        "kind": "collect",
        "status": "running" if running else (
            "error" if r.get("error") else "finished"
        ),
        "title": f"Collect — {r.get('kind') or 'unknown'}",
        "subtitle": f"topic: {topic}",
        "started_at": started,
        "ended_at": ended,
        "duration_ms": _duration_ms(started, ended),
        "progress_pct": None,
        "progress_msg": None,
        "rows": int(r.get("rows") or 0),
        "error": r.get("error") or None,
        "params": params,
        "cancellable": False,  # collects are tracked via fetches; cancel
                               # happens at the runner layer via existing
                               # cancel_active_job tauri command.
    }


def _row_extract_pending(topic: str, n: int) -> dict[str, Any]:
    """One synthetic row per topic showing pending extraction backlog."""
    return {
        "id": f"extract:{topic}",
        "kind": "extract",
        "status": "queued",
        "title": "LLM enrichment queue",
        "subtitle": f"topic: {topic}",
        "started_at": None,
        "ended_at": None,
        "duration_ms": None,
        "progress_pct": None,
        "progress_msg": f"{n:,} posts pending",
        "rows": int(n),
        "error": None,
        "params": {"topic": topic, "pending": n},
        "cancellable": False,
    }


def _row_mcp(r: dict[str, Any]) -> dict[str, Any]:
    state = (r.get("state") or "").lower()
    started = r.get("started_at") or r.get("created_at")
    ended = r.get("finished_at")
    args = _safe_json(r.get("args_json"))
    args_brief = ", ".join(
        f"{k}={str(v)[:40]}" for k, v in list(args.items())[:3]
    )
    return {
        "id": f"mcp:{r.get('job_id')}",
        "kind": "mcp",
        "status": (
            "queued" if state in ("queued", "pending") else
            "running" if state == "running" else
            "error" if state == "failed" else
            "cancelled" if state == "cancelled" else
            "finished"
        ),
        "title": f"MCP — {r.get('tool_name')}",
        "subtitle": args_brief or "(no args)",
        "started_at": started,
        "ended_at": ended,
        "duration_ms": _duration_ms(started, ended),
        "progress_pct": r.get("progress_pct"),
        "progress_msg": r.get("progress_msg"),
        "rows": None,
        "error": r.get("error") or None,
        "params": args,
        "cancellable": state in ("queued", "running"),
        "heartbeat_at": r.get("heartbeat_at"),
    }


def _row_stream(r: dict[str, Any]) -> dict[str, Any]:
    started = r.get("started_at")
    return {
        "id": f"stream:{r.get('id')}",
        "kind": "stream",
        "status": "running" if r.get("active") else "finished",
        "title": f"Watch — r/{r.get('sub') or '?'}",
        "subtitle": (r.get("keywords") or "(firehose)")[:80],
        "started_at": started,
        "ended_at": None,
        "duration_ms": _duration_ms(started, None),
        "progress_pct": None,
        "progress_msg": None,
        "rows": None,
        "error": None,
        "params": {
            "sub": r.get("sub"),
            "keywords": r.get("keywords"),
            "name": r.get("name"),
        },
        "cancellable": True,
    }


def _row_sweep(r: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": f"sweep:{r.get('id')}",
        "kind": "sweep",
        "status": "error" if r.get("error") else "finished",
        "title": f"Product sweep — {r.get('product_id')}",
        "subtitle": (
            f"{r.get('signals_generated') or 0} signals · {r.get('posts_added') or 0} posts · {r.get('trigger') or 'manual'}"
        ),
        "started_at": r.get("run_at"),
        "ended_at": r.get("run_at"),
        "duration_ms": int(r.get("duration_ms") or 0) or None,
        "progress_pct": None,
        "progress_msg": None,
        "rows": int(r.get("posts_added") or 0),
        "error": r.get("error") or None,
        "params": {"product_id": r.get("product_id"), "trigger": r.get("trigger")},
        "cancellable": False,
    }


def runtime_snapshot(*, recent_limit: int = 25) -> dict[str, Any]:
    """Single-call view of every queue/job surface in the app."""
    db = get_db()
    init_schema(db)

    active: list[dict] = []
    queued: list[dict] = []
    recent: list[dict] = []

    # ── Collects (fetches table) ───────────────────────────────────────
    try:
        running_fetches = list(db.query(
            "SELECT id, kind, params_json, started_at, ended_at, rows, error "
            "FROM fetches WHERE ended_at IS NULL "
            "ORDER BY started_at DESC LIMIT 50"
        ))
    except Exception:
        running_fetches = []
    active.extend(_row_collect(r, running=True) for r in running_fetches)

    try:
        recent_fetches = list(db.query(
            "SELECT id, kind, params_json, started_at, ended_at, rows, error "
            "FROM fetches WHERE ended_at IS NOT NULL "
            "ORDER BY ended_at DESC LIMIT ?", [recent_limit]
        ))
    except Exception:
        recent_fetches = []
    recent.extend(_row_collect(r, running=False) for r in recent_fetches)

    # ── Watch streams ──────────────────────────────────────────────────
    try:
        active_streams = list(db.query(
            "SELECT id, name, sub, keywords, started_at, active "
            "FROM streams WHERE active = 1"
        ))
    except Exception:
        active_streams = []
    active.extend(_row_stream(r) for r in active_streams)

    # ── Extraction queue (synthesized — one row per topic with a backlog) ──
    extraction_total = 0
    try:
        topic_pending = list(db.query(
            "SELECT topic, count(*) AS n FROM extraction_queue "
            "WHERE attempted_at IS NULL OR attempted_at = '' "
            "GROUP BY topic ORDER BY n DESC LIMIT 50"
        ))
    except Exception:
        topic_pending = []
    for r in topic_pending:
        n = int(r.get("n") or 0)
        if n <= 0:
            continue
        extraction_total += n
        queued.append(_row_extract_pending(r["topic"], n))

    # ── MCP jobs (mcp_jobs table) ──────────────────────────────────────
    try:
        if "mcp_jobs" in db.table_names():
            running_jobs = list(db.query(
                "SELECT * FROM mcp_jobs WHERE state IN ('queued','running') "
                "ORDER BY created_at DESC LIMIT 50"
            ))
            recent_jobs = list(db.query(
                "SELECT * FROM mcp_jobs WHERE state IN ('finished','failed','cancelled','interrupted') "
                "ORDER BY coalesce(finished_at, created_at) DESC LIMIT ?",
                [recent_limit],
            ))
        else:
            running_jobs, recent_jobs = [], []
    except Exception:
        running_jobs, recent_jobs = [], []
    for r in running_jobs:
        row = _row_mcp(r)
        (queued if row["status"] == "queued" else active).append(row)
    recent.extend(_row_mcp(r) for r in recent_jobs)

    # ── Product sweeps ─────────────────────────────────────────────────
    try:
        if "product_sweeps" in db.table_names():
            recent_sweeps = list(db.query(
                "SELECT * FROM product_sweeps ORDER BY run_at DESC LIMIT ?",
                [recent_limit],
            ))
        else:
            recent_sweeps = []
    except Exception:
        recent_sweeps = []
    recent.extend(_row_sweep(r) for r in recent_sweeps)

    # ── Resource usage — today's tokens + 7-day rollup ─────────────────
    today = datetime.now().strftime("%Y-%m-%d")
    today_tokens_in = today_tokens_out = today_usd = 0
    week_tokens_in = week_tokens_out = week_usd = 0
    by_provider: list[dict] = []
    try:
        if "extraction_daily_usage" in db.table_names():
            for r in db.query(
                "SELECT sum(tokens_in) AS ti, sum(tokens_out) AS to_, sum(est_usd) AS u "
                "FROM extraction_daily_usage WHERE day = ?", [today],
            ):
                today_tokens_in = int(r.get("ti") or 0)
                today_tokens_out = int(r.get("to_") or 0)
                today_usd = float(r.get("u") or 0.0)
            for r in db.query(
                "SELECT sum(tokens_in) AS ti, sum(tokens_out) AS to_, sum(est_usd) AS u "
                "FROM extraction_daily_usage WHERE day >= date('now','-6 days')"
            ):
                week_tokens_in = int(r.get("ti") or 0)
                week_tokens_out = int(r.get("to_") or 0)
                week_usd = float(r.get("u") or 0.0)
            by_provider = list(db.query(
                "SELECT provider, model, sum(tokens_in) AS ti, sum(tokens_out) AS to_, "
                "sum(est_usd) AS u FROM extraction_daily_usage "
                "WHERE day >= date('now','-6 days') "
                "GROUP BY provider, model ORDER BY u DESC LIMIT 10"
            ))
    except Exception:
        pass

    # ── Recent — sort all categories by ended_at desc, cap to limit ────
    def _sort_key(r: dict) -> str:
        return r.get("ended_at") or r.get("started_at") or ""
    recent.sort(key=_sort_key, reverse=True)
    recent = recent[:recent_limit]

    return {
        "ok": True,
        "captured_at": _utc_now_iso(),
        "active": active,
        "queued": queued,
        "recent": recent,
        "counts": {
            "active": len(active),
            "queued": len(queued),
            "recent": len(recent),
            "extraction_pending_total": extraction_total,
            "running_collects": sum(1 for r in active if r["kind"] == "collect"),
            "running_streams": sum(1 for r in active if r["kind"] == "stream"),
            "running_mcp": sum(1 for r in active if r["kind"] == "mcp"),
            "queued_mcp": sum(1 for r in queued if r["kind"] == "mcp"),
        },
        "usage": {
            "today": {
                "day": today,
                "tokens_in": today_tokens_in,
                "tokens_out": today_tokens_out,
                "est_usd": round(today_usd, 4),
            },
            "last_7_days": {
                "tokens_in": week_tokens_in,
                "tokens_out": week_tokens_out,
                "est_usd": round(week_usd, 4),
            },
            "by_provider": [
                {
                    "provider": r["provider"],
                    "model": r["model"],
                    "tokens_in": int(r.get("ti") or 0),
                    "tokens_out": int(r.get("to_") or 0),
                    "est_usd": round(float(r.get("u") or 0.0), 4),
                }
                for r in by_provider
            ],
        },
        "meta": {
            "db_path": str(db.conn.execute("PRAGMA database_list").fetchone()[2])
                       if hasattr(db, "conn") else "",
            "pid": os.getpid(),
        },
    }
