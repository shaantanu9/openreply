"""Long-lived extraction worker. Drains extraction_queue in batches of 5.

Launched by the Rust supervisor via ``research enrich-worker --serve``. Reads
the ``extraction_queue`` table populated by ``research.collect._tag_posts``
and ``sources.local_file.ingest_and_persist``, then calls the per-post LLM
extractor (``graph.semantic.enrich_from_llm_for_posts``, landed in Task 4)
for each batch.

Design goals:
  * Single long-lived process. One worker, never parallel — the LLM + the
    ONNX embedder in chromadb palace fight for CPU/GPU, so serial batches
    keep memory predictable.
  * Memory-governed. If RSS > 600 MB between batches, drops the chromadb
    client + ``gc.collect()``; if still over, exits 137 so the Rust
    supervisor restarts us.
  * Sleep ladder. Empty queue → back off progressively (warm → cool →
    cold) so we don't burn CPU polling.
  * Active-topic bias. When the user is currently viewing a topic, its
    rows drain first; others deprioritize.
  * Crash-safe. On batch failure, rows stay queued with bumped
    ``attempts`` + ``last_error``; on ``SIGTERM`` the current batch
    commits-or-rolls-back cleanly before exit.

NDJSON protocol (stdout → Rust supervisor):
  ``{"_event": "enrich:started", "pid": 12345}``
  ``{"_event": "enrich:tick", "batch_size": 5, "processed": 5, "queued": 92, ...}``
  ``{"_event": "enrich:idle", "mode": "warm", "queued": 0}``
  ``{"_event": "enrich:error", "message": "...", "batch": 5}``
  ``{"_event": "enrich:oom", "rss_mb": 712}``
  ``{"_event": "enrich:stopped"}``

Every event is newline-terminated and ``flush=True`` so Rust's line-reader
sees it immediately. **Do not** write auxiliary logs to stdout — the Rust
parser expects every stdout line to be a valid event envelope.
"""
from __future__ import annotations

import gc
import json
import os
import resource
import signal
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ..core.config import load_config
from ..core.db import get_db, init_schema

# ── Tunables ────────────────────────────────────────────────────────────────
# Batch size matches the spec's memory budget: 1 LLM call per batch, sweet
# spot for token utilization. Larger batches raise peak RAM + latency; see
# docs/superpowers/specs/2026-04-21-incremental-enrichment-design.md §4.
BATCH_SIZE = 5

# After 3 failed attempts, a row is "poisoned" — skipped in the SELECT until
# the user explicitly re-queues it from Settings. last_error surfaces in the
# UI so they can see why. Tuned low because LLM failures cluster on prompt
# content (bad JSON, truncated text); retrying 10x rarely rescues those.
MAX_ATTEMPTS = 3

# Hard ceiling. If RSS crosses this, the governor drops chromadb + gc.
# If still over, the worker exits 137 and Rust restarts it. 600 MB is chosen
# to keep total app footprint ≤ 700 MB (Rust shell + SQLite + worker).
RSS_CEILING_MB = 600

# Sleep ladder between drain attempts. "hot" = back-to-back, "warm" = user
# is active, "cool" = idle, "cold" = fully idle. Cold includes app
# backgrounded (window hidden). Values in seconds.
IDLE_SLEEPS = {
    "hot": 0,
    "warm": 30,
    "cool": 300,
    "cold": 600,
}

# ── Signal handling ─────────────────────────────────────────────────────────
# Both SIGTERM (clean shutdown from Rust's ExitRequested) and SIGINT
# (Ctrl-C in dev) flip the same flag. The main loop polls it between batches
# AND during the sleep ladder so we never block more than a second on shutdown.
_stop = False


def _on_term(signum, frame):  # noqa: ANN001 — signal handler signature is fixed
    global _stop
    _stop = True


signal.signal(signal.SIGTERM, _on_term)
signal.signal(signal.SIGINT, _on_term)


# ── Observability helpers ───────────────────────────────────────────────────

def _rss_mb() -> int:
    """Current resident-set size in megabytes.

    ``ru_maxrss`` units differ by platform: bytes on macOS, kilobytes on
    Linux. The Linux branch also slightly overestimates on some kernels
    (peak since start, not live). That's fine — we only use this to decide
    "flush chromadb", and the OOM branch rechecks after gc.
    """
    r = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return r // (1024 * 1024) if sys.platform == "darwin" else r // 1024


def _emit(kind: str, **data: Any) -> None:
    """Write a single NDJSON event to stdout.

    Rust's ``run_cli_stream_streaming`` reads this line-by-line. Any
    exception here is swallowed — if stdout is broken we can't surface it
    anyway, and we don't want a broken pipe to crash the worker mid-batch.
    """
    try:
        print(json.dumps({"_event": kind, **data}, default=str), flush=True)
    except Exception:
        pass


# ── Active-topic awareness ──────────────────────────────────────────────────

def _data_dir() -> Path:
    """Location of ``.active_topics.json``. Prefer the env override so tests
    can sandbox the file; fall back to the canonical resolver (which is
    what the Tauri app sets)."""
    env = os.environ.get("REDDIT_MYIND_DATA_DIR")
    if env:
        return Path(env).expanduser()
    return load_config().data_dir


def _active_topics() -> set[str]:
    """Topics whose timestamp was written by Rust's ``mark_topic_active``
    within the last 10 minutes.

    Rust writes the file atomically (tmp + rename) from Task 5 Step 3, so
    we're safe to read without locking. Any error → empty set; the worker
    then drains strictly FIFO without the active bias. The file may not
    exist yet if Rust hasn't booted or the user hasn't opened a topic
    page — treated as "no active topics".
    """
    try:
        p = _data_dir() / ".active_topics.json"
        if not p.exists():
            return set()
        cutoff = time.time() - 600  # 10 minutes
        data = json.loads(p.read_text())
        return {t for t, ts in data.items() if isinstance(ts, (int, float)) and ts > cutoff}
    except Exception:
        return set()


# ── Per-post extractor (stubbed until Task 4 ships) ─────────────────────────
#
# Task 4 introduces ``graph.semantic.enrich_from_llm_for_posts(topic,
# post_ids)`` — a per-post variant of the existing ``enrich_from_llm`` that
# scopes extraction to a specific set of post_ids. Until it ships, the
# worker raises a tagged RuntimeError on every drain attempt; the batch is
# marked failed (attempts += 1), the row stays queued, and the worker
# continues. After 3 failures the rows sleep until Task 4 lands. This is
# intentionally non-fatal: it lets Task 3 ship independently (schema +
# supervisor + CLI wiring) while Task 4 bakes.

try:
    from ..graph.semantic import enrich_from_llm_for_posts  # type: ignore
except ImportError:  # pragma: no cover — only hit before Task 4
    def enrich_from_llm_for_posts(topic: str, post_ids: list[str]) -> int:  # type: ignore[no-redef]
        raise RuntimeError(
            "enrich_from_llm_for_posts not yet shipped — Task 4 of the "
            "incremental-enrichment plan. See "
            "docs/superpowers/plans/2026-04-21-incremental-enrichment.md §4."
        )


# ── Drain loop ──────────────────────────────────────────────────────────────

def _drain_batch(db) -> int:  # noqa: ANN001 — sqlite-utils Database has no public type
    """Pull up to ``BATCH_SIZE`` rows, extract them, remove on success.

    SELECT orders by (active-topic-bit ASC, queued_at ASC) so active topics
    drain first while non-active queues still make progress in strict FIFO.
    Failures bump ``attempts`` + write ``last_error`` but DO NOT remove the
    rows — they get another shot next tick (up to MAX_ATTEMPTS).

    Returns the number of rows actually processed (0 on empty queue or on
    extractor failure).
    """
    active = _active_topics()

    # Build the "active bucket" CASE. If no active topics, the CASE
    # collapses to a no-op (comparing topic IN ('') is always false, so all
    # rows bucket as 1 — same ordering as pure FIFO).
    if active:
        active_placeholders = ",".join("?" for _ in active)
        sql = f"""
            SELECT topic, post_id, kind, attempts FROM extraction_queue
             WHERE attempts < ?
             ORDER BY (CASE WHEN topic IN ({active_placeholders}) THEN 0 ELSE 1 END),
                      queued_at ASC
             LIMIT ?
        """
        params: list[Any] = [MAX_ATTEMPTS, *active, BATCH_SIZE]
    else:
        sql = """
            SELECT topic, post_id, kind, attempts FROM extraction_queue
             WHERE attempts < ?
             ORDER BY queued_at ASC
             LIMIT ?
        """
        params = [MAX_ATTEMPTS, BATCH_SIZE]

    rows = list(db.query(sql, params))
    if not rows:
        return 0

    t0 = time.time()
    # Re-import every batch so a monkeypatch in tests (or a hot-swap of the
    # semantic module) is picked up. Cheap — the module is already imported
    # at process start, so this is just a dict lookup.
    from ..graph import semantic as _sem

    try:
        # Group by topic so a single LLM call handles all posts for one
        # topic at once — critical for prompt efficiency. ``grouped`` keeps
        # post_ids as a list so duplicates are carried through (extractor
        # tolerates; SELECT's composite PK guarantees no dupes anyway).
        grouped: dict[str, list[str]] = {}
        for r in rows:
            grouped.setdefault(r["topic"], []).append(r["post_id"])

        processed_ids: list[tuple[str, str]] = []
        for topic, pids in grouped.items():
            _sem.enrich_from_llm_for_posts(topic=topic, post_ids=pids)
            for pid in pids:
                processed_ids.append((topic, pid))

        # Remove only rows that actually completed. ``kind`` hardcoded to
        # 'post' because that's the only kind we currently support; when
        # comment/review extraction ships, widen the DELETE predicate.
        for topic, pid in processed_ids:
            db.conn.execute(
                "DELETE FROM extraction_queue WHERE topic=? AND post_id=? AND kind='post'",
                (topic, pid),
            )
        db.conn.commit()

        dur_ms = int((time.time() - t0) * 1000)
        _emit(
            "enrich:tick",
            batch_size=len(rows),
            duration_ms=dur_ms,
            topics=list(grouped.keys()),
            processed=len(processed_ids),
            queued=db["extraction_queue"].count,
        )
        return len(rows)

    except Exception as e:
        # Batch-level failure: bump attempts + record error, leave rows
        # queued. Truncate last_error to 500 chars so a huge stack trace
        # doesn't balloon the DB. attempted_at lets future Settings UI
        # show "last attempted 2 min ago" without re-computing from logs.
        now = datetime.now(timezone.utc).isoformat(timespec="seconds")
        err = str(e)[:500]
        for r in rows:
            db.conn.execute(
                "UPDATE extraction_queue SET attempts=attempts+1, attempted_at=?, last_error=? "
                "WHERE topic=? AND post_id=? AND kind=?",
                (now, err, r["topic"], r["post_id"], r["kind"]),
            )
        db.conn.commit()
        _emit("enrich:error", message=err, batch=len(rows))
        return 0


# ── Memory governor ─────────────────────────────────────────────────────────

def _memory_governor() -> None:
    """Reclaim memory if RSS > ceiling. Exits 137 if reclaim fails.

    Two-stage:
      1. Drop the chromadb singleton (which pins the ~200 MB ONNX model),
         then ``gc.collect()``.
      2. Recheck RSS. If still over the ceiling, emit ``enrich:oom`` and
         exit 137 — Rust's supervisor will restart us with fresh memory.

    Never raises: a failure in the drop path (e.g. palace module not yet
    loaded) is fine, we just fall through to gc.collect().
    """
    if _rss_mb() <= RSS_CEILING_MB:
        return

    # Only touch palace if chromadb was actually imported in this process.
    # The check avoids eagerly loading chromadb just to drop it.
    if "chromadb" in sys.modules:
        try:
            from ..retrieval import palace  # type: ignore
            # ``_drop_client_if_any`` is added in Task 4. Until then, the
            # attribute is missing and we fall through to gc.collect().
            drop = getattr(palace, "_drop_client_if_any", None)
            if callable(drop):
                drop()
        except Exception:
            pass

    gc.collect()

    if _rss_mb() > RSS_CEILING_MB:
        _emit("enrich:oom", rss_mb=_rss_mb())
        sys.exit(137)


# ── Main loop ───────────────────────────────────────────────────────────────

def serve() -> None:
    """Run until SIGTERM / SIGINT / OOM.

    Sleep ladder:
      * queue non-empty → hot (0s between batches)
      * queue empty + active topic & idle < 10 min → warm (30s)
      * queue empty + idle < 30 min → cool (5 min)
      * else → cold (10 min)

    We poll ``_stop`` every second during the sleep so shutdown is prompt.
    """
    db = get_db()
    # get_db() already calls init_schema via its internal guard; call it
    # again defensively in case a future refactor decouples them. Idempotent.
    init_schema(db)
    _emit("enrich:started", pid=os.getpid())

    last_batch_ts = time.time()

    while not _stop:
        processed = _drain_batch(db)

        if processed > 0:
            # Back-to-back: queue had work, try again immediately.
            last_batch_ts = time.time()
            _memory_governor()
            continue

        # Queue is empty (or every row is poisoned). Classify idleness and
        # back off. Active topic keeps us in "warm" so new rows from a
        # live collect don't wait 5 minutes.
        idle_sec = time.time() - last_batch_ts
        active = _active_topics()
        if active and idle_sec < 600:
            mode = "warm"
        elif idle_sec < 1800:
            mode = "cool"
        else:
            mode = "cold"

        # Cool/cold are long sleeps — reclaim before napping so we don't
        # sit on 600 MB of chromadb state overnight.
        if mode in ("cool", "cold"):
            _memory_governor()

        _emit("enrich:idle", mode=mode, queued=db["extraction_queue"].count)

        sleep_for = IDLE_SLEEPS[mode]
        # Break sleep into 1-second ticks so SIGTERM shuts us down within
        # a second regardless of which mode we're in.
        for _ in range(int(sleep_for)):
            if _stop:
                break
            time.sleep(1)

    _emit("enrich:stopped")


__all__ = ["serve", "BATCH_SIZE", "MAX_ATTEMPTS", "RSS_CEILING_MB", "IDLE_SLEEPS"]
