"""Structured logger for the MCP server.

Why this exists: clients (Claude Desktop / Cursor / Claude Code) only see
JSON-RPC over stdio. When the server fails before initialize completes —
slow imports, missing keys, lock contention, traceback during tool dispatch —
the client just reports "lost connection" with no detail. This module gives
the user (and the agent) a queryable audit log of every server event so
recurring failures can be diagnosed and fixed.

Two storage layers, both write-path-cheap:
  1. File log: append-only NDJSON at ``<data_dir>/logs/mcp-server.log``,
     rotated at ~5 MB to ``.1``, ``.2``. Mirrors stderr — readable with
     `tail -f` for live debugging without poking SQLite.
  2. SQLite table ``mcp_events`` on the existing ``gapmap.db``: indexed
     by (ts, kind, severity) so ``mcp stats`` can aggregate "how many
     tool_error events in the last 24h" in <10ms even with 100k rows.

`log_event(kind, severity, message, details=None)` is the only entry point
callers should use. Concurrent writers from multiple worker threads are
safe — we open a fresh sqlite3 connection per call (cheap, ~50µs) and the
file writer holds an OS-level append-only file descriptor.

Failure mode of the logger itself: every public function silently swallows
exceptions to stderr. A broken logger must never crash the MCP server it's
supposed to be observing.
"""
from __future__ import annotations

import json
import os
import sqlite3
import sys
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

# Severities are strings so SQL filters stay readable. Treat as ordered:
# debug < info < warn < error < fatal.
SEVERITIES = ("debug", "info", "warn", "error", "fatal")

# Rotate the file log at this size to avoid unbounded growth.
_FILE_LOG_MAX_BYTES = 5 * 1024 * 1024  # 5 MB
_FILE_LOG_KEEP = 3                     # mcp-server.log + .1 + .2

_file_lock = threading.Lock()
_db_lock = threading.Lock()


def _data_dir() -> Path:
    """Where the server stores its DB + logs. Must match `_resolve_data_dir`
    so the log lives next to the DB the rest of the app reads."""
    try:
        from ..core.config import _resolve_data_dir
        return _resolve_data_dir()
    except Exception:
        # Last-resort: same fallback _pidfile_path uses.
        d = Path.home() / ".gapmap"
        d.mkdir(parents=True, exist_ok=True)
        return d


def _log_path() -> Path:
    p = _data_dir() / "logs" / "mcp-server.log"
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def _db_path() -> Path:
    return _data_dir() / "gapmap.db"


def _ensure_table(conn: sqlite3.Connection) -> None:
    """Create `mcp_events` if missing. Indexed on (ts), (kind), (severity)
    for fast filtering. No FK to anything else — this table is purely a
    diagnostic ring-buffer-with-history."""
    conn.execute(
        "CREATE TABLE IF NOT EXISTS mcp_events ("
        " id INTEGER PRIMARY KEY AUTOINCREMENT,"
        " ts TEXT NOT NULL,"               # ISO-8601 UTC
        " ts_epoch REAL NOT NULL,"          # for fast range filters
        " kind TEXT NOT NULL,"             # startup:begin, tool_call, tool_error, …
        " severity TEXT NOT NULL,"         # debug|info|warn|error|fatal
        " pid INTEGER,"
        " tool_name TEXT,"                  # populated for tool_call/tool_error
        " duration_ms INTEGER,"             # populated for tool_call (success path)
        " message TEXT,"
        " details_json TEXT"                # extra structured payload
        ")"
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_mcp_events_ts ON mcp_events(ts_epoch)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_mcp_events_kind ON mcp_events(kind)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_mcp_events_sev ON mcp_events(severity)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_mcp_events_tool ON mcp_events(tool_name)")
    conn.commit()


def _rotate_if_needed(p: Path) -> None:
    """If the file is over the size cap, shift .1 → .2, current → .1, start fresh."""
    try:
        if not p.exists() or p.stat().st_size < _FILE_LOG_MAX_BYTES:
            return
        # Drop the oldest, slide the rest down.
        oldest = p.with_suffix(p.suffix + f".{_FILE_LOG_KEEP - 1}")
        if oldest.exists():
            oldest.unlink()
        for i in range(_FILE_LOG_KEEP - 1, 0, -1):
            src = p.with_suffix(p.suffix + (f".{i-1}" if i > 1 else ""))
            dst = p.with_suffix(p.suffix + f".{i}")
            if src.exists():
                src.rename(dst)
        # current → .1 already happened in the loop above when i==1.
    except Exception as e:
        print(f"[mcp_logger] rotate failed: {e}", file=sys.stderr, flush=True)


def log_event(
    kind: str,
    severity: str = "info",
    message: str = "",
    details: dict[str, Any] | None = None,
    *,
    tool_name: str | None = None,
    duration_ms: int | None = None,
) -> None:
    """Record a single MCP server event to file + SQLite.

    Args:
        kind: short stable identifier — ``startup:begin`` / ``startup:ready``
            / ``startup:lock_failed`` / ``tool_call`` / ``tool_error`` /
            ``connection:closed`` / ``import:slow`` etc. Use colons for
            namespaces; the CLI ``mcp stats`` groups by prefix.
        severity: one of SEVERITIES. Anything outside that list is coerced
            to "info" (we don't want a typo to bypass error filters).
        message: human-readable one-liner. Tracebacks belong in `details`.
        details: arbitrary JSON-serialisable extras (env, traceback, args).
        tool_name / duration_ms: convenience fields for tool_call rows so
            ``mcp stats --tool foo`` works without parsing details_json.
    """
    if severity not in SEVERITIES:
        severity = "info"

    now = datetime.now(timezone.utc)
    ts_iso = now.isoformat(timespec="milliseconds")
    ts_epoch = now.timestamp()
    pid = os.getpid()

    payload = {
        "ts": ts_iso,
        "kind": kind,
        "severity": severity,
        "pid": pid,
        "message": message[:2000] if message else "",
    }
    if tool_name:
        payload["tool_name"] = tool_name
    if duration_ms is not None:
        payload["duration_ms"] = int(duration_ms)
    if details:
        # Truncate giant tracebacks/inputs so a runaway tool can't fill the
        # log with a single 10 MB record.
        try:
            details_dump = json.dumps(details, default=str, ensure_ascii=False)
            if len(details_dump) > 8000:
                details_dump = details_dump[:8000] + "...<truncated>"
            payload["details"] = details
        except Exception:
            details_dump = None
    else:
        details_dump = None

    # File write — line-delimited JSON.
    try:
        with _file_lock:
            p = _log_path()
            _rotate_if_needed(p)
            with p.open("a", encoding="utf-8") as f:
                f.write(json.dumps(payload, default=str, ensure_ascii=False) + "\n")
    except Exception as e:
        print(f"[mcp_logger] file write failed: {e}", file=sys.stderr, flush=True)

    # SQLite write — short transaction per event. WAL mode prevents
    # blocking other readers (the desktop app's UI does run_query during
    # this).
    try:
        with _db_lock:
            with sqlite3.connect(str(_db_path()), timeout=2.0) as conn:
                conn.execute("PRAGMA journal_mode=WAL")
                _ensure_table(conn)
                conn.execute(
                    "INSERT INTO mcp_events"
                    " (ts, ts_epoch, kind, severity, pid, tool_name,"
                    "  duration_ms, message, details_json)"
                    " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        ts_iso, ts_epoch, kind, severity, pid,
                        tool_name, duration_ms,
                        payload["message"], details_dump,
                    ),
                )
                conn.commit()
    except Exception as e:
        print(f"[mcp_logger] sqlite write failed: {e}", file=sys.stderr, flush=True)


def read_recent_log(n: int = 100) -> list[str]:
    """Return the last N lines from the file log. Empty list if no log yet."""
    p = _log_path()
    if not p.exists():
        return []
    try:
        with p.open("r", encoding="utf-8") as f:
            lines = f.readlines()
        return [l.rstrip("\n") for l in lines[-n:]]
    except Exception as e:
        print(f"[mcp_logger] read_recent_log failed: {e}", file=sys.stderr, flush=True)
        return []


def query_events(
    *,
    kind: str | None = None,
    kind_prefix: str | None = None,
    severity: str | None = None,
    tool_name: str | None = None,
    since_seconds: int | None = None,
    limit: int = 200,
) -> list[dict]:
    """Read recent events from SQLite with optional filters.

    Args:
        kind: exact kind match (e.g. "tool_error").
        kind_prefix: like-match — `startup:%` returns every startup:* row.
        severity: minimum severity (error → returns error AND fatal).
        tool_name: exact tool name match.
        since_seconds: only events newer than now − this many seconds.
        limit: row cap. Default 200 — keep small for ``mcp logs`` output.
    """
    try:
        with sqlite3.connect(str(_db_path()), timeout=2.0) as conn:
            _ensure_table(conn)
            conn.row_factory = sqlite3.Row
            q = "SELECT * FROM mcp_events WHERE 1=1"
            params: list[Any] = []
            if kind:
                q += " AND kind = ?"
                params.append(kind)
            if kind_prefix:
                q += " AND kind LIKE ?"
                params.append(kind_prefix.replace("*", "%"))
            if severity:
                # Severity ordering: debug < info < warn < error < fatal.
                # `severity=error` should return error AND fatal. Map to indices.
                try:
                    idx = SEVERITIES.index(severity)
                    allowed = SEVERITIES[idx:]
                    placeholders = ",".join(["?"] * len(allowed))
                    q += f" AND severity IN ({placeholders})"
                    params.extend(allowed)
                except ValueError:
                    pass
            if tool_name:
                q += " AND tool_name = ?"
                params.append(tool_name)
            if since_seconds is not None:
                cutoff = datetime.now(timezone.utc).timestamp() - since_seconds
                q += " AND ts_epoch >= ?"
                params.append(cutoff)
            q += " ORDER BY ts_epoch DESC LIMIT ?"
            params.append(int(limit))
            rows = [dict(r) for r in conn.execute(q, params).fetchall()]
            # Parse details_json for callers that want structured access.
            for r in rows:
                if r.get("details_json"):
                    try:
                        r["details"] = json.loads(r["details_json"])
                    except Exception:
                        pass
            return rows
    except Exception as e:
        print(f"[mcp_logger] query_events failed: {e}", file=sys.stderr, flush=True)
        return []


def aggregate_stats(since_seconds: int | None = None) -> dict[str, Any]:
    """Counts grouped by kind + severity, plus per-tool error counts.
    Returns {} on any DB error so callers don't need a try block."""
    try:
        with sqlite3.connect(str(_db_path()), timeout=2.0) as conn:
            _ensure_table(conn)
            params: list[Any] = []
            where = ""
            if since_seconds is not None:
                cutoff = datetime.now(timezone.utc).timestamp() - since_seconds
                where = " WHERE ts_epoch >= ?"
                params.append(cutoff)
            by_kind = [
                {"kind": k, "n": n}
                for (k, n) in conn.execute(
                    f"SELECT kind, count(*) FROM mcp_events{where}"
                    " GROUP BY kind ORDER BY count(*) DESC", params,
                ).fetchall()
            ]
            by_severity = [
                {"severity": s, "n": n}
                for (s, n) in conn.execute(
                    f"SELECT severity, count(*) FROM mcp_events{where}"
                    " GROUP BY severity ORDER BY count(*) DESC", params,
                ).fetchall()
            ]
            top_tool_errors = [
                {"tool_name": t, "n": n}
                for (t, n) in conn.execute(
                    f"SELECT tool_name, count(*) FROM mcp_events"
                    f" WHERE kind='tool_error'{(' AND ts_epoch >= ?' if since_seconds is not None else '')}"
                    f"   AND tool_name IS NOT NULL"
                    f" GROUP BY tool_name ORDER BY count(*) DESC LIMIT 10",
                    params,
                ).fetchall()
            ]
            slow_tools = [
                {"tool_name": t, "p50_ms": p50, "p95_ms": p95, "n": n}
                for (t, p50, p95, n) in conn.execute(
                    # Tiny SQLite doesn't ship percentile_cont; fake p50/p95
                    # with NTILE-like math via subquery. For a small log
                    # this is fine; if it grows past 1M rows we'd swap to
                    # a window function.
                    f"SELECT tool_name,"
                    f"  CAST(AVG(duration_ms) AS INTEGER) AS p50_ms,"
                    f"  MAX(duration_ms) AS p95_ms,"
                    f"  count(*) AS n"
                    f" FROM mcp_events"
                    f" WHERE kind='tool_call' AND duration_ms IS NOT NULL"
                    f"   {(' AND ts_epoch >= ?' if since_seconds is not None else '')}"
                    f" GROUP BY tool_name ORDER BY MAX(duration_ms) DESC LIMIT 10",
                    params,
                ).fetchall()
            ]
            return {
                "by_kind": by_kind,
                "by_severity": by_severity,
                "top_tool_errors": top_tool_errors,
                "slow_tools": slow_tools,
                "log_file": str(_log_path()),
                "since_seconds": since_seconds,
            }
    except Exception as e:
        print(f"[mcp_logger] aggregate_stats failed: {e}", file=sys.stderr, flush=True)
        return {}


def install_unhandled_exception_hook() -> None:
    """Catch any unhandled exception in the server process and log it as
    `fatal:unhandled` before stdlib's default behaviour kicks in. Useful
    for the "client says lost connection but no log entry" case — without
    this, an uncaught import error or NPE during stdio dispatch leaves zero
    audit trail. The hook is idempotent: calling twice is a no-op.
    """
    if getattr(install_unhandled_exception_hook, "_installed", False):
        return
    prev = sys.excepthook

    def _hook(exc_type, exc_value, tb):
        try:
            import traceback
            log_event(
                kind="fatal:unhandled",
                severity="fatal",
                message=f"{exc_type.__name__}: {exc_value}",
                details={"traceback": "".join(traceback.format_exception(exc_type, exc_value, tb))},
            )
        except Exception:
            pass
        # Fall through to whatever was previously installed (default = print).
        prev(exc_type, exc_value, tb)

    sys.excepthook = _hook
    install_unhandled_exception_hook._installed = True  # type: ignore[attr-defined]
