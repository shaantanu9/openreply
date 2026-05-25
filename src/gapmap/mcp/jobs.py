"""Background-job queue for long-running MCP tool calls.

Why this exists: a single `tools/call` over MCP holds the client connection
open for the entire run. For 20-30 min operations (`research_collect` on a
big topic, `palace_reindex`, `paper_fulltext` bulk download) this fights
every client's transport timeout and chat lifecycle. Pattern B from the
2026-04-30 redesign: `gapmap_jobs_submit(tool_name, args)` returns a
`job_id` in milliseconds; the work runs in a `ThreadPoolExecutor` inside
the MCP daemon; the agent polls `gapmap_jobs_get(job_id)` whenever it
wants to. Survives Cursor cycling, chat resets, and (via persistence)
daemon restarts.

Storage: a single `mcp_jobs` SQLite table on the same `gapmap.db` used
by everything else. Auto-created on first import. Heartbeat written
every 10s by the worker so a daemon crash leaves stale rows that the
next startup can mark `interrupted` rather than `running` forever.

Cancellation: cooperative. `submit()` registers a `threading.Event`
keyed by `job_id`; `cancel()` sets it. Tools that want to be cancellable
call `is_cancelled(job_id)` between work units. Existing tools that
don't are left running until they finish — their result is still saved,
the job just stays `cancelled` (cancel-requested) regardless.
"""
from __future__ import annotations

import contextvars
import json
import sqlite3
import threading
import time
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable


class JobCancelled(BaseException):
    """Raised by tools that opt-in to cooperative cancellation when the
    `cancel` flag is observed. Inherits BaseException (not Exception) so
    it propagates through library code that does broad ``except
    Exception`` without being swallowed. The worker catches it and marks
    the row `cancelled` cleanly."""


# Set by the worker before invoking the tool; read by helper functions
# called from within the tool. ContextVars instead of threadlocals so
# the value flows correctly into nested asyncio tasks if any tool ever
# uses them — and so the helpers safely return None outside a job.
_current_job: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "mcp_current_job_id", default=None,
)


def current_job_id() -> str | None:
    """Return the job_id of the currently-running job, or None when the
    tool was called synchronously (i.e. not via gapmap_jobs_submit)."""
    return _current_job.get()

# How long a job_id-keyed result can be before we truncate it. Embedding
# arrays and corpus dumps blow past this — agents should retrieve big
# blobs by paging via the underlying tool, not via job result.
_MAX_RESULT_BYTES = 1_000_000

# How long between heartbeat writes from the worker.
_HEARTBEAT_INTERVAL_S = 10.0

# A worker is "stale" if its heartbeat hasn't been touched in this long.
# Used at startup to reap rows the previous daemon left in `running`.
_STALE_RUNNING_S = 5 * 60  # 5 minutes

# Bounded concurrency. Most long tools are I/O-bound (network fetches,
# SQLite, ChromaDB), so a small pool is plenty and avoids hammering
# rate limits or thrashing the embedding model.
_DEFAULT_MAX_WORKERS = 4

_executor: ThreadPoolExecutor | None = None
_executor_lock = threading.Lock()

# job_id -> Event(set when cancel requested). Lives in-memory only —
# survives daemon restart in DB only as the row's `state=cancelled`,
# but a freshly-restarted daemon won't be running the worker anyway.
_cancel_events: dict[str, threading.Event] = {}
_cancel_lock = threading.Lock()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _db_path() -> Path:
    """Resolve the same SQLite DB the rest of the app uses."""
    from ..core.db import get_db
    db = get_db()
    # get_db() returns a connection; pull the path from PRAGMA.
    cur = db.execute("PRAGMA database_list")
    for row in cur.fetchall():
        # row = (seq, name, file). 'main' is the default attached db.
        if row[1] == "main" and row[2]:
            return Path(row[2])
    raise RuntimeError("could not resolve DB path for jobs persistence")


def _connect() -> sqlite3.Connection:
    """Open a fresh sqlite connection per call. Cheap (~50µs) and
    avoids the cross-thread restriction of sqlite3 default connections.
    Workers run in different threads from the MCP request thread."""
    conn = sqlite3.connect(str(_db_path()), timeout=30.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")  # idempotent
    conn.execute("PRAGMA busy_timeout=30000")
    return conn


def _ensure_schema() -> None:
    """Idempotent CREATE TABLE. Called on every public entry point so
    the first job submission auto-migrates without a separate command."""
    with _connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS mcp_jobs (
                job_id        TEXT PRIMARY KEY,
                tool_name     TEXT NOT NULL,
                args_json     TEXT NOT NULL,
                state         TEXT NOT NULL,
                progress_pct  INTEGER,
                progress_msg  TEXT,
                result_json   TEXT,
                result_truncated INTEGER NOT NULL DEFAULT 0,
                error         TEXT,
                created_at    TEXT NOT NULL,
                started_at    TEXT,
                finished_at   TEXT,
                heartbeat_at  TEXT,
                worker_pid    INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_mcp_jobs_state_created
                ON mcp_jobs(state, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_mcp_jobs_tool
                ON mcp_jobs(tool_name, created_at DESC);
            """
        )
        conn.commit()


def _get_executor() -> ThreadPoolExecutor:
    global _executor
    if _executor is None:
        with _executor_lock:
            if _executor is None:
                _executor = ThreadPoolExecutor(
                    max_workers=_DEFAULT_MAX_WORKERS,
                    thread_name_prefix="mcp-job",
                )
    return _executor


def is_cancelled(job_id: str | None = None) -> bool:
    """Tools call this between work units to honour a cancel request.
    Returns False for unknown job_ids and for synchronous calls (no job
    in flight), so the helper is always safe to wire up unconditionally.

    Pass no argument to mean "the current job in this thread" — the
    common case from inside a tool body.
    """
    if job_id is None:
        job_id = _current_job.get()
    if not job_id:
        return False
    with _cancel_lock:
        ev = _cancel_events.get(job_id)
    return bool(ev and ev.is_set())


def check_cancelled() -> None:
    """Raise JobCancelled if the current job has been cancelled. No-op
    when called outside a job. Tools sprinkle this between work units
    instead of writing the if-statement themselves.
    """
    if is_cancelled():
        raise JobCancelled()


def make_progress_logger(prefix: str = "") -> Callable[[str], None]:
    """Return a CLI-progress-style callable wired to the current job.

    Many existing tools already accept a ``progress=callable(msg)`` for
    CLI logging (`research.collect.collect`, `palace.reindex_all`,
    etc.). This adapts that hook to the job row: every message updates
    `progress_msg`, and any "N/M" / "done" tokens are extracted into
    `progress_pct` heuristically. Outside a job the callable is a no-op.

    Args:
      prefix: optional tag to drop in front of every msg in the row.
    """
    job_id = _current_job.get()
    if not job_id:
        return lambda _msg: None

    import re
    pct_re = re.compile(r"(\d+)\s*/\s*(\d+)")
    pct_pct_re = re.compile(r"(\d+(?:\.\d+)?)\s*%")

    def _log(*args: Any, **kwargs: Any) -> None:
        # Variadic so this adapter works with every progress hook shape
        # in the codebase: `progress(msg)` (collect/reindex/bulk),
        # `progress_cb(kind, payload)` (find_gaps lifecycle), and
        # `progress(event_dict)` (palace.warmup_model). Stringify
        # whatever was passed so the regex pct-extractor still works.
        if not args and not kwargs:
            return
        if len(args) == 1 and not kwargs:
            msg = args[0] if isinstance(args[0], str) else repr(args[0])
        else:
            msg = " ".join(str(a) for a in args)
            if kwargs:
                msg = f"{msg} {kwargs}" if msg else str(kwargs)

        # Cancel check FIRST so a tool that calls progress() between
        # work units becomes cancellable without any other changes —
        # JobCancelled bubbles up to the worker which marks the row.
        with _cancel_lock:
            ev = _cancel_events.get(job_id)
        if ev and ev.is_set():
            raise JobCancelled()

        text = f"{prefix}{msg}" if prefix else msg
        pct: int | None = None
        m = pct_re.search(text)
        if m:
            try:
                num, den = int(m.group(1)), int(m.group(2))
                if den > 0:
                    pct = max(0, min(100, int(num * 100 / den)))
            except Exception:
                pct = None
        if pct is None:
            m2 = pct_pct_re.search(text)
            if m2:
                try:
                    pct = max(0, min(100, int(float(m2.group(1)))))
                except Exception:
                    pct = None
        if "done" in text.lower() and pct is None:
            pct = 100
        report_progress(job_id, pct=pct, msg=text[:500])

    return _log


def report_progress(job_id: str, pct: int | None = None, msg: str | None = None) -> None:
    """Tool-callable progress beacon. Writes to the row + bumps heartbeat.

    Best-effort; swallows any DB error so the wrapping work loop never
    crashes because the queue's progress write hit a lock contention.
    """
    if not job_id:
        return
    try:
        with _connect() as conn:
            conn.execute(
                "UPDATE mcp_jobs SET progress_pct = COALESCE(?, progress_pct), "
                "progress_msg = COALESCE(?, progress_msg), heartbeat_at = ? "
                "WHERE job_id = ?",
                (pct, msg, _now_iso(), job_id),
            )
            conn.commit()
    except Exception:
        pass


def _heartbeat_loop(job_id: str, stop: threading.Event) -> None:
    """Background ticker — touches `heartbeat_at` every 10s so a crashed
    daemon is detectable by the next startup's stale-job sweep."""
    while not stop.wait(_HEARTBEAT_INTERVAL_S):
        try:
            with _connect() as conn:
                conn.execute(
                    "UPDATE mcp_jobs SET heartbeat_at = ? WHERE job_id = ? "
                    "AND state = 'running'",
                    (_now_iso(), job_id),
                )
                conn.commit()
        except Exception:
            # Logger may not be importable in test contexts; don't crash.
            continue


def submit(tool_name: str, args: dict[str, Any], registry: dict[str, Callable]) -> dict[str, Any]:
    """Queue a tool for async execution. Returns immediately with job_id.

    Args:
        tool_name: name as registered with FastMCP (e.g. "gapmap_collect").
        args: kwargs to pass to the underlying tool function.
        registry: tool_name -> underlying callable. Maintained by the
            mcp.server module's tool wrapper.
    """
    _ensure_schema()
    fn = registry.get(tool_name)
    if not fn:
        return {
            "ok": False,
            "error": f"unknown_tool: {tool_name}",
            "hint": "tool must be a registered MCP tool",
        }
    job_id = "j_" + uuid.uuid4().hex[:10]
    args_json = json.dumps(args, default=str)[:50_000]  # cap absurd args
    cancel_event = threading.Event()
    with _cancel_lock:
        _cancel_events[job_id] = cancel_event
    with _connect() as conn:
        conn.execute(
            "INSERT INTO mcp_jobs(job_id, tool_name, args_json, state, "
            "created_at) VALUES (?, ?, ?, 'queued', ?)",
            (job_id, tool_name, args_json, _now_iso()),
        )
        conn.commit()

    def _run() -> None:
        import os
        worker_pid = os.getpid()
        stop_hb = threading.Event()
        hb_thread = threading.Thread(
            target=_heartbeat_loop, args=(job_id, stop_hb),
            daemon=True, name=f"mcp-hb-{job_id}",
        )
        # Mark running BEFORE starting the heartbeat — so the heartbeat
        # update's `state='running'` predicate matches.
        try:
            with _connect() as conn:
                conn.execute(
                    "UPDATE mcp_jobs SET state='running', started_at=?, "
                    "heartbeat_at=?, worker_pid=? WHERE job_id=?",
                    (_now_iso(), _now_iso(), worker_pid, job_id),
                )
                conn.commit()
        except Exception:
            pass
        hb_thread.start()
        # Bind the contextvar so tool-side helpers (current_job_id,
        # check_cancelled, make_progress_logger) work without arg
        # plumbing through every layer.
        token = _current_job.set(job_id)
        # Run the actual tool. Errors are captured to the row, not raised.
        try:
            result = fn(**args)
            result_json = json.dumps(result, default=str)
            truncated = 0
            if len(result_json) > _MAX_RESULT_BYTES:
                # Save a truncated marker plus head bytes so the agent
                # can see something landed.
                head = result_json[: _MAX_RESULT_BYTES - 200]
                result_json = json.dumps({
                    "_truncated": True,
                    "_full_size_bytes": len(json.dumps(result, default=str)),
                    "head_preview": head[:1000],
                    "hint": "result exceeded 1 MB cap; rerun the underlying tool with paging if you need the full payload",
                })
                truncated = 1
            # If cancel was requested while the work was running, prefer
            # `cancelled` over `done` so the agent sees its intent.
            final_state = "cancelled" if cancel_event.is_set() else "done"
            with _connect() as conn:
                conn.execute(
                    "UPDATE mcp_jobs SET state=?, finished_at=?, "
                    "result_json=?, result_truncated=?, progress_pct=100 "
                    "WHERE job_id=?",
                    (final_state, _now_iso(), result_json, truncated, job_id),
                )
                conn.commit()
        except JobCancelled:
            # Cooperative-cancel: tool observed the flag and bailed
            # cleanly. Treat as a normal state transition, not failure.
            try:
                with _connect() as conn:
                    conn.execute(
                        "UPDATE mcp_jobs SET state='cancelled', "
                        "finished_at=?, progress_msg=COALESCE(progress_msg, "
                        "'cancelled by user') WHERE job_id=?",
                        (_now_iso(), job_id),
                    )
                    conn.commit()
            except Exception:
                pass
        except BaseException as e:
            tb = traceback.format_exc()[:6000]
            err_text = f"{type(e).__name__}: {e}\n{tb}"
            try:
                with _connect() as conn:
                    conn.execute(
                        "UPDATE mcp_jobs SET state='failed', finished_at=?, "
                        "error=? WHERE job_id=?",
                        (_now_iso(), err_text, job_id),
                    )
                    conn.commit()
            except Exception:
                pass
        finally:
            _current_job.reset(token)
            stop_hb.set()
            with _cancel_lock:
                _cancel_events.pop(job_id, None)

    _get_executor().submit(_run)
    return {
        "ok": True,
        "job_id": job_id,
        "state": "queued",
        "tool_name": tool_name,
        "hint": "poll with gapmap_jobs_get(job_id) — runs in background, server stays responsive for other tool calls",
    }


def get(job_id: str) -> dict[str, Any]:
    _ensure_schema()
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM mcp_jobs WHERE job_id = ?", (job_id,),
        ).fetchone()
    if not row:
        return {"ok": False, "error": "not_found", "job_id": job_id}
    out = _row_to_dict(row)
    # Inflate result_json into result for convenience when done/cancelled.
    if out.get("state") in ("done", "cancelled") and out.get("result_json"):
        try:
            out["result"] = json.loads(out["result_json"])
        except Exception:
            out["result"] = None
    out["ok"] = True
    return out


def list_jobs(state: str | None = None, limit: int = 50, tool_name: str | None = None) -> dict[str, Any]:
    _ensure_schema()
    limit = max(1, min(int(limit or 50), 500))
    sql = "SELECT job_id, tool_name, state, progress_pct, progress_msg, " \
          "created_at, started_at, finished_at, heartbeat_at, error " \
          "FROM mcp_jobs"
    where, params = [], []
    if state:
        where.append("state = ?")
        params.append(state)
    if tool_name:
        where.append("tool_name = ?")
        params.append(tool_name)
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY created_at DESC LIMIT ?"
    params.append(limit)
    with _connect() as conn:
        rows = conn.execute(sql, params).fetchall()
    return {"ok": True, "count": len(rows), "jobs": [dict(r) for r in rows]}


def cancel(job_id: str) -> dict[str, Any]:
    _ensure_schema()
    with _connect() as conn:
        row = conn.execute(
            "SELECT state FROM mcp_jobs WHERE job_id = ?", (job_id,),
        ).fetchone()
    if not row:
        return {"ok": False, "error": "not_found", "job_id": job_id}
    state = row["state"]
    was_running = state == "running"
    if state in ("done", "failed", "cancelled", "interrupted"):
        return {
            "ok": True,
            "job_id": job_id,
            "state": state,
            "noop": True,
            "hint": f"already {state}",
        }
    # Set in-memory cancel flag (for cooperative tools that check it).
    with _cancel_lock:
        ev = _cancel_events.get(job_id)
    if ev:
        ev.set()
    # Mark queued jobs cancelled immediately. Running jobs stay `running`
    # until the worker observes the cancel (or finishes); the worker's
    # finish path picks `cancelled` over `done` if the flag is set.
    if state == "queued":
        with _connect() as conn:
            conn.execute(
                "UPDATE mcp_jobs SET state='cancelled', finished_at=? "
                "WHERE job_id=? AND state='queued'",
                (_now_iso(), job_id),
            )
            conn.commit()
    return {
        "ok": True,
        "job_id": job_id,
        "was_running": was_running,
        "hint": "cancel flag set; cooperative tools will exit on next is_cancelled() check, others run to completion but the result will be marked cancelled",
    }


def recover_stale() -> dict[str, Any]:
    """Mark stale `running` rows as `interrupted` at server startup.

    The MCP server holds a per-client-tag pidfile lock — only one
    instance runs at a time. So at startup, ANY row in `running` state
    by definition belongs to a dead prior daemon (its workers can't be
    alive). We sweep all of them, plus any `queued` rows that have no
    worker to pick them up.
    """
    _ensure_schema()
    import os as _os
    my_pid = _os.getpid()
    with _connect() as conn:
        rows = conn.execute(
            "SELECT job_id, heartbeat_at, worker_pid FROM mcp_jobs "
            "WHERE state = 'running' AND (worker_pid IS NULL OR worker_pid != ?)",
            (my_pid,),
        ).fetchall()
        interrupted = []
        for r in rows:
            conn.execute(
                "UPDATE mcp_jobs SET state='interrupted', finished_at=?, "
                "error=? WHERE job_id=?",
                (
                    _now_iso(),
                    f"daemon restart while running (worker_pid={r['worker_pid']}, "
                    f"last_heartbeat={r['heartbeat_at']})",
                    r["job_id"],
                ),
            )
            interrupted.append(r["job_id"])
        # Also flush any `queued` rows orphaned by a crash — without a
        # worker there's nobody to pick them up.
        orphaned = conn.execute(
            "SELECT job_id FROM mcp_jobs WHERE state='queued'",
        ).fetchall()
        orphan_ids = []
        for r in orphaned:
            conn.execute(
                "UPDATE mcp_jobs SET state='interrupted', finished_at=?, "
                "error='daemon restart while queued — re-submit if needed' "
                "WHERE job_id=?",
                (_now_iso(), r["job_id"]),
            )
            orphan_ids.append(r["job_id"])
        conn.commit()
    return {
        "ok": True,
        "interrupted_running": interrupted,
        "interrupted_queued": orphan_ids,
    }


def _row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    d = dict(row)
    # Don't return raw JSON when the consumer asked for the dict form.
    return d


def shutdown() -> None:
    """Close the executor cleanly on process exit. Tasks in-flight get
    no SIGTERM — they finish (we don't wait), heartbeat just stops, and
    the next startup marks them interrupted."""
    global _executor
    if _executor is not None:
        try:
            _executor.shutdown(wait=False, cancel_futures=False)
        except Exception:
            pass
        _executor = None
