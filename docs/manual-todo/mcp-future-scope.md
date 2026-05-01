# MCP — deferred items / future scope

Tracking items that emerged from the 2026-04-30 / 05-01 MCP work but
weren't done in scope. Each entry should have a clear "what would
make this go away" exit criterion.

---

## Open

### 1. Cursor reverted to stdio MCP — confirm 5-min disconnect is acceptable

- [ ] Decide whether to leave Cursor on stdio (the user reverted
      `~/.cursor/mcp.json` to `command: reddit-cli mcp serve` form on
      2026-05-01 after my HTTP switch). On stdio, Cursor cycles the
      server every ~5 min and any in-flight long tool call dies with
      "Not connected." On HTTP (`url:` form pointing at the daemon),
      Cursor stays connected indefinitely.
- [ ] If the user wants HTTP back: `cp ~/.cursor/mcp.json.bak.before-http
      ~/.cursor/mcp.json && bash scripts/mcp_http_daemon.sh start`,
      then toggle the MCP server in Cursor settings.

**Why this is here:** the revert was intentional, but the original
"Cursor keeps disconnecting" complaint will return on long jobs. If
the user prefers stdio for some other reason (e.g. Cursor lifecycle
auto-spawns on chat open without needing the daemon), document the
tradeoff and accept it.

### 2. Schedule weekly automated smoke test

- [ ] Add a cron/launchd routine that runs `bash scripts/test_mcp_queue.sh`
      and writes the result. If `FAIL > 0`, push a notification or
      open a Linear/Github issue.
- [ ] Trigger when: weekly, Sundays, low-traffic.

**Why:** I built `scripts/test_mcp_queue.sh` (22 tests, all passing).
Without scheduled re-runs, regressions land silently. The script
already writes both `/tmp/mcp_test_results.json` and
`docs/MCP_VERIFICATION.md`, so the routine just needs to run + diff
the markdown report against the prior commit.

### 3. ChromaDB compactor wedge during palace_reindex

- [ ] Investigate `palace query failed: Error executing plan: Error
      sending backfill request to compactor: Failed to apply logs to
      the hnsw segment writer` (visible in `mcp-http.stderr.log`).
- [ ] On a fresh clone with zero corpus the issue doesn't reproduce
      — it's specific to the current 60K-post Chroma store.
- [ ] Possible paths:
  - Wipe + rebuild Chroma store (destructive — would re-embed everything).
  - Upgrade `chromadb` to the latest patch version.
  - Add a corruption-detection step at startup that does a
    one-row test query and warns if it fails.

**Why:** the queue infrastructure works around it (the wedged job
gets `state=interrupted` on next restart), but `palace_reindex`
never finishes, which means corpus drift accumulates. Test
intentionally skips full reindex run because of this.

### 4. Result truncation > 1 MB cap — never exercised

- [ ] Submit a tool that returns a >1 MB blob (e.g. `reddit_get_corpus`
      with no limit on a big topic) via the queue. Confirm the row's
      `result_truncated=1`, `result_json` is a head-preview placeholder,
      and `reddit_jobs_get` returns the `_truncated` marker.

**Why:** the code path exists, the test script doesn't trigger it.
Could quietly be broken.

### 5. SIGKILL crash recovery — automate the manual test

- [ ] Add to `scripts/test_mcp_queue.sh` (or a separate script): submit
      a long job, SIGKILL the daemon, restart, assert
      `state=interrupted` with prior `worker_pid` recorded in `error`.
- [ ] Awkward because the script under test would kill its own host
      daemon. Could split into a "phase 2" script that runs after the
      main suite and cleans up.

**Why:** verified manually during development, but not in the
auto-suite. Easy to regress.

### 6. Migrate paper_pipeline + graph/relations to expose `progress=`

- [ ] Currently `reddit_paper_draft_generate`, `reddit_graph_build_relations`,
      and `reddit_paper_fulltext` get start/done beats only — their
      bodies are monolithic. Cancel-on-start works but mid-call cancel
      doesn't.
- [ ] If they grow to be longer/more important, push a `progress=`
      callable down through `paper_pipeline.paper_draft_generate`
      (between section assembly), `graph.relations.build_semantic_relations`
      (between edge kinds), and `paper_fulltext.get_full_text` (around
      download vs. parse phase).

**Why:** these are the 3 wrappers that show "completed without
progress msg" in the smoke test — the other 5 emit live messages.
Today's behaviour is documented as expected; tomorrow's slower
versions will need it.

### 7. SSE progress notifications to the client (Pattern A)

- [ ] FastMCP supports `ctx.report_progress()` which emits
      `notifications/progress` over SSE. Cursor/Claude Code render
      these inline as "still working… 47/200 done". Today our queue
      only persists to the row — the agent has to poll `reddit_jobs_get`.
- [ ] Could be layered on top of the existing queue: when a tool emits
      progress, ALSO `ctx.report_progress(pct, msg)` so a
      foreground-watching user sees activity inline.

**Why:** loops back to the original brainstorm's Pattern A. Useful
when the user is in the chat actively waiting; not useful for the
agent loop (which has poll). Low priority.

### 8. `mcp_http_daemon.sh start` confused by orphan listener

- [ ] During verification today, a wedged reindex left a listener on
      port 8765 but the helper's pidfile was missing. `start` reported
      `FAILED to start. Last 20 lines of log: <only old lines>`
      because the port-in-use check passed but the helper didn't print
      a useful diagnostic.
- [ ] Fix: when port is in use AND no pidfile, print
      `port 8765 is already in use by PID N — adopt with 'echo N > <pidfile>'
      or kill it`.

**Why:** caused 5+ minutes of confusion during the smoke-test rerun.
One-line UX fix.

### 9. Cursor IDE-side verification

- [ ] After any MCP server change, manually:
  1. Open Cursor.
  2. Settings → MCP → toggle `reddit-myind` off/on.
  3. In a Cursor chat, ask the agent to call `reddit_jobs_list({})`.
  4. Confirm response lands.
- [ ] Cannot be automated — needs a real Cursor session.

**Why:** the curl-based smoke test verifies the server works, but
not that Cursor's tool-list refresh actually picks up new tools.

---

## Done

### ✅ HTTP transport for Cursor (Cursor 5-min disconnect)
2026-04-30 — see `changelogs/2026-04-30_03_mcp-http-transport-for-cursor.md`.
**Note:** subsequently reverted on 2026-05-01 (entry #1 above).

### ✅ Async job queue (4 control tools + persistence)
2026-05-01 — see `changelogs/2026-05-01_01_async-job-queue-for-long-mcp-calls.md`.

### ✅ Live progress + cooperative cancel for 5 long tools
2026-05-01 — `reddit_research_collect`, `reddit_palace_reindex`,
`reddit_palace_warmup`, `reddit_analyze_papers_bulk`,
`reddit_find_gaps`.

### ✅ Start/done beats for 3 monolithic long tools
2026-05-01 — `reddit_paper_fulltext`, `reddit_paper_draft_generate`,
`reddit_graph_build_relations`.

### ✅ Stale-job auto-recovery on daemon restart
2026-05-01 — pidfile lock guarantees one daemon, so any `running` row
at startup belongs to a dead prior daemon → marked `interrupted`.

### ✅ Variadic `make_progress_logger`
2026-05-01 — found during smoke-test verification: `find_gaps.progress_cb`
calls with two args `(kind, payload_dict)`, the previous
single-arg `_log(msg)` raised TypeError swallowed by surrounding
`try/except Exception`. Now `_log(*args, **kwargs)`.

### ✅ Smoke test + verification doc
2026-05-01 — `scripts/test_mcp_queue.sh` + `docs/MCP_VERIFICATION.md`
(auto-regenerated on every run, operator notes preserved). Currently
22/22 passing.
