# OpenReply — Performance + Feature Roadmap

**Last updated:** 2026-04-19

## 🎯 Purpose

Single source of truth for every performance optimization and feature idea after the 2026-04-19 sweep. Check items off as they ship. Move completed items to the "Done" section at the bottom.

---

## Phase A — Performance (cache miss still hurts)

Repeat navigation is fast now thanks to the `api.js` TTL cache + in-flight dedup. What's left is **first-visit / cache-miss / cold-start** latency.

### Quick wins (1–2h each)

- [x] **Combine 4 `getFindings` into 1 `runQuery`** (2026-04-19) — Evidence tab now uses a single CTE + `ROW_NUMBER() OVER (PARTITION BY kind)` query, returning all four kinds in one Python spawn (was 4). Same SQL hoisted so preload + loadEvidence share a cache key → zero-spawn first click.
- [x] **Longer TTLs on stable reads** (2026-04-19) — `cli_info` / `list_topics` / `byok_status` / `list_exports` bumped to 30 s; `overview_stats` → 15 s; `app_data_dir` → 5 min; `get_findings` / `run_query` → 10 s; `recent_activity` stays at 2 s (live feel).
- [ ] **SQLite index audit** — verify indexes on `topic_posts(topic)`, `topic_posts(post_id)`, `graph_nodes(topic, kind)`, `graph_edges(topic)`, `posts(source_type)`. Use `EXPLAIN QUERY PLAN` to find table scans.
- [ ] **Prepare + reuse SQL** — sqlite-utils probably recompiles SQL each call; if hot queries become measurable, cache compiled statements.

### Live-data layer (added 2026-04-19)

- [x] **DB-mtime freshness poll** (2026-04-19) — new `db_mtime` Rust command (cheap stat syscall, no Python spawn) + JS poller in `api.js` that checks every 5 s while document visible. If the SQLite file changed externally (background collect / MCP server / manual CLI), clears the cache and fires a `openreply:db-changed` window event.
- [x] **Visibility-aware live refresh** (2026-04-19) — Dashboard listens for `openreply:db-changed` + runs a 30 s background interval (only while visible) to re-fetch every slot; Activity screen also listens so external writes immediately reflect. Both auto-cleanup via `route-gen` + `hashchange`.

### The big structural fix (1 day — NEXT session)

- [ ] **Persistent Python subprocess** — the #1 unfixed bottleneck. Today every cache miss spawns Python (~300–500 ms dev, worse prod). Spawn Python once at app launch; read JSON commands from stdin / write JSON responses to stdout. Cuts every cache miss from ~500 ms → ~20 ms.
  - Approach: a Rust-side `SidecarDaemon` (mutex + stdin handle + framed stdout reader) routes `query` + `info` to the long-lived child. Writes (collect/build/enrich) continue to spawn one-off processes (already long-running, not worth serialising). Falls back to one-shot spawn if daemon is dead or returns non-framed output.
  - Failure modes mapped:
    - Deadlock → 30 s per-request timeout; kill + respawn.
    - Response interleaving → Mutex serialises request/response pairs (1 at a time is fine for read queries).
    - Python-side unhandled exception → daemon catches at loop boundary + returns `{ok:false, error}`; never exits.
    - Daemon crash → Rust detects EOF on stdout, marks daemon dead, respawns on next call.
    - Dev hot-reload → check mtime on daemon entry point; respawn if changed.
  - Impacts `cli.rs` (major, ~200 new lines), new `cli/daemon.py` (~80 lines), `commands.rs::run_cli` (add fast-path for query/info).
  - **Not shipped this session** — 2–3 h focused work with real risk; deserves its own commit + careful testing.

---

## Phase B — Reliability + UX polish

- [ ] **Desktop notifications on collect finish** (`tauri-plugin-notification`)
  - npm + cargo install, register plugin, add `notification:default` capability permission, fire from frontend on `collect:done` event.
- [ ] **System tray icon** — running/idle state, right-click menu: "Show app / New topic / Quit". Uses Tauri v2 built-in tray support.
- [ ] **Auto-update** (`tauri-plugin-updater`) — blocked on code-signing (Apple Dev account). Once signed, CI can produce signed `.tauri_updater.sig` + manifest → users get background updates.
- [ ] **Topic-page full-text search** — FTS5 virtual table on `posts(title, body)` + UI search bar on Topic → Evidence. SQLite native, no extra infra.
- [x] **Retry-with-backoff on sidecar crash** (2026-04-19) — `api.js::invokeWithRetry` retries once after 500 ms on transient errors (spawn failed, ECONNRESET, timed out, broken pipe). Genuine logic errors ("no such table", "API key not set") pass through unchanged.
- [x] **Skeleton → data fade transition** (2026-04-19) — `.fade-in` utility class (160 ms opacity + 2 px slide) applied to hero + stat-cards. Respects `prefers-reduced-motion`.

---

## Phase C — Features (user-visible)

### High value (differentiators)

- [ ] **Scheduled re-collects** — per-topic weekly cron. Run `research collect --topic X` in background, push notification when new painpoints appear. Runs in the sidebar.
- [ ] **Topic diff / compare** — pick 2 topics → side-by-side view: overlap painpoints, painpoints unique to each, source mix difference. Useful for competitor/adjacency research.
- [ ] **Annotate findings** — manual tag/note on any painpoint, feature wish, workaround. Notes flow into the exported report. Requires new `annotations` table (`finding_id, topic, note, created_at`).
- [ ] **Saved filters / alerts** — define a query like `kind=painpoint AND metadata_json LIKE '%churn%'`; app notifies when a new collect adds a matching finding.
- [ ] **Global corpus search** — search-across-all-topics from the sidebar; hit goes to the topic detail with the row highlighted.

### Medium (polish / ergonomics)

- [ ] **Export to Notion / Linear / Google Docs** — one-click push of the Report tab contents to an external destination. Each requires its own OAuth + API mapping.
- [ ] **Shareable read-only HTML** — the existing `research graph export` HTML is static; add a "Publish" button that uploads to Netlify / GitHub Pages / Cloudflare Pages. Gate behind env var containing API token.
- [ ] **CSV / JSON export of any DB table** — the Database screen already has CSV for query results; add per-table bulk export on Topics and Findings.
- [x] **Keyboard shortcuts panel** (2026-04-19) — `?` (or Shift+/) opens a modal listing `⌘ N` new topic, `?` this panel, `Esc` close dialogs, `Enter` submit, `Tab`/`Shift+Tab` focus cycle. Input/textarea focus is a no-op so the key doesn't hijack typing. Respects reduced-motion.

### Architectural (bigger bets)

- [ ] **MCP server hardening** — more tools exposed so Claude Code can mutate (create topic, run collect, export report) not just query. Already have 40+ read tools via `reddit-cli mcp install`.
- [ ] **Team mode** — replace local SQLite with rqlite / Turso so multiple teammates share a corpus. Requires auth + conflict resolution story.
- [ ] **Plugin system** — let users drop a `.py` file into a `plugins/` dir; sidecar picks it up and exposes a new source. Lowers the bar to add arbitrary data sources.
- [ ] **Embeddings-based similarity** — per-finding embedding stored alongside, enables "find similar painpoints across topics" and dedup of near-duplicate pains.

---

## Phase D — Developer / ops

- [ ] **Tauri-side tests** (`tauri-testing` skill) — currently 0 tests on the Rust/JS side.
- [ ] **Python integration tests** — there's `tests/test_integration.py` at repo root; expand to cover resolve_provider, parameterized-SQL, enrich-skip patterns.
- [ ] **Dependency bumps** (`tauri-updating-dependencies` skill) — quarterly.
- [ ] **Cross-platform sidecar binaries** — CI workflow already in place; needs to actually run against a release tag.
- [ ] **Apple Developer signing** — once credentials land, wire `APPLE_*` + `TAURI_SIGNING_*` secrets; CI will produce signed/notarized artifacts automatically.

---

## Done (2026-04-19)

- ✅ **CSP hardened** — strict directives replacing `csp: null`
- ✅ **Capabilities scoped** — sidecar-only shell permissions, `dialog:allow-open` only
- ✅ **Splashscreen** — cream/orange themed; main window hidden until first route renders
- ✅ **Binary size** — release profile + `removeUnusedCommands`
- ✅ **macOS bundle config** — Entitlements.plist with PyInstaller hardened-runtime exceptions
- ✅ **GitHub Actions release pipeline** — cross-platform matrix, per-runner PyInstaller build
- ✅ **CSS responsiveness** — `minmax(0, 1fr)` on every grid; kv-row + profile-head overflow fixes
- ✅ **Utility button classes + inline-style sweep** — `.btn-sm` / `.btn-xs` / `.btn-bordered` / `.btn-danger` applied to all 60+ occurrences
- ✅ **Settings stale-route race fixed**
- ✅ **Aria-labels + modal focus traps** (new-topic + BYOK modals)
- ✅ **`api.js` cache + in-flight dedup + event-driven invalidation** — ~5 s TTL on all idempotent reads
- ✅ **Topic page preload** — Evidence/Sources/Chat queries fire on mount, tabs paint instantly
