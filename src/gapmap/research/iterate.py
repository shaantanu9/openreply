"""In-app autoresearch engine — Karpathy loop persisted to SQLite.

Replaces the Claude Code skill with a backend module the GUI drives.
Three persistent tables:

- `iterate_runs`        — one row per loop execution (run_id, topic, loop_kind,
                          status, started_at, ended_at, best_config_json,
                          best_score, total_iterations, notes).
- `iterate_iterations`  — one row per config tried within a run.
- `topic_pipeline_config` — the WINNING config per (topic, loop_kind), written
                          when the user clicks "Apply best".

The engine itself is dumb on purpose:

  for cfg in grid:
      score, detail = run_one(cfg)
      persist(run_id, cfg, score, detail)
      if score > best.score: best = (cfg, score)

What makes it useful is `apply_best_config()` — when called, it writes
the winning cfg to `topic_pipeline_config` so subsequent calls to
`synthesize_insights` / `audience.build` / etc. read those overrides
and produce the better-tuned output. The improvement *sticks*.

Two built-in loops:

- **deliberate** — sweeps `{rounds × use_llm}` over the cached findings
                   for a topic. Score = balanced confirm + discard rate.
- **audience**   — sweeps `{min_posts × char_cap}` over the cluster
                   builder. Score = silhouette × coverage.

Adding a new loop is a single `_register_loop(name, grid_fn, run_one_fn,
score_fn)` call below.
"""
from __future__ import annotations

import json
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Callable, Iterable

from ..core.db import get_db


# ── Schema ────────────────────────────────────────────────────────────

def _ensure_tables(db) -> None:
    if "iterate_runs" not in db.table_names():
        db["iterate_runs"].create(
            {
                "run_id":           str,
                "topic":            str,
                "loop_kind":        str,
                "status":           str,   # pending | running | done | cancelled | error
                "started_at":       str,
                "ended_at":         str,
                "best_config_json": str,
                "best_score":       float,
                "total_iters":      int,
                "grid_size":        int,
                "notes":            str,
            },
            pk="run_id",
        )
        db["iterate_runs"].create_index(["topic"])
        db["iterate_runs"].create_index(["loop_kind"])
        db["iterate_runs"].create_index(["status"])
    if "iterate_iterations" not in db.table_names():
        db["iterate_iterations"].create(
            {
                "id":          int,
                "run_id":      str,
                "iter_idx":    int,
                "config_json": str,
                "score":       float,
                "kept":        int,    # 1 if this row is the new best at time of insert
                "detail_json": str,
                "ts":          str,
            },
            pk="id",
        )
        db["iterate_iterations"].create_index(["run_id"])
    if "topic_pipeline_config" not in db.table_names():
        db["topic_pipeline_config"].create(
            {
                "topic":         str,
                "loop_kind":     str,
                "config_json":   str,
                "score":         float,
                "applied_at":    str,
                "from_run_id":   str,
            },
            pk=("topic", "loop_kind"),
        )


# ── Loop registry ─────────────────────────────────────────────────────

# Each loop is: { grid: () -> list[dict],
#                 run_one: (topic, cfg) -> (score, detail),
#                 default_grid: list[dict] (fallback when caller didn't
#                                            specify a custom grid). }

LOOPS: dict[str, dict[str, Any]] = {}


def _register_loop(name: str, *, default_grid: list[dict], run_one: Callable[..., tuple[float, dict]]) -> None:
    LOOPS[name] = {"default_grid": default_grid, "run_one": run_one}


# ── deliberate loop ───────────────────────────────────────────────────

_DELIBERATE_GRID = [
    {"rounds": 1, "use_llm": False},
    {"rounds": 1, "use_llm": True},
    {"rounds": 2, "use_llm": True},
    {"rounds": 3, "use_llm": True},
]


def _run_deliberate(topic: str, cfg: dict) -> tuple[float, dict]:
    from .deliberate import deliberate as _deliberate
    db = get_db()
    # Pull cached findings — if none exist, score is 0 and detail says why.
    row = db.execute(
        "SELECT report_json FROM topic_insights WHERE topic = ?", [topic],
    ).fetchone() if "topic_insights" in db.table_names() else None
    if not row or not row[0]:
        return 0.0, {"reason": "no cached insights — run synthesize_insights first"}
    try:
        report = json.loads(row[0])
    except Exception:
        return 0.0, {"reason": "topic_insights row unparseable"}
    items = report.get("findings") or []
    if not items:
        return 0.0, {"reason": "report has zero findings"}
    t0 = time.time()
    res = _deliberate(
        items, topic=topic,
        rounds=int(cfg.get("rounds", 1)),
        use_llm=bool(cfg.get("use_llm", True)),
        persist_log=False,   # deliberate logs every call by default; skip during sweep
    )
    dt = time.time() - t0
    counts = res.get("counts") or {}
    n = sum(counts.values()) or 1
    confirm_rate = counts.get("confirmed", 0) / n
    discard_rate = counts.get("discarded", 0) / n
    # Composite: reward both confirm and discard so we can't game it
    # by tagging everything Confirmed (collapsed personas) or
    # everything Discarded (broken personas).
    score = min(confirm_rate, 0.6) + min(discard_rate, 0.4)
    return score, {
        "confirm_rate": round(confirm_rate, 3),
        "discard_rate": round(discard_rate, 3),
        "counts": counts,
        "n_input": res.get("n_input"),
        "rounds_run": res.get("rounds"),
        "audience_grounded": res.get("audience_grounded"),
        "elapsed_s": round(dt, 2),
    }


_register_loop("deliberate", default_grid=_DELIBERATE_GRID, run_one=_run_deliberate)


# ── audience loop ─────────────────────────────────────────────────────

_AUDIENCE_GRID = [
    {"min_posts": 2, "k_candidates": [3, 5, 7]},
    {"min_posts": 3, "k_candidates": [3, 5, 7]},
    {"min_posts": 5, "k_candidates": [3, 5, 7]},
    {"min_posts": 3, "k_candidates": [5, 7, 10]},
]


def _run_audience(topic: str, cfg: dict) -> tuple[float, dict]:
    from .audience import build_audience_personas
    t0 = time.time()
    res = build_audience_personas(
        topic=topic,
        llm=False,                       # keep sweep fast — LLM is layered later
        provider=None,
        persist=False,                   # don't overwrite the user's cached personas during sweep
        min_posts_per_author=int(cfg.get("min_posts", 3)),
        k_candidates=tuple(cfg.get("k_candidates", [3, 5, 7])),
        apply_overrides=False,           # the sweep IS comparing configs — never re-apply prior best mid-sweep
    )
    dt = time.time() - t0
    if not res.get("ok"):
        return 0.0, {"reason": res.get("error", "build failed"), "elapsed_s": round(dt, 2)}
    personas = res.get("personas") or []
    tightest = max((p.get("tightness", 0.0) for p in personas), default=0.0)
    n_total = res.get("n_authors_total") or 0
    coverage = (res.get("n_authors_clustered", 0) / n_total) if n_total else 0.0
    # Penalise coverage<0.5 hard — a tight cluster of 5/200 authors is
    # worse than a loose cluster of 150/200.
    if coverage < 0.5:
        score = round(tightest * 0.5, 3)
    else:
        score = round(tightest * 0.6 + coverage * 0.4, 3)
    return score, {
        "silhouette": res.get("silhouette"),
        "k": res.get("k"),
        "tightest": tightest,
        "coverage": round(coverage, 3),
        "n_authors_clustered": res.get("n_authors_clustered"),
        "n_authors_total": n_total,
        "elapsed_s": round(dt, 2),
    }


_register_loop("audience", default_grid=_AUDIENCE_GRID, run_one=_run_audience)


# ── Driver ────────────────────────────────────────────────────────────

def start_run(
    topic: str,
    loop_kind: str,
    *,
    grid: list[dict] | None = None,
    notes: str = "",
) -> dict[str, Any]:
    """Create an iterate_runs row in `pending` state. Caller (or the
    background job runner) then invokes `execute_run(run_id)`."""
    if loop_kind not in LOOPS:
        return {"ok": False, "error": f"unknown loop_kind: {loop_kind}. "
                                       f"Available: {list(LOOPS.keys())}"}
    db = get_db()
    _ensure_tables(db)
    grid = grid or LOOPS[loop_kind]["default_grid"]
    run_id = f"itr_{uuid.uuid4().hex[:12]}"
    db["iterate_runs"].insert({
        "run_id":           run_id,
        "topic":            topic,
        "loop_kind":        loop_kind,
        "status":           "pending",
        "started_at":       datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "ended_at":         "",
        "best_config_json": "",
        "best_score":       0.0,
        "total_iters":      0,
        "grid_size":        len(grid),
        "notes":            notes,
    })
    # Stash the grid on the run row's notes so execute_run can rebuild it
    # without an extra arg (transparent to the schema).
    db["iterate_runs"].update(run_id, {
        "notes": json.dumps({"grid": grid, "notes": notes}, ensure_ascii=False),
    })
    return {"ok": True, "run_id": run_id, "grid_size": len(grid),
            "loop_kind": loop_kind, "topic": topic}


def execute_run(run_id: str) -> dict[str, Any]:
    """Synchronously execute a previously-started run. Updates the run
    row to `running` → `done` (or `error`). Designed to be called by
    `gapmap_jobs_submit` so the GUI can poll progress without blocking."""
    db = get_db()
    if "iterate_runs" not in db.table_names():
        return {"ok": False, "error": "iterate_runs table missing"}
    row = db.execute(
        "SELECT topic, loop_kind, status, notes FROM iterate_runs WHERE run_id = ?",
        [run_id],
    ).fetchone()
    if not row:
        return {"ok": False, "error": f"run {run_id} not found"}
    topic, loop_kind, status, notes = row
    if status not in ("pending", "running"):
        return {"ok": False, "error": f"run is in terminal state: {status}"}
    try:
        notes_obj = json.loads(notes) if notes else {}
    except Exception:
        notes_obj = {}
    grid = notes_obj.get("grid") or LOOPS.get(loop_kind, {}).get("default_grid", [])
    run_one = LOOPS.get(loop_kind, {}).get("run_one")
    if not run_one:
        db["iterate_runs"].update(run_id, {
            "status": "error",
            "ended_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        })
        return {"ok": False, "error": f"no runner for loop_kind {loop_kind!r}"}

    db["iterate_runs"].update(run_id, {"status": "running"})

    best_score = -1.0
    best_cfg: dict | None = None
    total = 0
    try:
        for i, cfg in enumerate(grid):
            # Cancel-check
            cur_status = db.execute(
                "SELECT status FROM iterate_runs WHERE run_id = ?", [run_id],
            ).fetchone()
            if cur_status and cur_status[0] == "cancelled":
                break
            try:
                score, detail = run_one(topic, cfg)
            except Exception as e:
                score, detail = 0.0, {"error": str(e)[:200]}
            kept = score > best_score
            if kept:
                best_score = score
                best_cfg = cfg
            total = i + 1
            db["iterate_iterations"].insert({
                "run_id":      run_id,
                "iter_idx":    i,
                "config_json": json.dumps(cfg, ensure_ascii=False),
                "score":       float(score),
                "kept":        1 if kept else 0,
                "detail_json": json.dumps(detail, ensure_ascii=False, default=str),
                "ts":          datetime.now(timezone.utc).isoformat(timespec="seconds"),
            })
            db["iterate_runs"].update(run_id, {
                "total_iters":      total,
                "best_config_json": json.dumps(best_cfg, ensure_ascii=False) if best_cfg else "",
                "best_score":       best_score if best_score > 0 else 0.0,
            })
    except Exception as e:
        db["iterate_runs"].update(run_id, {
            "status":   "error",
            "ended_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "notes":    (notes_obj | {"exec_error": str(e)[:200]}).__repr__(),
        })
        return {"ok": False, "run_id": run_id, "error": str(e)[:200]}

    final_status_row = db.execute(
        "SELECT status FROM iterate_runs WHERE run_id = ?", [run_id],
    ).fetchone()
    final = "cancelled" if (final_status_row and final_status_row[0] == "cancelled") else "done"
    db["iterate_runs"].update(run_id, {
        "status":   final,
        "ended_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    })
    return {
        "ok": True, "run_id": run_id, "topic": topic, "loop_kind": loop_kind,
        "status": final, "total_iters": total,
        "best_score": best_score if best_score > 0 else 0.0,
        "best_config": best_cfg,
    }


def cancel_run(run_id: str) -> dict[str, Any]:
    db = get_db()
    if "iterate_runs" not in db.table_names():
        return {"ok": False, "error": "no runs"}
    db["iterate_runs"].update(run_id, {"status": "cancelled"})
    return {"ok": True, "run_id": run_id, "status": "cancelled"}


def get_run(run_id: str) -> dict[str, Any]:
    db = get_db()
    if "iterate_runs" not in db.table_names():
        return {"ok": False, "error": "no runs"}
    row = db.execute(
        "SELECT * FROM iterate_runs WHERE run_id = ?", [run_id],
    ).fetchone()
    if not row:
        return {"ok": False, "error": f"run {run_id} not found"}
    cols = [c.name for c in db["iterate_runs"].columns]
    rec = dict(zip(cols, row))
    iters = list(db.query(
        "SELECT iter_idx, config_json, score, kept, detail_json, ts "
        "FROM iterate_iterations WHERE run_id = ? ORDER BY iter_idx",
        [run_id],
    ))
    for it in iters:
        try: it["config"] = json.loads(it.pop("config_json") or "{}")
        except Exception: it["config"] = {}
        try: it["detail"] = json.loads(it.pop("detail_json") or "{}")
        except Exception: it["detail"] = {}
    try:
        rec["best_config"] = json.loads(rec.pop("best_config_json") or "null")
    except Exception:
        rec["best_config"] = None
    rec["iterations"] = iters
    return {"ok": True, **rec}


def list_runs(topic: str | None = None, limit: int = 30) -> dict[str, Any]:
    db = get_db()
    if "iterate_runs" not in db.table_names():
        return {"ok": True, "runs": []}
    if topic:
        rows = db.query(
            "SELECT run_id, topic, loop_kind, status, started_at, ended_at, "
            "       best_score, total_iters, grid_size "
            "FROM iterate_runs WHERE topic = ? ORDER BY started_at DESC LIMIT ?",
            [topic, limit],
        )
    else:
        rows = db.query(
            "SELECT run_id, topic, loop_kind, status, started_at, ended_at, "
            "       best_score, total_iters, grid_size "
            "FROM iterate_runs ORDER BY started_at DESC LIMIT ?",
            [limit],
        )
    return {"ok": True, "runs": list(rows)}


def apply_best_config(run_id: str) -> dict[str, Any]:
    """Write the winning config from `run_id` to topic_pipeline_config so
    future calls to the matching pipeline read it as override."""
    db = get_db()
    _ensure_tables(db)
    row = db.execute(
        "SELECT topic, loop_kind, best_config_json, best_score, status "
        "FROM iterate_runs WHERE run_id = ?",
        [run_id],
    ).fetchone()
    if not row:
        return {"ok": False, "error": f"run {run_id} not found"}
    topic, loop_kind, best_json, best_score, status = row
    if status != "done":
        return {"ok": False, "error": f"run is {status!r}, not done — cannot apply"}
    if not best_json or best_json in ("", "null"):
        return {"ok": False, "error": "no best config — run had zero iterations"}
    db["topic_pipeline_config"].upsert({
        "topic":       topic,
        "loop_kind":   loop_kind,
        "config_json": best_json,
        "score":       float(best_score or 0.0),
        "applied_at":  datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "from_run_id": run_id,
    }, pk=("topic", "loop_kind"))
    return {
        "ok": True, "topic": topic, "loop_kind": loop_kind,
        "config": json.loads(best_json), "score": best_score,
    }


def get_applied_config(topic: str, loop_kind: str) -> dict[str, Any] | None:
    """Read the per-topic best config (if applied). Returns None if no
    apply has been done — callers should fall back to defaults."""
    db = get_db()
    if "topic_pipeline_config" not in db.table_names():
        return None
    row = db.execute(
        "SELECT config_json, score, applied_at, from_run_id "
        "FROM topic_pipeline_config WHERE topic = ? AND loop_kind = ?",
        [topic, loop_kind],
    ).fetchone()
    if not row:
        return None
    try:
        cfg = json.loads(row[0]) if row[0] else None
    except Exception:
        return None
    return {
        "config": cfg,
        "score": row[1],
        "applied_at": row[2],
        "from_run_id": row[3],
    }


def list_applied_configs(topic: str) -> dict[str, Any]:
    db = get_db()
    if "topic_pipeline_config" not in db.table_names():
        return {"ok": True, "configs": []}
    rows = list(db.query(
        "SELECT loop_kind, config_json, score, applied_at, from_run_id "
        "FROM topic_pipeline_config WHERE topic = ? ORDER BY applied_at DESC",
        [topic],
    ))
    out = []
    for r in rows:
        try:
            cfg = json.loads(r.get("config_json") or "{}")
        except Exception:
            cfg = {}
        out.append({
            "loop_kind":  r.get("loop_kind"),
            "config":     cfg,
            "score":      r.get("score"),
            "applied_at": r.get("applied_at"),
            "from_run_id": r.get("from_run_id"),
        })
    return {"ok": True, "topic": topic, "configs": out}
