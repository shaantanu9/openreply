# MCP Server Lifecycle Strategy — Why / What / How

**Date:** 2026-04-21
**Status:** Shipped (commit `b8b285e`)
**Audience:** ops, support, and future engineers debugging "the app hangs."

This doc is the permanent home for the zombie-MCP-process problem and
its fix. Pair with `changelogs/2026-04-21_10_mcp-zombie-guard.md` (the
what-changed entry) and `docs/learnings/2026-04-21-tier-build-patterns.md`
(the lessons blurb).

---

## 1. Why this exists — the problem

### 1.1 What the user sees

- "OpenReply hangs on any click."
- "My Cursor / Claude Code suddenly lost all `reddit-myind` tools."
- "Laptop fan is spinning even when I'm not doing anything."
- "Settings → Palace says 'ready' but semantic search times out."

### 1.2 What's actually happening

Each time a user opens a Claude Code / Cursor / Claude Desktop / Windsurf
session with the OpenReply MCP connector, the client spawns a fresh
`reddit-cli mcp serve` child over stdio. When the client window closes,
crashes, or the session is force-killed, the OS is supposed to send
EOF on stdin to the child. In practice, this doesn't always happen:

- **Cursor / Claude Code "Quit"** sometimes leaks half-open pipe FDs.
- **Window-close vs. app-quit** behave differently per client.
- **Force-kill from Activity Monitor** leaves the child orphaned under
  `init`.
- **System sleep / wake** can sever the pipe without EOF delivery.

Result: the Python child keeps running with no one reading its stdout.
It holds file locks on:

- `<data_dir>/reddit.db` (SQLite WAL)
- `<data_dir>/palace/chroma.sqlite3` (Chroma metadata)
- `<data_dir>/palace/hnsw/*.bin` (Chroma HNSW index memory map)

### 1.3 Why the locks cause hangs

SQLite WAL mode tolerates many readers + one writer. Chroma's Rust
backend runs an **HNSW index compaction thread** per open collection
— a tokio worker that rebalances the vector index in the background.
With N zombie processes, N compactors compete for the same on-disk
index. One ends up pegged at 38% CPU; the others block on its WAL
checkpoint. When the Tauri sidecar tries to take a DB lock for any
operation (list topics, overview stats, run a query), it waits in
line. From the user's perspective, every click takes 10+ seconds.

### 1.4 How bad it got in practice

Observed state on 2026-04-21 before the fix:

```
$ ps aux | grep -c "reddit-cli mcp serve"
18
```

18 processes, from Sunday Apr 19 through Tuesday Apr 21, including one
burning 38% CPU continuously and consuming 275 MB RAM. The user had no
way to know these existed without running `ps` manually.

### 1.5 Why this will happen in production

Because:
- Every MCP client in the wild has some version of the clean-shutdown bug.
- Users run multiple MCP clients simultaneously (Cursor for code,
  Claude Code for research, Claude Desktop for Q&A).
- Each client re-spawns a fresh child on reconnect.
- Nothing in OpenReply before today limited how many could accumulate.

A user who installs OpenReply and uses it normally for a month will
accumulate enough zombies that the app starts feeling slow. They blame
the app, not the client.

---

## 2. What we shipped — three defensive guards

All in `src/reddit_research/mcp/server.py::run()`. Each is **best-effort
with a tunable env var**. The guards are additive: one catches what
another misses. All behavior is opt-out via env, never opt-in — the
user gets protection by default.

### 2.1 Guard 1 — PID-file lock

**File:** `<data_dir>/mcp-server.pid` (lives next to `reddit.db`).

**Behavior on startup:**

1. Open the PID file. If it doesn't exist → write our PID, proceed.
2. If it exists, parse the stored PID.
3. `kill -0` the stored PID.
   - **Alive?** Another live MCP server owns this data dir. Exit with a
     structured JSON error on stderr:
     ```json
     {"error":"another_mcp_server_running",
      "hint":"Kill the other instance or remove ...mcp-server.pid"}
     ```
     Exit code 2.
   - **Dead?** Steal the lock. Write our PID, proceed.
4. Register `atexit` to unlink the PID file on clean shutdown.

**Code:** `_acquire_pidfile_lock()` + `_release_pidfile_lock()`.

**Failure mode it prevents:** the user opens MCP in Cursor and
simultaneously in Claude Code. Without Guard 1 → two processes race on
the HNSW index and both drift. With Guard 1 → the second one exits with
a clear error the client surfaces to the user.

### 2.2 Guard 2 — Idle-timeout self-terminator

**Mechanism:** a daemon thread polls every 60 s. If stdin has had zero
reads for `REDDIT_MYIND_IDLE_TIMEOUT` seconds (default **1800** = 30 min),
the thread calls `os._exit(0)`.

**How it knows about activity:** we monkey-patch `sys.stdin.readline`
at startup to bump a `last_activity` timestamp on every call. FastMCP
uses stdio under the hood, so every JSON-RPC message passes through
readline. No code path in FastMCP is touched — the hook is invisible.

**Code:** `_start_idle_timeout_guard()`.

**Failure mode it prevents:** Cursor window closes without sending
EOF → the Python child hangs with no stdin to read → it would otherwise
run forever. With Guard 2, it auto-exits after 30 min of silence.

**Tunable:**
- `REDDIT_MYIND_IDLE_TIMEOUT=1800` — timeout in seconds.
- `REDDIT_MYIND_IDLE_TIMEOUT=0` — disables.
- `REDDIT_MYIND_NO_IDLE_GUARD=1` — disables (convenience).

### 2.3 Guard 3 — Stale-sibling sweep on startup

**Mechanism:** on boot, scan all processes owned by the current user
via `psutil.process_iter()`. For each process whose cmdline contains
`reddit-cli`, `mcp`, and `serve` AND whose `create_time` is older than
`REDDIT_MYIND_SWEEP_STALE_DAYS` days ago AND whose PID isn't ours,
`.terminate()` it.

**Log:** `[mcp] swept N stale sibling MCP server(s) older than Nd`
written to stderr.

**Code:** `_sweep_stale_siblings()`.

**Failure mode it prevents:** users who installed OpenReply before this
build accumulated zombies already. Guard 1 only blocks NEW accumulation;
Guard 3 cleans up EXISTING accumulation the first time they restart
after upgrading.

**Tunable:**
- `REDDIT_MYIND_SWEEP_STALE_DAYS=1` — min age in days.
- `REDDIT_MYIND_SWEEP_STALE_DAYS=0` — disables.

**Caveat:** requires `psutil`. Optional dep. Without it, the guard is a
no-op (not an error). Ship `psutil` as a hard dep in the next
PyInstaller rebuild for full coverage.

---

## 3. How they interact — defense in depth

```
┌─────────────────────────────────────────────────────────────┐
│ New MCP session spawned by Cursor / Claude Code / Desktop  │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
            ┌─────────────────────────────┐
            │ Guard 3: sweep stale        │  kills pre-existing
            │ siblings > 1 day old        │  zombies (pre-fix era)
            └─────────────────────────────┘
                            │
                            ▼
            ┌─────────────────────────────┐
            │ Guard 1: acquire PID lock   │  refuses to run if
            │                             │  another is alive
            └─────────────────────────────┘
                            │
                   ┌────────┴────────┐
                   ▼                 ▼
             lock acquired       lock held by live PID
                   │                 │
                   ▼                 ▼
            ┌──────────────┐   ┌──────────────┐
            │ Guard 2:     │   │ exit(2) with │
            │ idle-timeout │   │ structured   │
            │ thread spawn │   │ JSON error   │
            └──────┬───────┘   └──────────────┘
                   ▼
            ┌──────────────┐
            │ mcp.run()    │ ← normal serve
            └──────┬───────┘
                   ▼ (30 min silent)
            ┌──────────────┐
            │ os._exit(0)  │ ← graceful self-terminate
            └──────────────┘
                   ▼
            ┌──────────────┐
            │ atexit:      │
            │ unlink PID   │
            └──────────────┘
```

End-state: **at most one `mcp serve` process per user, per data dir, at
any given time**.

---

## 4. How to test it

### 4.1 Manual smoke test (5 min)

```bash
# Baseline — count MCP processes
ps aux | grep -c "reddit-cli mcp serve"

# Spawn one
.venv/bin/python -m reddit_research.mcp.server &
sleep 2
ps aux | grep -v grep | grep "reddit-cli mcp serve" | wc -l
# → 1

# Try to spawn a second → should fail with Guard 1
.venv/bin/python -m reddit_research.mcp.server 2>&1 | head -3
# → {"error":"another_mcp_server_running","hint":"..."}

# Check the PID file
ls -la ~/Library/Application\ Support/com.shantanu.openreply/reddit-myind/mcp-server.pid
# → should exist, owned by you

# Kill the first → lock file released by atexit
pkill -f "reddit-cli mcp serve"
sleep 1
ls ~/Library/Application\ Support/com.shantanu.openreply/reddit-myind/mcp-server.pid 2>/dev/null
# → No such file

# Simulate a zombie → test Guard 3
.venv/bin/python -m reddit_research.mcp.server &
ZOMBIE_PID=$!
# (normally you'd wait a day; for the test, just confirm the sweep code runs)
.venv/bin/python -c "from reddit_research.mcp.server import _sweep_stale_siblings; print('killed:', _sweep_stale_siblings(max_age_days=0))"
# → killed: 1 (or higher if other zombies exist)
```

### 4.2 Automated test (add to CI)

Not yet shipped. Add to `tests/` in the next pass:

```python
def test_pidfile_lock_rejects_second_instance():
    from reddit_research.mcp.server import (
        _acquire_pidfile_lock, _release_pidfile_lock, _pidfile_path,
    )
    _release_pidfile_lock()  # clean slate
    assert _acquire_pidfile_lock() is True
    # Simulate a second process trying to acquire
    import os
    _pidfile_path().write_text(str(os.getpid()))
    # Second call from same PID succeeds (we're not "another instance")
    assert _acquire_pidfile_lock() is True
    _release_pidfile_lock()


def test_sweep_stale_siblings_respects_age():
    from reddit_research.mcp.server import _sweep_stale_siblings
    # Age threshold of 0 days kills everything matching (except us)
    # Age threshold of 999 days kills nothing (all siblings are younger)
    assert _sweep_stale_siblings(max_age_days=999) == 0
```

### 4.3 Production telemetry (follow-up)

Not yet shipped. When we add opt-in telemetry, emit these events:

- `mcp_guard_pidfile_blocked` — Guard 1 refused to start
- `mcp_guard_pidfile_stolen` — Guard 1 stole a dead lock
- `mcp_guard_swept_stale_siblings` — Guard 3 killed N zombies
- `mcp_guard_idle_timeout` — Guard 2 self-terminated

These give us visibility into which guards actually fire in the wild.

---

## 5. How to extend the pattern

### 5.1 Apply the same pattern to the Tauri sidecar

The desktop app's `main.rs::app.run(...)` already kills the active
collect / chat / stream children on `ExitRequested | Exit`. But a
SIGKILL on the Rust process (Activity Monitor "Force Quit") leaves
the Python children. Replicate Guards 1 + 2 in `app-tauri/src-tauri/
src/cli.rs::run_cli` for long-running operations.

### 5.2 Single-writer advisory lock for SQLite

Currently we rely on SQLite's built-in file locking. Under heavy
contention, writes can return `SQLITE_BUSY` which the app surfaces as
"DB locked" errors. Consider:

- `PRAGMA busy_timeout = 5000` at connection open (currently unset).
- A thin Python wrapper that retries on BUSY with exponential backoff.

### 5.3 Chroma HNSW singleton

The real source of CPU burn is Chroma's Rust compactor running per
process. Options to explore:

- One shared Chroma HTTP server for all MCP clients (breaks local-first).
- Move HNSW to `hnswlib-python` directly (smaller blast radius).
- Disable background compaction in Chroma (`chromadb.Settings(persist_directory=..., anonymized_telemetry=False, is_persistent=True)` + investigate flags).

These are architectural changes — out of scope for the zombie fix.

---

## 6. Env-var reference (production-ready)

| Var | Default | Controls |
|---|---|---|
| `REDDIT_MYIND_IDLE_TIMEOUT` | `1800` | Idle-timeout guard in seconds. `0` disables. |
| `REDDIT_MYIND_NO_IDLE_GUARD` | unset | Set to `1` to disable idle guard. |
| `REDDIT_MYIND_SWEEP_STALE_DAYS` | `1` | Min age in days for stale-sibling sweep. `0` disables. |

Development setup:
```bash
export REDDIT_MYIND_NO_IDLE_GUARD=1        # stay running during debug
export REDDIT_MYIND_SWEEP_STALE_DAYS=0     # don't kill other dev servers
```

Production setup:
```bash
# Defaults are fine; nothing to set.
# If building a CI that runs multiple MCP servers in parallel:
export REDDIT_MYIND_SWEEP_STALE_DAYS=0     # CI agents may legitimately run concurrent instances
```

---

## 7. Failure-mode playbook

What the user reports → what's happening → how to fix.

### 7.1 "MCP tools disappeared from Cursor / Claude Code"

- **Cause:** Guard 2 idle-timeout fired — stdin silent for 30 min.
- **Why:** the MCP client kept a half-open pipe but stopped sending
  messages (common on sleep/wake).
- **Fix:** have the user re-open the MCP client; a new child spawns
  automatically on the next tool call.

### 7.2 "OpenReply app hangs on any click"

- **Cause:** zombie MCP / sidecar processes holding DB locks.
- **Diagnosis:**
  ```bash
  ps aux | grep -E "reddit-cli|openreply" | grep -v grep
  ```
- **Quick fix:**
  ```bash
  pkill -f "reddit-cli mcp serve"
  # Then restart OpenReply.
  ```
- **Long-term fix:** they're on a build older than `b8b285e`. Update.

### 7.3 "MCP server refuses to start with 'another_mcp_server_running'"

- **Cause:** Guard 1 is working correctly — there's already a live
  instance.
- **Diagnosis:** check the PID file:
  ```bash
  cat ~/Library/Application\ Support/com.shantanu.openreply/reddit-myind/mcp-server.pid
  ps -p $(cat ~/Library/Application\ Support/...mcp-server.pid)
  ```
- **Fix:**
  - If the PID is alive and legitimate (another MCP client session),
    this is expected — only one instance per data dir.
  - If the PID is dead but the file lingers (shouldn't happen — atexit
    usually cleans up; may happen on SIGKILL):
    ```bash
    rm ~/Library/Application\ Support/com.shantanu.openreply/reddit-myind/mcp-server.pid
    ```

### 7.4 "Laptop fan spinning when OpenReply is idle"

- **Cause:** Chroma HNSW compaction across multiple processes (see §1.3).
- **Fix:** update to `b8b285e` or later. Guards 1 + 3 will reduce to one
  process. If fan persists even with one process, file an issue — the
  lone Chroma compactor shouldn't saturate a core on idle.

### 7.5 "App works fine for a week then slows down"

- **Cause:** pre-`b8b285e` build — zombies accumulate, no cleanup.
- **Fix:** update. Guard 3 sweeps old zombies on next start.

---

## 8. What still needs doing (follow-ups)

Tracked here; move to `MISSING_AND_NEXT.md` when prioritized.

### 8.1 Make `psutil` a hard dep

Currently optional. Without it, Guard 3 is a no-op. Add to
`pyproject.toml` core deps and rebuild the PyInstaller bundle. Estimated
bundle size increase: ~3 MB.

### 8.2 Ship native notification on idle-exit

When Guard 2 fires, the user sees nothing — their MCP just goes silent.
Emit a `terminal-notifier` (macOS) or `osascript` toast on graceful
exit: *"OpenReply MCP server idle-exited after 30 min. It will re-start
on your next tool call."*

### 8.3 Tauri sidecar mirror

Apply the same pattern to `app-tauri/src-tauri/src/cli.rs`. The
desktop app already kills tracked children on clean exit, but a
SIGKILL leaves them. PID file + idle-timeout for long-running collect
/ chat / stream children.

### 8.4 Settings → "Running processes" card

A diagnostic surface that lists live MCP / sidecar PIDs, their ages,
file-lock state. One-click "kill orphans" button. Makes support easier
when users report the symptom before the fix auto-applies.

### 8.5 Automated guard tests in CI

Section 4.2 has the sketch — add the two tests there plus one that
spawns a subprocess, waits 2 seconds, reads its stderr, and asserts
Guard 1 + 2 fire correctly.

### 8.6 Chroma HNSW architectural decision

The root-cause amplifier is Chroma's per-process compactor. Evaluate
whether to (a) move to a shared Chroma HTTP server, (b) switch to
`hnswlib-python` directly, or (c) disable Chroma's background
compaction entirely. Performance / reliability trade-off matrix needed.

---

## 9. Reference materials

- **Changelog of the fix:** `changelogs/2026-04-21_10_mcp-zombie-guard.md`
- **Learning entry:** `docs/learnings/2026-04-21-tier-build-patterns.md`
- **Code:** `src/reddit_research/mcp/server.py` — search for
  `Production guards` comment block.
- **Related skill:** `fastmcp-app-integration` in `~/.claude/skills/`.

---

*Revisit quarterly. If Guard 1/2/3 are firing at surprising rates,
dig into the root cause before loosening the defaults.*
