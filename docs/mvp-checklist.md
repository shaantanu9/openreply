# MVP launch checklist — OpenReply

**Created:** 2026-04-19 from the CodeGraph MVP audit.
**Target:** shippable DMG that a fresh user can install and use end-to-end without terminal.

Tick items as fixed. Each entry has a file:line pointer, the failure mode, and the concrete fix applied.

---

## P0 — Ship blockers

- [x] **P0-1 · Rebuild sidecar binary** ✅ 2026-04-19
  - **Fix applied:** `.venv/bin/pyinstaller reddit-cli.spec` → 65 MB binary in `dist/`. Copied to `app-tauri/src-tauri/binaries/reddit-cli-aarch64-apple-darwin`, ad-hoc signed via `codesign --force --deep --sign -`. Smoke-tested on a fresh data dir: `topic_posts`, `graph_nodes`, `graph_edges` all created.

- [x] **P0-2 · Collect crashes when no LLM key** ✅ 2026-04-19
  - **Fix applied:**
    - `src/reddit_research/graph/semantic.py::enrich_from_llm` — pre-flight provider check (env keys + Ollama reachability). Returns `{ok: false, skipped: true, reason}` when no LLM — never raises.
    - New `commands.rs::enrich_graph` Tauri command + registered in `main.rs` + exposed as `api.enrichGraph` in `api.js`.
    - `collect.js` now calls `enrichGraph` after `buildGraph`. If skipped, shows an in-log warning with a hint to add a key. New "LLM extraction" stage appears in the stage strip.

- [x] **P0-3 · Warn user before aggressive collect without an LLM** ✅ 2026-04-19
  - **Fix applied:** New-topic modal (`main.js::$('#modal-start').onclick`) checks `api.byokStatus()` before aggressive start. If no provider is ready, shows a confirm dialog with two exits: continue without AI, or redirect to Settings. Same handler also enforces P1-5 topic-name validation (regex `^[a-zA-Z0-9 _\-]{2,60}$`).

---

## P1 — UX broken (fix before public launch)

- [x] **P1-4 · SQL injection risk in topic queries** ✅ 2026-04-19
  - **Fix applied:**
    - `cli/main.py::cmd_query` — new `--topic` + repeatable `--param name=value` options. Binds to `:topic` / `:name` placeholders via sqlite-utils (safe substitution).
    - Rust `run_query` command now forwards optional `topic` + `params` map through. `get_findings` and `delete_topic` also use parameterized form.
    - Frontend `api.runQuery(sql, topic?, params?)`. All `topic='${safe}'` interpolation in `topic.js` and `home.js` rewritten to `topic=:topic` with `topic` passed as second arg.

- [x] **P1-5 · Topic-name input validation** ✅ 2026-04-19
  - **Fix applied:** New-topic modal handler in `main.js` rejects names outside `^[a-zA-Z0-9 _\-]{2,60}$` with an alert before starting collect. Welcome Step 4 flow goes through the same handler. Still need to add inline error UI (vs `alert()`) — tracked as P2-follow-up.

- [x] **P1-6 · Collect errors are opaque** ✅ 2026-04-19
  - **Fix applied:** `cli.rs::run_cli_streaming` now keeps a rolling buffer of the last 40 output lines. On non-zero exit, new `classify_collect_error` tags it as `reddit_rate_limit`, `network`, `llm_key`, `llm_model`, `db`, or `unknown` with a targeted hint. `collect:done` payload now includes `{code, error_class, hint}`. `collect.js` renders the hint inline and uses the class for the status pill.

- [x] **P1-7 · BYOK callback uses stale data** ✅ 2026-04-19
  - **Fix applied:** Real bug was in `topic.js:205` where `#btn-ev-keys` opened the BYOK modal with no callback. Now passes `() => loadEvidence()` so the Evidence tab re-runs after key save (replaces the "add key" empty state with real extracted findings). Welcome Step 3 callback was already correct.

- [x] **P1-8 · Chat opens with empty graph** ✅ 2026-04-19
  - **Fix applied:** `loadChat` in `topic.js` adds a second gate after the LLM-ready check. Runs `SELECT count(*) FROM graph_nodes WHERE topic=:topic AND kind IN ('painpoint','feature_wish','workaround','product')` — if 0, renders a placeholder with "Build research map now" (calls `buildGraph` + `enrichGraph`) and "Re-run collect" buttons.

---

## P2 — Polish

- [x] **P2-9 · `report-pro` / `findings` accept `--json` no-op** ✅ 2026-04-19
  - **Fix applied:** Added `as_json: bool = typer.Option(False, "--json", hidden=True)` to `cmd_research_report_pro` and `cmd_research_findings`. Flag is ignored but prevents "No such option" errors if a Rust caller ever adds `--json` to these paths.

- [x] **P2-10 · Topic tiles need hover affordance** ✅ 2026-04-19
  - **Fix applied:** `.topic-tile` already had `cursor: pointer` and a lift/shadow on hover. Added `border-color: var(--orange)` on hover for extra affordance. Visible on Dashboard, Topics list, and Welcome Step 4 example grid.

- [x] **P2-11 · Auto-start Ollama on first Test click** ✅ 2026-04-19
  - **Fix applied:** Test button in `byok.js` now pings `/api/tags` first. If unreachable, shows "Ollama not reachable — starting service…" and calls `api.ollamaStartService()` (Rust spawns `ollama serve` + polls port 11434 up to 5 s). Retries the tags fetch once after start. If still fails, surfaces the original error.

- [x] **P2-12 · MCP server auto-start** ✅ 2026-04-19 (docs-only per spec)
  - **Fix applied:** New Settings card "Use with Claude Code" shows the `reddit-cli mcp install` one-liner + explanation of the 40+ exposed tools, with a link to the MCP spec. Auto-start intentionally deferred — CLI install is idiomatic for Claude Code users.

---

## P3 — After launch

- [ ] **P3-13** Multi-Ollama support (multiple `OLLAMA_BASE_URL` slots with per-slot model)
- [ ] **P3-14** MCP `query` tool — parameterize SQL (same fix as P1-4)
- [ ] **P3-15** Bundled local LLM via llama.cpp + Gemma (see `docs/manual-todo/future-scope-bundled-local-llm.md`)

---

## Verification after each fix

- Run `.venv/bin/pytest -v tests/` — all 13 tests must pass.
- Manually test the affected UI path (or extend tests to cover).
- Commit with message `fix(mvp-P0-N): …`.
- Tick the box above.
