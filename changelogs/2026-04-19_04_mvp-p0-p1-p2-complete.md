# MVP checklist — all P0/P1/P2 items complete

**Date:** 2026-04-19
**Type:** Feature + Fix + Infrastructure

## Summary

Worked the MVP-readiness audit punch list (`docs/mvp-checklist.md`) end-to-
end. Every P0 ship-blocker, every P1 UX-broken item, and every P2 polish
item is now implemented and verified. `pytest -v tests/` is green (13/13).
The Tauri app can be installed by a fresh user, start a topic with or
without an LLM key, produce a gap map, and chat over it — with clear
error messages at every failure branch.

## P0 — Ship blockers (shipped)

- **P0-1** · Rebuilt sidecar: 65 MB PyInstaller binary, ad-hoc signed.
  Smoke-tested with a fresh data dir; confirms the new schema (`topic_posts`,
  `graph_nodes`, `graph_edges`) is created on first launch.
- **P0-2** · `enrich_from_llm` now pre-flights provider availability (env
  keys + Ollama reachability probe) and returns `{ok: false, skipped: true,
  reason}` instead of raising. New `enrich_graph` Tauri command + `api.enrichGraph`
  + `collect.js` wiring. Collect pipeline never crashes when no LLM is
  configured — completes with posts-only and a clear "skipped" warning.
- **P0-3** · New-topic modal checks `byokStatus` before aggressive collect.
  If no provider is ready, offers "Continue without AI" vs. redirect to
  Settings. Same handler also enforces P1-5 topic-name validation.

## P1 — UX broken (shipped)

- **P1-4** · Parameterized topic SQL across stack. `cmd_query` accepts
  `--topic` and repeatable `--param name=value`. sqlite-utils binds safely.
  Rust `run_query` + `get_findings` + `delete_topic` forward them.
  Frontend `api.runQuery(sql, topic, params)`. All `topic='${safe}'`
  string concatenation in `topic.js` and `home.js` rewritten to `:topic`
  placeholders.
- **P1-5** · Topic-name regex `^[a-zA-Z0-9 _\-]{2,60}$` in `main.js::modal-start`.
- **P1-6** · `cli.rs::run_cli_streaming` keeps the last 40 output lines;
  new `classify_collect_error` tags non-zero exits as
  `reddit_rate_limit` / `network` / `llm_key` / `llm_model` / `db` / `unknown`
  with a targeted hint. `collect:done` payload now carries
  `{code, error_class, hint}`. `collect.js` surfaces the hint inline.
- **P1-7** · `topic.js::#btn-ev-keys` BYOK modal now passes
  `() => loadEvidence()` callback, so saving a key re-renders the Evidence
  tab with freshly extracted findings.
- **P1-8** · Chat tab has a second gate checking `graph_nodes` count. If 0,
  renders "Build gap map now" placeholder with buttons that call
  `buildGraph` → `enrichGraph`, or "Re-run collect".

## P2 — Polish (shipped)

- **P2-9** · Added `as_json: bool = typer.Option(False, "--json", hidden=True)`
  (no-op) on `cmd_research_report_pro` and `cmd_research_findings`. Prevents
  future Rust callers auto-appending `--json` from hitting "No such option".
- **P2-10** · `.topic-tile:hover` gets `border-color: var(--orange)` on top
  of existing lift/shadow for extra affordance.
- **P2-11** · BYOK Test button for Ollama now detects unreachable service,
  calls `api.ollamaStartService()`, retries the tags fetch once, then
  proceeds. User sees "Ollama not reachable — starting service…" inline.
- **P2-12** · New Settings card "Use with Claude Code" shows the
  `reddit-cli mcp install` one-liner + explanation of the 40+ MCP tools,
  with a link to the MCP spec. Auto-start deferred (docs-only per audit).

## Files created this round

- `changelogs/2026-04-19_04_mvp-p0-p1-p2-complete.md` — this file

## Files modified (summary — this round only)

- `reddit-cli.spec` — rebuilt via pyinstaller
- `app-tauri/src-tauri/binaries/reddit-cli-aarch64-apple-darwin` — replaced
  with fresh 65 MB binary, ad-hoc signed
- `src/reddit_research/graph/semantic.py` — `enrich_from_llm` guards
- `src/reddit_research/cli/main.py` — `cmd_query` `--topic`/`--param`,
  `cmd_info` accepts `--json`, `cmd_research_report_pro` + `cmd_research_findings`
  accept `--json` hidden no-op
- `app-tauri/src-tauri/src/commands.rs` — `enrich_graph` command, parameterized
  `get_findings` + `delete_topic`, `run_query` forwards topic/params
- `app-tauri/src-tauri/src/main.rs` — register `enrich_graph`
- `app-tauri/src-tauri/src/cli.rs` — `classify_collect_error`, rolling log buffer
- `app-tauri/src/api.js` — `enrichGraph`, extended `runQuery(sql, topic, params)`
- `app-tauri/src/main.js` — new-topic validation + no-LLM warning + `hasLlmConfigured`
- `app-tauri/src/screens/byok.js` — Test button auto-starts Ollama
- `app-tauri/src/screens/topic.js` — BYOK callback, chat graph-gate, parameterized SQL
- `app-tauri/src/screens/home.js` — parameterized `topTopic` daily query
- `app-tauri/src/screens/collect.js` — enrich stage wired in, error-class rendering
- `app-tauri/src/screens/settings.js` — "Use with Claude Code" MCP card
- `app-tauri/src/style.css` — topic-tile hover outline

## Verification

- `.venv/bin/pytest -v tests/` → **13 passed in 77.96s** (live Reddit + Ollama +
  MCP + SQL + DB schema + fetch audit + exporters all verified).
- Tauri dev server sidecar log: `[sidecar] dev-python OK in 500-800ms` on
  every dashboard call since the P0-1 binary swap.
- Manual test flow: fresh data dir → open BYOK → pick Ollama → auto-start →
  pull model → new topic "note taking apps" → aggressive collect → posts
  land → graph builds → enrichment runs → painpoints visible on map →
  chat with graph returns grounded answers.

## What's left for shipping the DMG

All code-level work for the MVP is done. Remaining is operational:
1. `tauri build` to produce the `.dmg`
2. Developer ID codesign + notarize (or ad-hoc sign for internal testing)
3. Attach release notes; publish.

Future scope (post-MVP) in `docs/manual-todo/future-scope-bundled-local-llm.md`
and P3 items in `docs/mvp-checklist.md`.
