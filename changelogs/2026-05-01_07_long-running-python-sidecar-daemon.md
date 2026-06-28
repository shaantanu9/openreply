# Long-running Python sidecar daemon

**Date:** 2026-05-01
**Type:** Infrastructure

## Summary

Every UI call that funneled through `cli::run_cli` previously paid the Python interpreter / module-import startup cost (~300–1500 ms per call in dev, longer in bundled DMG). Topic-open alone fired several such calls. This change adds a long-running daemon: one warm Python process whose stdin reads JSON requests and stdout writes JSON responses. First call still pays imports; subsequent calls land in the already-warm process. Measured locally: 3 sequential `research hypothesis-stats` invocations dropped from 37.6 s (one-shot) to 15.7 s (daemon) — the 2nd and 3rd calls are essentially free.

Scope: dev-mode only (`.venv/bin/python` path). The bundled PyInstaller path keeps the existing one-shot `Command::output()` flow — its event-channel-based stdin/stdout via Tauri's shell plugin is a meatier refactor for a follow-up. Cross-session SWR caching from changelog #06 already covers most user-visible cold-start pain on bundled installs.

## Architecture

- **Python (`reddit_research/cli/main.py`)** — new `daemon` Typer command.
  - On startup writes a one-line handshake `{"_daemon_ready": true}` so the parent can treat the spawn as ready.
  - Per request: parses `{id, args}` JSON line, captures stdout/stderr via `io.StringIO`, dispatches to the existing `app(args, standalone_mode=False)`, parses the captured stdout back as JSON, writes one-line `{id, ok, result|error}` JSON response.
  - Catches `SystemExit` (Click's normal exit path) and any other exception, surfacing them in the response without killing the daemon. Tracebacks go to the captured stderr and are echoed back.
- **Rust (`app-tauri/src-tauri/src/cli.rs`)**:
  - `DevDaemon` struct — owns the `tokio::process::Child` plus its piped stdin/stdout buffers.
  - `dev_daemon_slot()` — `OnceLock<Arc<tokio::sync::Mutex<Option<DevDaemon>>>>` global; serializes concurrent calls and lets the slot be cleared if the child dies.
  - `spawn_dev_daemon()` — lazy spawn on first call; awaits the handshake line.
  - `run_via_dev_daemon()` — sends one request line, reads one response line, returns a `DaemonOutcome` enum (`Ok` / `CommandFailed` / `DaemonBroken`).
  - `run_cli()` integration: tries the daemon first; on `DaemonBroken` (write/read/parse/IO failure) drops the slot and falls back to the existing `run_dev_python_cli` one-shot path. `CommandFailed` propagates as-is — re-running one-shot would just fail too.
  - `shutdown_dev_daemon()` called from `RunEvent::ExitRequested | RunEvent::Exit` so the warm Python process doesn't outlive the GUI.

## Trade-offs / Known Gaps

- **Serialization across the mutex.** All daemon-routed commands queue through one slot. This is the right choice for the read-heavy UI workload (sub-10 ms per call once warm) but means a slow command (`enrich_graph` non-streaming, `clean_corpus`) blocks other reads while it runs. Streaming commands continue to spawn separately and are unaffected. A worker-pool extension can be added later if needed.
- **Bundled path untouched.** No regression — bundled installs keep the existing one-shot path. Future work: thread daemon support through Tauri's `tauri_plugin_shell::Command` event-channel API for the bundled binary.
- **Process state shared across calls.** Each invocation runs Click in-process via `standalone_mode=False`, so module-level state (DB connection caches, logging config) persists across calls. None of the existing commands rely on a fresh process per call.

## Files Modified

- `src/reddit_research/cli/main.py` — added `cmd_daemon()` Typer command.
- `app-tauri/src-tauri/src/cli.rs` — added `DevDaemon`, `dev_daemon_slot`, `spawn_dev_daemon`, `run_via_dev_daemon`, `DaemonOutcome` enum, `shutdown_dev_daemon`. Modified `run_cli` to try daemon-first with fallback.
- `app-tauri/src-tauri/src/main.rs` — wired `cli::shutdown_dev_daemon()` into the `RunEvent::Exit*` cleanup branch.

## Verification

- `python -m reddit_research.cli.main daemon` smoke-tested with three back-to-back `research hypothesis-stats` requests; first call ~12 s (imports), subsequent calls ~0.1 s each.
- `cargo check` and `cargo check --tests` both clean (no warnings, no errors).
- Python `py_compile` clean.
