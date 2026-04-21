# Incremental Enrichment — Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Ship the two-phase pipeline: Phase-A collect warmup (visible progress from second 1) → Phase-B incremental extraction worker (starts at 100 posts, keeps improving the graph as data lands). Memory-governed to stay ≤ 700 MB app footprint + optional 3-4 GB Ollama.

**Architecture:**
- New `extraction_queue` SQLite table populated by collect + ingest
- New Python long-lived worker process (`research enrich-worker --serve`) drains queue in batches of 5
- Rust supervisor starts/stops/restarts the worker; tracks active topics in-memory
- Reactive UI: `mutated('findings')` fires per batch; every open tab auto-refreshes

**Spec:** `docs/superpowers/specs/2026-04-21-incremental-enrichment-design.md`

---

## File structure

**Create:**
- `src/reddit_research/research/enrich_worker.py` — long-lived worker loop (~350 lines)
- `src/reddit_research/research/saturation.py` — v1 metric (~80 lines)
- `src/reddit_research/research/coverage.py` — coverage gaps computation (~100 lines)
- `app-tauri/src-tauri/src/worker.rs` — supervisor + lifecycle (~250 lines)
- `app-tauri/src/lib/enrichStatus.js` — frontend worker-status subscriber (~120 lines)
- `app-tauri/src/screens/collect.js` (modify) — Phase-A progress card rebuild
- `tests/test_enrich_worker.py` — unit tests for queue drain + batch idempotency

**Modify:**
- `src/reddit_research/core/db.py` — `extraction_queue` schema + indexes
- `src/reddit_research/research/collect.py` — enqueue after `_tag_posts`, remove inline `enrich_from_llm` call
- `src/reddit_research/cli/main.py` — `enrich-worker --serve` subcommand + `enqueue` + `worker-status`
- `app-tauri/src-tauri/src/commands.rs` — 5 new commands: `start_extraction_worker`, `stop_extraction_worker`, `extraction_worker_status`, `mark_topic_active`, `enqueue_extraction`
- `app-tauri/src-tauri/src/main.rs` — register commands, wire lifecycle (start on boot once any topic has ≥100 posts; SIGTERM on app quit)
- `app-tauri/src/api.js` — new methods + `mutated('findings')` wiring on `enrich:tick` listener
- `app-tauri/src/main.js` — subscribe to `enrich:tick` / `enrich:idle` / `enrich:error` Tauri events
- `app-tauri/src/screens/topic.js` — Phase-A placeholder when `posts < 100`; saturation badge in header; coverage-gaps panel

---

## Task 1 — `extraction_queue` schema + migration

**Files:** modify `src/reddit_research/core/db.py`

- [ ] **Step 1: Add `_ensure_extraction_queue()` called from `init_schema`**

```python
def _ensure_extraction_queue(db: Database) -> None:
    if "extraction_queue" in db.table_names():
        return
    db["extraction_queue"].create({
        "topic": str, "post_id": str, "kind": str,
        "queued_at": str, "attempted_at": str,
        "attempts": int, "last_error": str,
    }, pk=("topic", "post_id", "kind"), defaults={"kind": "post", "attempts": 0})
    db["extraction_queue"].create_index(["queued_at"])
    db["extraction_queue"].create_index(["topic"])
```

- [ ] **Step 2: Call it from `init_schema(db)` alongside other table creations**

- [ ] **Step 3: Backfill for existing installs — add to `init_schema`:**

```python
# One-time: queue every existing topic_post that has no graph evidence yet.
if "topic_posts" in db.table_names() and "graph_nodes" in db.table_names():
    db.conn.execute("""
      INSERT OR IGNORE INTO extraction_queue (topic, post_id, kind, queued_at, attempts)
      SELECT tp.topic, tp.post_id, 'post', datetime('now'), 0
        FROM topic_posts tp
        LEFT JOIN graph_nodes gn ON gn.evidence_post_id = tp.post_id
          AND gn.topic = tp.topic
       WHERE gn.id IS NULL
    """)
    db.conn.commit()
```

- [ ] **Step 4: Test**

```python
# tests/test_enrich_worker.py
def test_schema_creates_queue(tmp_path, monkeypatch):
    monkeypatch.setenv("REDDIT_MYIND_DATA_DIR", str(tmp_path))
    from reddit_research.core.db import get_db
    db = get_db()
    assert "extraction_queue" in db.table_names()
    cols = {c.name for c in db["extraction_queue"].columns}
    assert {"topic","post_id","kind","queued_at","attempts","last_error"} <= cols
```

Run: `REDDIT_MYIND_DATA_DIR=/tmp/eq-test .venv/bin/python -m pytest tests/test_enrich_worker.py::test_schema_creates_queue -v`

- [ ] **Step 5: Commit** `feat(enrich): extraction_queue table + backfill on schema init`

---

## Task 2 — Enqueue on collect + remove inline enrich

**Files:** modify `src/reddit_research/research/collect.py`

- [ ] **Step 1: Modify `_tag_posts` to enqueue each tagged post**

```python
def _tag_posts(topic: str, post_ids: list[str], source: str) -> int:
    if not post_ids:
        return 0
    _ensure_topics_table()
    db = get_db()
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    rows = [{"topic": topic, "post_id": pid, "source": source, "added_at": now}
            for pid in post_ids if pid]
    db["topic_posts"].insert_all(rows, pk=("topic","post_id"), ignore=True)

    # Enqueue for async extraction. Idempotent via composite PK.
    db["extraction_queue"].insert_all(
        [{"topic": topic, "post_id": pid, "kind": "post",
          "queued_at": now, "attempts": 0} for pid in post_ids if pid],
        pk=("topic","post_id","kind"), ignore=True,
    )
    return len(rows)
```

- [ ] **Step 2: Remove the inline `enrich_from_llm` call at end of `collect()`**

Search for `enrich_from_llm(topic=...)` inside `collect.py` — it runs immediately after collect today. Extract it behind a new flag:

```python
# Before the old block:
if not skip_extraction and aggressive:
    # Legacy path: run one inline extraction for backwards compat with CLI
    # callers that don't run the worker. Tauri frontend sets skip_extraction=True
    # because the worker handles it.
    from .graph.semantic import enrich_from_llm
    try: enrich_from_llm(topic=search_topic)
    except Exception as e: result.errors.append(f"inline_enrich: {e}")
```

- [ ] **Step 3: Add `skip_extraction: bool = False` param to `collect()` signature; plumb through to cli command**

- [ ] **Step 4: Test enqueue**

```python
def test_tag_posts_enqueues(tmp_path, monkeypatch):
    monkeypatch.setenv("REDDIT_MYIND_DATA_DIR", str(tmp_path))
    from reddit_research.core.db import get_db
    from reddit_research.research.collect import _tag_posts
    n = _tag_posts("meditation", ["p1","p2","p3"], "top:reddit:month")
    assert n == 3
    db = get_db()
    rows = list(db["extraction_queue"].rows)
    assert len(rows) == 3
    assert all(r["topic"] == "meditation" for r in rows)
```

- [ ] **Step 5: Commit** `feat(enrich): auto-enqueue on collect + opt-out inline extraction`

---

## Task 3 — Python worker (`enrich_worker.py`)

**Files:** create `src/reddit_research/research/enrich_worker.py`

- [ ] **Step 1: Worker skeleton with sleep ladder + active-topic awareness**

```python
"""Long-lived extraction worker. Drains extraction_queue in batches of 5."""
from __future__ import annotations
import gc, json, os, resource, signal, sys, time
from datetime import datetime, timezone
from pathlib import Path

from ..core.db import get_db, init_schema
from ..core.config import load_config

BATCH_SIZE = 5
MAX_ATTEMPTS = 3
RSS_CEILING_MB = 600
IDLE_SLEEPS = {
    "hot": 0,        # queue non-empty
    "warm": 30,      # queue empty, active topic <10min
    "cool": 300,     # queue empty, no active topic 5-10min
    "cold": 600,     # app backgrounded or fully idle
}

_stop = False
def _on_term(signum, frame):
    global _stop
    _stop = True
signal.signal(signal.SIGTERM, _on_term)
signal.signal(signal.SIGINT,  _on_term)

def _rss_mb() -> int:
    # ru_maxrss is bytes on macOS, KB on Linux — assume bytes; harmless overestimate on Linux
    r = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return r // (1024 * 1024) if sys.platform == "darwin" else r // 1024

def _emit(kind: str, **data) -> None:
    # Worker → Rust pipe. Rust's run_cli_stream_streaming reads NDJSON from stdout.
    print(json.dumps({"_event": kind, **data}), flush=True)

def _active_topics() -> set[str]:
    """Read the active-topic cache file maintained by Rust."""
    try:
        p = Path(os.environ["REDDIT_MYIND_DATA_DIR"]) / ".active_topics.json"
        if not p.exists(): return set()
        cutoff = time.time() - 600  # 10 min
        data = json.loads(p.read_text())
        return {t for t, ts in data.items() if ts > cutoff}
    except Exception:
        return set()
```

- [ ] **Step 2: Drain loop**

```python
def _drain_batch(db) -> int:
    """Pull up to BATCH_SIZE rows, extract, mark done. Returns rows processed."""
    active = _active_topics()
    # Active topics first, then others, FIFO within each bucket
    sql = """
        SELECT topic, post_id, kind, attempts FROM extraction_queue
         WHERE attempts < ?
         ORDER BY (CASE WHEN topic IN ({}) THEN 0 ELSE 1 END),
                  queued_at ASC
         LIMIT ?
    """.format(",".join("?" for _ in active) if active else "''")
    params = [MAX_ATTEMPTS, *active, BATCH_SIZE] if active else [MAX_ATTEMPTS, BATCH_SIZE]
    rows = list(db.query(sql, params))
    if not rows: return 0

    t0 = time.time()
    try:
        from .graph.semantic import enrich_from_llm_for_posts  # new helper, see §4
        grouped: dict[str, list[str]] = {}
        for r in rows: grouped.setdefault(r["topic"], []).append(r["post_id"])
        processed_ids: list[tuple[str,str]] = []
        for topic, pids in grouped.items():
            n = enrich_from_llm_for_posts(topic=topic, post_ids=pids)
            for pid in pids: processed_ids.append((topic, pid))

        # Remove successful from queue
        for topic, pid in processed_ids:
            db.conn.execute(
                "DELETE FROM extraction_queue WHERE topic=? AND post_id=? AND kind='post'",
                (topic, pid),
            )
        db.conn.commit()

        dur = int((time.time()-t0)*1000)
        _emit("enrich:tick", batch_size=len(rows), duration_ms=dur,
              topics=list(grouped.keys()), processed=len(processed_ids),
              queued=db["extraction_queue"].count)
        return len(rows)
    except Exception as e:
        # Mark attempts + error; DO NOT remove rows
        now = datetime.now(timezone.utc).isoformat(timespec="seconds")
        for r in rows:
            db.conn.execute(
                "UPDATE extraction_queue SET attempts=attempts+1, attempted_at=?, last_error=? "
                "WHERE topic=? AND post_id=? AND kind=?",
                (now, str(e)[:500], r["topic"], r["post_id"], r["kind"]),
            )
        db.conn.commit()
        _emit("enrich:error", message=str(e)[:500], batch=len(rows))
        return 0

def _memory_governor() -> None:
    """Drop ChromaDB + gc if RSS > ceiling. Exits 137 if still over (supervisor will restart)."""
    if _rss_mb() <= RSS_CEILING_MB: return
    try:
        import sys as _sys
        # Drop chromadb state
        if "chromadb" in _sys.modules:
            from ..retrieval import palace
            palace._drop_client_if_any()  # helper added in Task 4
    except Exception: pass
    gc.collect()
    if _rss_mb() > RSS_CEILING_MB:
        _emit("enrich:oom", rss_mb=_rss_mb())
        sys.exit(137)

def serve() -> None:
    """Main loop. Exits on SIGTERM/SIGINT or OOM."""
    db = get_db()
    init_schema(db)
    _emit("enrich:started", pid=os.getpid())
    mode = "warm"
    last_batch_ts = time.time()
    while not _stop:
        processed = _drain_batch(db)
        if processed > 0:
            mode = "hot"; last_batch_ts = time.time()
            _memory_governor()
            continue
        # Queue empty — back off
        idle_sec = time.time() - last_batch_ts
        active = _active_topics()
        if active and idle_sec < 600: mode = "warm"
        elif idle_sec < 1800:         mode = "cool"
        else:                          mode = "cold"
        if mode in ("cool","cold"): _memory_governor()
        _emit("enrich:idle", mode=mode, queued=db["extraction_queue"].count)
        sleep_for = IDLE_SLEEPS[mode]
        for _ in range(int(sleep_for)):
            if _stop: break
            time.sleep(1)
    _emit("enrich:stopped")
```

- [ ] **Step 3: CLI hook in `cli/main.py`**

```python
@research_app.command("enrich-worker")
def cmd_enrich_worker(
    serve: bool = typer.Option(False, "--serve"),
    as_json: bool = typer.Option(False, "--json", hidden=True),
) -> None:
    """Long-lived extraction worker. Emits NDJSON events on stdout."""
    _ = as_json
    if not serve:
        typer.echo("use --serve"); raise typer.Exit(1)
    from ..research.enrich_worker import serve as _serve
    _serve()
```

- [ ] **Step 4: Test drain logic (mock LLM)**

```python
def test_drain_batch_removes_on_success(tmp_path, monkeypatch):
    monkeypatch.setenv("REDDIT_MYIND_DATA_DIR", str(tmp_path))
    from reddit_research.core.db import get_db
    from reddit_research.research.enrich_worker import _drain_batch
    # Prime queue with 3 rows
    db = get_db()
    db["extraction_queue"].insert_all([
        {"topic":"t","post_id":"p1","kind":"post","queued_at":"2026-01","attempts":0},
        {"topic":"t","post_id":"p2","kind":"post","queued_at":"2026-01","attempts":0},
    ], pk=("topic","post_id","kind"))
    # Monkeypatch the extractor to succeed
    import reddit_research.research.graph.semantic as sem
    monkeypatch.setattr(sem, "enrich_from_llm_for_posts",
                        lambda topic, post_ids: len(post_ids))
    n = _drain_batch(db)
    assert n == 2
    assert db["extraction_queue"].count == 0
```

- [ ] **Step 5: Commit** `feat(enrich): long-lived worker with sleep ladder + memory governor`

---

## Task 4 — Per-post extractor + palace lazy-drop

**Files:** modify `src/reddit_research/research/graph/semantic.py` + `src/reddit_research/retrieval/palace.py`

- [ ] **Step 1: Add `enrich_from_llm_for_posts(topic, post_ids)` helper**

Wraps the existing `enrich_from_llm` but scopes extraction to the given post IDs only. Uses SELECT IN clause to pull just those posts' text, runs one LLM call for the batch, upserts findings, writes graph_nodes with `evidence_post_id` for traceback.

- [ ] **Step 2: Add `palace._drop_client_if_any()` helper**

```python
# In palace.py
_client_singleton = None
def _drop_client_if_any():
    global _client_singleton
    if _client_singleton is not None:
        try: _client_singleton.reset()
        except Exception: pass
        _client_singleton = None
```

- [ ] **Step 3: Add 5-min idle evictor** (timer resets on every embed call; fires `_drop_client_if_any` on expiry)

- [ ] **Step 4: Ollama auto-unload** — add to `analyze/providers/ollama.py`: track last-call timestamp. When >10 min idle, next generate call sends `{"keep_alive": 0}` in the request; bust the idle timer.

- [ ] **Step 5: Commit** `feat(enrich): per-post extractor + palace idle-evict + ollama keep-alive=0`

---

## Task 5 — Rust supervisor (`worker.rs`)

**Files:** create `app-tauri/src-tauri/src/worker.rs`

- [ ] **Step 1: Worker state + spawn**

```rust
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::CommandChild;

#[derive(Default)]
pub struct ExtractionWorker {
    child: Mutex<Option<CommandChild>>,
    last_tick: Mutex<Option<Instant>>,
    processed_total: Mutex<u64>,
    queued: Mutex<u64>,
    last_error: Mutex<Option<String>>,
    restart_count: Mutex<u32>,
    last_restart: Mutex<Option<Instant>>,
}

pub type WorkerState = Arc<ExtractionWorker>;
```

- [ ] **Step 2: `start_worker(app)` + supervised restart loop**

- [ ] **Step 3: Active-topic file writer**

Simple in-memory HashMap<String, SystemTime> with a file flush on each update so the worker can read it:

```rust
pub fn mark_active(app: &AppHandle, topic: &str) -> Result<(), String> {
    let dir = crate::cli::data_dir(app).map_err(|e| e.to_string())?;
    let p = dir.join(".active_topics.json");
    let mut map: std::collections::HashMap<String, u64> =
        std::fs::read_to_string(&p).ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH).unwrap().as_secs();
    map.insert(topic.to_string(), now);
    std::fs::write(&p, serde_json::to_string(&map).unwrap()).map_err(|e| e.to_string())
}
```

- [ ] **Step 4: NDJSON parser + event re-emit** — read stdout line-by-line, parse `{_event: ...}`, emit Tauri event with same name to frontend.

- [ ] **Step 5: Commands** — 5 new `#[tauri::command]` functions registered in `main.rs`.

- [ ] **Step 6: Commit** `feat(enrich): rust supervisor + active-topic tracking + event bridge`

---

## Task 6 — Auto-start gate

**Files:** modify `app-tauri/src-tauri/src/main.rs`

- [ ] **Step 1: On app boot, query DB for `(SELECT max(c) FROM (SELECT count(*) c FROM topic_posts GROUP BY topic))`** — if ≥ 100, start worker. Otherwise wait.

- [ ] **Step 2: Wire `collect:done` event listener** — when a collect finishes, re-check the threshold; if now ≥ 100 on any topic, start worker.

- [ ] **Step 3: `ExitRequested` handler SIGTERMs the worker**

- [ ] **Step 4: Commit** `feat(enrich): auto-start worker when any topic crosses 100 posts`

---

## Task 7 — Frontend: Phase-A collect screen rebuild

**Files:** modify `app-tauri/src/screens/collect.js`

- [ ] **Step 1: New header card with live post count, source chips, threshold bar**

- [ ] **Step 2: Below 100 posts** — "Insights begin at 100 posts" message, no tabs.

- [ ] **Step 3: At 100 posts** — card flips to "Extracting insights… N findings" and topic tabs unlock.

- [ ] **Step 4: Subscribe to `enrich:tick`** via `listen('enrich:tick', ...)` → update findings count + fade-in new items.

- [ ] **Step 5: Commit** `feat(enrich): phase-A collect progress card + threshold flip`

---

## Task 8 — Frontend: saturation badge + coverage gaps

**Files:** create `src/reddit_research/research/saturation.py`, `src/reddit_research/research/coverage.py`, modify `app-tauri/src/screens/topic.js`

- [ ] **Step 1: `saturation.py::compute(topic)`** → `{ score: float, hint: 'rich'|'converging'|'saturated', per_50: [int,...] }`. Pure SQL: `SELECT count(DISTINCT id) FROM graph_nodes WHERE topic=? AND created_at > ?` over sliding windows of last 50 posts.

- [ ] **Step 2: `coverage.py::compute(topic)`** → `{ gaps: [{dimension, posts, pct, suggested_sources: [...]}] }`. Checks for: no app-store/play-store, <5% academic, <3 distinct product mentions.

- [ ] **Step 3: Rust commands** `topic_saturation` + `topic_coverage_gaps` using native SQLite where possible (or thin CLI wrappers).

- [ ] **Step 4: Topic page header** — sparkline + one-line hint from saturation. Below tabs — coverage-gaps panel with one-click "+ Add X source" buttons.

- [ ] **Step 5: Commit** `feat(enrich): saturation v1 + coverage gaps panel`

---

## Task 9 — Reactive wiring + freshness badges

**Files:** modify `app-tauri/src/main.js`, tab renderers in `app-tauri/src/screens/topic.js`

- [ ] **Step 1:** In main.js, translate Tauri events → DOM events:

```js
import { listen } from '@tauri-apps/api/event';
import { mutated } from './api.js';

listen('enrich:tick', (e) => mutated('findings', e.payload));
listen('enrich:idle', (e) => window.dispatchEvent(new CustomEvent('gapmap:enrich-idle', { detail: e.payload })));
listen('enrich:error', (e) => window.dispatchEvent(new CustomEvent('gapmap:enrich-error', { detail: e.payload })));
```

- [ ] **Step 2:** Each topic-page tab header shows `Updated Xs ago · N posts · M findings` — freshness string driven by last `enrich:tick` timestamp.

- [ ] **Step 3:** Top banner on worker error (`gapmap:enrich-error` listener) — dismissible, with "Retry all failed" button.

- [ ] **Step 4: Commit** `feat(enrich): reactive wiring + freshness badges + error banner`

---

## Task 10 — E2E smoke + DMG + skill + changelog

- [ ] **Step 1: Smoke test — dev**

Start app, create new topic, watch Phase-A card, verify count climbs, at 100 watch flip, verify findings populate without refresh, kill app mid-collect, restart, verify worker resumes and queue drains.

- [ ] **Step 2: Write skill** `~/.claude/skills/desktop-incremental-enrichment/SKILL.md` — phase boundary, queue schema, worker sleep ladder, memory governor rules, reactive wiring, lazy palace-drop, Ollama keep-alive=0, common gotchas.

- [ ] **Step 3: Rebuild sidecar + DMG**

```bash
rm -rf build dist && .venv/bin/pyinstaller reddit-cli.spec
cp dist/reddit-cli app-tauri/src-tauri/binaries/reddit-cli-aarch64-apple-darwin
codesign --force --deep --sign - app-tauri/src-tauri/binaries/reddit-cli-aarch64-apple-darwin
cd app-tauri && npm run tauri build
```

- [ ] **Step 4: Changelog** `changelogs/2026-04-21_02_incremental-enrichment.md` — full summary with commit log.

- [ ] **Step 5: Final commit + announce DMG path to user**

---

## Self-review

- [ ] Every task has concrete file paths + code
- [ ] Queue idempotent via PK (topic, post_id, kind)
- [ ] Worker transaction boundaries prevent partial state on crash
- [ ] Memory governor tested under load
- [ ] `skip_extraction` default False preserves CLI back-compat
- [ ] `enrich:error` surfaces to user (no silent failures)
- [ ] Active-topic file is written atomically (write to `.tmp` + rename) — add to Task 5 Step 3 if missing

## Execution

Subagent-driven. Dispatch tasks 1 → 10 sequentially. Each task commits; each commit is reviewed by a spec-compliance subagent before proceeding.
