# reddit-myind MCP server — infrastructure reference

Single source of truth for how the MCP server is run, what transport
each client uses, how long-running tools work, and how to operate it.
Last full revision: **2026-05-01**.

---

## TL;DR for operators

- **Cursor** talks to a long-lived HTTP daemon on `http://127.0.0.1:8765/mcp`.
  Start/stop/restart with `bash scripts/mcp_http_daemon.sh {start|stop|restart|status|logs}`.
- **Claude Code** and **Claude Desktop** keep stdio (their lifecycle is fine);
  they auto-spawn the server per chat session.
- Long tools (collect, reindex, paper analysis, etc.) **must be invoked via
  `openreply_jobs_submit`**, not directly — otherwise the call holds the MCP
  transport open for minutes and Cursor will drop it. Poll status with
  `openreply_jobs_get(job_id)`.

---

## 1. Transport architecture (2026-04-30)

### Why HTTP for Cursor

Cursor's stdio MCP client cycles servers every ~5 minutes. Every PID
in the prior `mcp-server.log` lived exactly that long before being
SIGTERM'd by a successor. Any in-flight tool call got killed; once the
transport dropped, every subsequent `tools/call` returned "Not
connected" until the chat was reset.

HTTP transport sidesteps this — Cursor connects/disconnects freely,
the daemon stays up.

### Flag plumbing

`reddit-cli mcp serve` now accepts:

```
--transport stdio|http|streamable-http|sse   (default stdio)
--host 127.0.0.1
--port 8765
```

Sources:

- `src/reddit_research/cli/main.py::cmd_mcp_serve` — Typer flags.
- `src/reddit_research/mcp/server.py::run` — forwards to `mcp.run(transport=…, host=…, port=…)`.
- The idle-timeout watcher is **skipped when transport != stdio** so
  the HTTP daemon doesn't self-shutdown after 30 min of inactivity.

### Daemon lifecycle helper

`scripts/mcp_http_daemon.sh`:

| Command | Effect |
|---|---|
| `start` | nohup-detached server, writes pidfile `mcp-http.pid` in the data dir, waits up to 8s for the listener to come up. |
| `stop` | SIGTERM, waits 5s, then SIGKILL. |
| `restart` | stop + start. |
| `status` | running + endpoint + memory. |
| `logs` | `tail -F` the stderr log. |

Env exposed by the helper to the daemon:

```
REDDIT_MYIND_DATA_DIR   # /Users/<you>/Library/Application Support/com.shantanu.openreply/reddit-myind
REDDIT_MYIND_TOKEN      # bearer for client Authorization header
REDDIT_MYIND_PALACE_EAGER=1   # warm ONNX at startup (~2-5s) so first semantic_search is fast
MCP_TAKEOVER_STALE_LOCK=1
MCP_CLIENT_TAG=http-daemon    # per-tag pidfile coexists with stdio servers
REDDIT_MYIND_NO_IDLE_GUARD=1
```

### Client configs (current state)

```jsonc
// ~/.cursor/mcp.json
"reddit-myind": {
  "url": "http://127.0.0.1:8765/mcp",
  "headers": {
    "Authorization": "Bearer <REDDIT_MYIND_TOKEN>"
  }
}

// ~/.claude.json  (Claude Code, stdio)
"reddit-myind": {
  "command": ".venv/bin/reddit-cli",
  "args": ["mcp", "serve"],
  "env": {
    "REDDIT_MYIND_DATA_DIR": "...",
    "REDDIT_MYIND_TOKEN": "...",
    "MCP_TAKEOVER_STALE_LOCK": "1",
    "MCP_CLIENT_TAG": "claude-code",
    "REDDIT_MYIND_PALACE_EAGER": "1"
  }
}

// ~/Library/Application Support/Claude/claude_desktop_config.json — same shape, MCP_CLIENT_TAG=claude-desktop
```

Backups: `~/.cursor/mcp.json.bak.before-http`, `~/.claude.json.bak.before-eager`,
Claude Desktop config `.bak.before-eager`.

---

## 2. Async job queue (2026-05-01)

### Why

Some MCP tools take 20–30 minutes (`openreply_research_collect` on a big
topic, `openreply_palace_reindex` on 60K posts, bulk paper analysis,
graph rebuilds, LLM-heavy tools). A single synchronous `tools/call`
holds the client connection open the whole time, fights every client's
transport timeout, and ties up an entire agent reasoning turn just
waiting.

The queue moves long work into a 4-thread pool inside the same MCP
daemon. `openreply_jobs_submit(tool_name, args)` returns a `job_id` in
~50 ms. Agents poll `openreply_jobs_get(job_id)` whenever they want.
Survives Cursor cycling, chat resets, and (via SQLite persistence)
daemon restarts.

### The four control tools

| Tool | Returns | Notes |
|---|---|---|
| `openreply_jobs_submit(tool_name, args)` | `{ok, job_id, state="queued", tool_name, hint}` | Any of the 122 registered MCP tools. `args` = kwargs forwarded to the tool. |
| `openreply_jobs_get(job_id)` | full row + inflated `result` when `state=done` | Truncated payloads (>1 MB) come back as `{_truncated:true, head_preview}`. |
| `openreply_jobs_list(state?, tool_name?, limit=50)` | `{ok, count, jobs[]}` | newest-first; clamp 1..500. |
| `openreply_jobs_cancel(job_id)` | `{ok, was_running, hint}` | Sets per-job `threading.Event`; queued rows go to `cancelled` immediately, running rows depend on the tool. |

### State machine

```
queued ──► running ──► done
                  │
                  ├──► failed       (tool raised an Exception)
                  ├──► cancelled    (cancel observed during work)
                  └──► interrupted  (daemon restarted while job was alive)
```

`interrupted` is set by `recover_stale()` at startup. The pidfile lock
guarantees only one daemon runs at a time, so any `running` row at
startup belongs to a dead prior daemon — the sweep marks all of them
`interrupted` immediately (no stale-heartbeat threshold needed).

### Storage

```sql
CREATE TABLE mcp_jobs (
  job_id        TEXT PRIMARY KEY,         -- "j_" + 10 hex chars
  tool_name     TEXT NOT NULL,
  args_json     TEXT NOT NULL,            -- capped at 50 KB
  state         TEXT NOT NULL,            -- queued|running|done|failed|cancelled|interrupted
  progress_pct  INTEGER,                  -- 0..100, heuristically extracted from msg
  progress_msg  TEXT,                     -- last progress beat, capped at 500 chars
  result_json   TEXT,                     -- capped at 1 MB; head-preview placeholder if larger
  result_truncated INTEGER NOT NULL DEFAULT 0,
  error         TEXT,                     -- traceback (capped at 6 KB) for failures
  created_at    TEXT NOT NULL,
  started_at    TEXT,
  finished_at   TEXT,
  heartbeat_at  TEXT,                     -- worker pings every 10s while running
  worker_pid    INTEGER
);
CREATE INDEX idx_mcp_jobs_state_created ON mcp_jobs(state, created_at DESC);
CREATE INDEX idx_mcp_jobs_tool          ON mcp_jobs(tool_name, created_at DESC);
```

Lives on the same `reddit.db` everything else uses
(`$REDDIT_MYIND_DATA_DIR/reddit.db`). Auto-created on first
`openreply_jobs_submit`.

### Worker lifecycle (in `mcp/jobs.py`)

```
submit()
  ├── INSERT row state='queued'
  ├── register cancel-Event keyed by job_id
  └── _executor.submit(_run)

_run() (in worker thread)
  ├── UPDATE state='running', started_at=…, heartbeat_at=…, worker_pid=…
  ├── start heartbeat thread (touches heartbeat_at every 10s)
  ├── _current_job.set(job_id)        # ContextVar — tools read it via current_job_id()
  ├── try:    result = fn(**args)
  │   except JobCancelled:  state='cancelled' (clean — not a failure)
  │   except BaseException: state='failed', store traceback
  ├── UPDATE state='done', result_json=…, progress_pct=100
  ├── stop heartbeat
  └── pop cancel-Event
```

### Result-size cap

Results > 1 MB are stored as:
```json
{
  "_truncated": true,
  "_full_size_bytes": 12345678,
  "head_preview": "…first ~1KB…",
  "hint": "rerun the underlying tool with paging if you need the full payload"
}
```

For tools that return huge corpora (e.g. embedding arrays), agents
should prefer paged retrieval over the queue.

---

## 3. Cooperative cancel + live progress (2026-05-01)

### Mechanism

`mcp/jobs.py::make_progress_logger(prefix)` returns a callable that
on every invocation:

1. **Cancel-checks first** — raises `JobCancelled` (a `BaseException`,
   not `Exception`, so `except Exception` clauses don't swallow it)
   if the per-job Event has been set.
2. Writes the message to `progress_msg` (capped 500 chars).
3. Heuristically extracts `progress_pct` from messages containing
   `N/M`, `X%`, or "done".
4. Outside a job (synchronous tool call) — no-op.

`jobs.py` also exposes `is_cancelled(job_id?)` and `check_cancelled()`
for tools that want explicit checks instead of relying on a `progress=`
callback.

### Tools wired with live progress + auto-cancel

These tools **already accepted a `progress=` hook** for CLI logging,
so the migration was just `progress=jobs.make_progress_logger(prefix)`
in the MCP wrapper — no change to the underlying functions.

| Tool | Progress source | Cancellable? |
|---|---|---|
| `openreply_research_collect` | per-source / per-subreddit msgs | ✅ on next progress() |
| `openreply_palace_reindex` | per-batch (every 200 posts) | ✅ on next batch boundary |
| `openreply_palace_warmup` | structured ONNX events | ✅ on next event |
| `openreply_analyze_papers_bulk` | `[i/N] post_id` per paper | ✅ on next paper |
| `openreply_find_gaps` | per-extractor msgs | ✅ on next extractor |

These tools are **monolithic** (no internal loop), so the wrapper
emits start + done beats. Cancel-on-start works; mid-call cancel
isn't possible without thread-killing.

| Tool | Beats | Cancellable? |
|---|---|---|
| `openreply_paper_fulltext` | start / done with status + char_count | ✅ pre-fetch only |
| `openreply_paper_draft_generate` | start / done with markdown size | ✅ pre-LLM only |
| `openreply_graph_build_relations` | start / done with edge count | ✅ pre-build only |

### How `JobCancelled` propagates

Most "long" library code is wrapped in `try/except Exception`. By
inheriting `BaseException` instead of `Exception`, `JobCancelled`
bypasses those handlers and bubbles all the way back to the worker's
`_run`, which catches it specifically and writes `state='cancelled'`.

If a tool's parallel sub-worker swallows `BaseException` too (rare),
the cancel won't reach the worker — but that's a tool-specific bug,
not a queue limitation.

---

## 4. Operating playbook

### Daily

```bash
# Did Cursor lose the connection?
bash scripts/mcp_http_daemon.sh status

# Restart cleanly
bash scripts/mcp_http_daemon.sh restart

# Tail what the daemon is doing
bash scripts/mcp_http_daemon.sh logs
```

### Diagnosing client problems

```bash
# Doctor: PID file, port, configs, smoke launch
bash scripts/mcp_doctor.sh
```

### Inspecting jobs from SQL

```bash
DB="$HOME/Library/Application Support/com.shantanu.openreply/reddit-myind/reddit.db"

# Recent jobs
sqlite3 -column -header "$DB" "SELECT job_id, tool_name, state, progress_pct, \
  substr(progress_msg,1,60) AS msg, \
  CAST((julianday(COALESCE(finished_at, datetime('now')))-julianday(started_at))*86400 AS INT) AS sec \
  FROM mcp_jobs ORDER BY created_at DESC LIMIT 10"

# Live tail
watch -n 2 "sqlite3 -column -header '$DB' \"SELECT state, progress_pct, substr(progress_msg,1,80) FROM mcp_jobs WHERE state='running'\""
```

### Submitting a long job from the agent

```text
job = openreply_jobs_submit(
  tool_name="openreply_research_collect",
  args={"topic": "presentation skills", "max_posts": 5000, "aggressive": true}
)
# returns in 50ms with job.job_id

# … do other work / answer the user / write code …

openreply_jobs_get(job.job_id)   # state, progress_pct, progress_msg
# when state == 'done': result is inflated and ready
# when state == 'failed': traceback in error column
```

### Cleanup of old rows

The queue does not auto-purge. To trim:

```sql
DELETE FROM mcp_jobs
WHERE state IN ('done','failed','cancelled','interrupted')
  AND created_at < datetime('now','-30 days');
```

---

## 5. File map (where to edit what)

| Concern | File | Key symbol |
|---|---|---|
| HTTP transport flags | `src/reddit_research/cli/main.py` | `cmd_mcp_serve` |
| Server entrypoint | `src/reddit_research/mcp/server.py` | `run()` |
| Tool dispatch registry | `src/reddit_research/mcp/server.py` | `_TOOL_REGISTRY`, `_wrap_tool_for_logging` |
| Queue core | `src/reddit_research/mcp/jobs.py` | `submit / get / list_jobs / cancel / recover_stale` |
| Cancel + progress | `src/reddit_research/mcp/jobs.py` | `JobCancelled`, `make_progress_logger`, `_current_job` |
| HTTP daemon helper | `scripts/mcp_http_daemon.sh` | n/a |
| Diagnose | `scripts/mcp_doctor.sh` | n/a |

---

## 6. Limits + known gaps

- **Cooperative cancel only** — tools that don't call their `progress=`
  hook between work units (or take it but ignore it) won't honor cancel
  mid-call. They'll run to completion; only the row's final state is
  flipped to `cancelled`. To fix a specific tool, add `progress(...)`
  calls between its work units (the call also serves as a cancel
  checkpoint via `JobCancelled`).
- **No SSE progress to the client** — Pattern A from the brainstorm.
  Agents must poll `openreply_jobs_get`. Inline visibility for a
  human-watching-Cursor isn't there yet.
- **`openreply_palace_reindex` may wedge on cold ChromaDB** — the
  "Error sending backfill request to compactor" error during eager
  warmup is a known ChromaDB issue. Unrelated to the queue but
  particularly visible when running reindex via the queue.
- **Result size > 1 MB → truncated** — see "Result-size cap" above.

---

## 7. Change log pointer

| Date | Changelog | What |
|---|---|---|
| 2026-04-30 | `changelogs/2026-04-30_03_mcp-http-transport-for-cursor.md` | Added HTTP transport, switched Cursor to URL config, added daemon helper |
| 2026-05-01 | `changelogs/2026-05-01_01_async-job-queue-for-long-mcp-calls.md` | Added job queue (4 tools), 5 long tools wired with live progress + cancel, 3 monolithic tools wrapped with start/done beats, tightened recovery sweep |
