# Async job queue for long MCP tool calls

**Date:** 2026-05-01
**Type:** Feature

## Summary

Some MCP tools take 20–30 minutes (`openreply_research_collect` on a big
topic, `openreply_palace_reindex` on a 60K-post corpus, bulk
`openreply_paper_fulltext`, `openreply_graph_build_relations`, anything LLM-
heavy). A single synchronous `tools/call` over MCP holds the client
connection open for that entire run — fights every client's transport
timeout, dies on chat reset, and ties up one of the agent's reasoning
turns waiting for a result it can't even check on incrementally.

Pattern B from the 2026-04-30 brainstorm: introduce an async job queue
inside the same MCP daemon. Any registered tool can now be fired with
`openreply_jobs_submit(tool_name, args)`, which returns a `job_id` in ~50
ms while the work runs in a 4-thread pool. Agents poll
`openreply_jobs_get(job_id)` whenever they want — survives Cursor cycling,
chat resets, even daemon restarts (recovered to `interrupted` state on
next startup).

## Changes

- New module `src/reddit_research/mcp/jobs.py`:
  - SQLite-backed `mcp_jobs` table (auto-created on first use, indexed
    on `(state, created_at)` and `(tool_name, created_at)`).
  - `submit / get / list_jobs / cancel / recover_stale / shutdown` API.
  - 4-thread `ThreadPoolExecutor` (most long tools are I/O-bound).
  - Heartbeat thread per job (every 10 s) so daemon crashes can be
    detected and stale rows reaped on next startup (>5 min stale →
    `interrupted`).
  - Cooperative cancellation via `is_cancelled(job_id)` / per-job
    `threading.Event`. Existing tools that don't poll the flag run to
    completion, but their final state becomes `cancelled` not `done`.
  - Result cap of 1 MB; bigger payloads are stored as a head-preview
    placeholder with a `_truncated:true` marker pointing the agent at
    paged retrieval.
- `src/reddit_research/mcp/server.py`:
  - Added `_TOOL_REGISTRY` populated by the existing `@mcp.tool()`
    logging wrapper at registration time. `openreply_jobs_submit`
    dispatches via this dict, independent of FastMCP's private API.
  - Four new MCP tools: `openreply_jobs_submit`, `openreply_jobs_get`,
    `openreply_jobs_list`, `openreply_jobs_cancel`.
  - `run()` calls `jobs.recover_stale()` at startup and registers
    `jobs.shutdown` via `atexit` so executor cleanup is graceful.

## Verification

```
$ # 1. submit no-arg tool — returns instantly
$ openreply_jobs_submit(tool_name="openreply_palace_status", args={})
{"ok":true,"job_id":"j_9ce9976246","state":"queued",
 "tool_name":"openreply_palace_status",
 "hint":"poll with openreply_jobs_get(job_id) — runs in background, server stays responsive for other tool calls"}
# HTTP 200 in 50 ms

$ openreply_jobs_get(job_id="j_9ce9976246")    # 1 s later
state=done  progress_pct=100
result={ok:true, ready:true, count:60302, ...}

$ openreply_jobs_list(limit=5)
2 jobs:
  j_9ce9976246  openreply_palace_status   done    pct=100
  j_03d7993b35  openreply_topic_stats     failed  pct=null  (missing required arg)
```

Failure path verified: missing args produce `state=failed` with full
traceback in the row, never crash the daemon.

## Files Created

- `src/reddit_research/mcp/jobs.py`
- `changelogs/2026-05-01_01_async-job-queue-for-long-mcp-calls.md`

## Files Modified

- `src/reddit_research/mcp/server.py`
  - `_TOOL_REGISTRY` populated by the logging wrapper.
  - 4 new MCP tools registered.
  - Startup recovery + atexit shutdown wired into `run()`.

## How an agent should use this

```
# Long collect — fire and continue working
job = openreply_jobs_submit(
    tool_name="openreply_research_collect",
    args={"topic": "presentation skills", "max_posts": 5000},
)
# → returns in 50ms with job.job_id

# … do other tool calls, answer the user, write code …

# Whenever you're ready to check
openreply_jobs_get(job.job_id)
# state: queued | running | done | failed | cancelled | interrupted
# when state == done: result is inflated and ready
```

For tools that finish in <5 s, keep calling them synchronously — the
queue overhead isn't worth it.

## Cooperative cancellation + live progress (added 2026-05-01)

Migrated the five long tools that already accept a `progress=` hook so
they auto-report into the job row AND honour cancel without any change
to their underlying functions:

- `openreply_research_collect` — emits per-source / per-subreddit msgs
  ("[collect] fetch r/python top(month) limit=5", "[gnews] starting…").
- `openreply_palace_reindex` — emits "[palace] upserted N posts so far…".
- `openreply_palace_warmup` — emits structured-event dicts adapted to text.
- `openreply_analyze_papers_bulk` — emits "[i/N] post_id" so progress_pct
  ticks up automatically (regex extracts pct from "i/N" patterns).
- `openreply_find_gaps` — emits per-extractor msgs via `progress_cb=`.

Mechanism (in `jobs.py`):

- `_current_job` ContextVar set by the worker before invoking the tool.
- `make_progress_logger(prefix)` returns a callable that:
  1. **Cancel-checks first** — raises `JobCancelled` (a `BaseException`,
     so `except Exception` clauses don't swallow it) if the per-job
     `threading.Event` has been set.
  2. Heuristically extracts `progress_pct` from messages containing
     "N/M" or "X%" or "done", writes both to the row.
  3. Outside a job (synchronous tool call) it's a no-op.

This is the cleanest possible migration: the existing CLI progress
hook already exists in every long tool, the wrapper passes our adapter
in, and `JobCancelled` bubbles up from the next `progress()` call —
typically within seconds — and the worker marks the row `cancelled`.

Verified end-to-end:

- `research_collect` running for 21 s, cancelled mid-flight, observed
  cancel inside the next progress() call, clean exit, `state=cancelled`.
- SIGKILL of the daemon during a running job → restart → recovery
  sweep auto-marks the orphan as `interrupted` with prior worker_pid
  in the error column.
- MCP daemon stays responsive (sub-second `tools/call` for
  `openreply_jobs_cancel`) while a worker is doing real fetch work.

## Tightened recovery sweep

The pidfile lock guarantees only one MCP daemon runs at a time. So on
startup, ANY row in `running` state by definition belongs to a dead
prior daemon — we no longer wait the 5-min stale window before
reaping. Sweep marks all `running` (where `worker_pid != my_pid`) and
all `queued` rows as `interrupted` immediately. Eliminates the
"orphan-running-forever" failure mode after a SIGKILL.

## Files Modified (this round)

- `src/reddit_research/mcp/jobs.py`:
  - Added `JobCancelled`, `_current_job` ContextVar.
  - `make_progress_logger(prefix)` for the auto-wired adapter.
  - Worker sets the ContextVar; catches `JobCancelled` as a clean
    state transition (not a failure).
  - `recover_stale()` now reaps all running-not-mine rows immediately
    instead of waiting for stale-heartbeat threshold.
- `src/reddit_research/mcp/server.py`:
  - 5 long tools wired with `progress=jobs.make_progress_logger(...)`:
    `openreply_research_collect`, `openreply_palace_reindex`,
    `openreply_palace_warmup`, `openreply_analyze_papers_bulk`,
    `openreply_find_gaps`.
  - 3 monolithic tools wrapped with start/done beats (cancel-on-start
    only, since they have no internal loop):
    `openreply_paper_fulltext`, `openreply_paper_draft_generate`,
    `openreply_graph_build_relations`.

## Tracking doc

`docs/MCP_INFRA.md` is the new operations + architecture reference
covering: transport choice per client, daemon lifecycle commands, the
job-queue state machine, the `mcp_jobs` schema, the cooperative-
cancel mechanism, the playbook for diagnosing client issues, and the
file map for where to edit what. **Read this before touching MCP
infrastructure or wiring a new long tool into the queue.**
