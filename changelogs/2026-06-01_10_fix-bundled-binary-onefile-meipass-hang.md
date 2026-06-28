# Fix: bundled CLI hung on startup (leaked _MEI dirs filled disk) + truthful MCP "Connected" status

**Date:** 2026-06-01
**Type:** Fix

## Summary

Follow-up to `2026-06-01_03` (Claude Code MCP "Failed to connect"). Root-caused *why* the bundled `openreply-cli` hangs and fixed the underlying causes.

`openreply-cli` is a PyInstaller **onefile** binary — it extracts ~310 MB to a fresh `/var/folders/.../T/_MEIxxxxxx` dir on **every** launch and removes it via an `atexit` handler on clean exit only. Processes killed with SIGKILL (or that hang mid-extraction) leak their `_MEI` dir. These accumulated to **93 dirs / 29 GB**, filling the data volume to **100%**. With no free space, the PyInstaller bootloader could no longer finish extracting, so **every** `openreply-cli` invocation hung in the bootstrap (confirmed via `/usr/bin/sample`: stack stuck in `dyld start → openreply-cli bootloader → fork`, before any Python ran, zero bytes out). This cascaded: the Tauri app spawns dozens of `openreply-cli` calls (dashboard polling + `mcp serve`) → all hung → 150+ stuck processes → "data not loading" and MCP "failed to connect". The dev-venv binary is immune (plain Python, no extraction) — which is why the `_03` workaround (repoint Claude Code at `.venv/bin/openreply`) worked.

Separately, `status()` reported `connected=True` purely because the config entry existed — it never did a handshake — so the app's "Connected · DB aligned" badge was a false positive while the client saw a hang.

## Root cause (evidence)

- 2×2 probe matrix: bundled binary HUNG under both minimal and full PATH; venv binary responded under both → the binary (not PATH) is the variable.
- Bundled binary hung on **all** commands (`--version`, `mcp --help`), not just `mcp serve` → bootstrap-level, not MCP-code-level.
- `df`: data volume at 100% (5 GiB free); `/var/folders/.../T` held 93 `_MEI*` dirs = 29 GB.
- `sample` of a hung PID: wedged in the PyInstaller onefile bootloader extraction/`fork`.
- After reclaiming 29 GB, the bundled binary worked again but took **~37–49 s** (cold onefile extraction) — still too slow for client timeouts and still leaking on every killed process.

## Changes

### Environment recovery (user's machine, not code)
- Quit the running OpenReply app, killed 150+ orphaned hung `openreply-cli` bootloaders, deleted the 93 leaked `_MEI` dirs → reclaimed ~26 GB (disk 100% → 97%, 7.4 → 33 GiB free). Bundled binary functional again.

### Fix A — auto-clean orphaned `_MEI` dirs at startup (prevents recurrence)
- New `src/openreply/core/meipass_cleanup.py`: sweeps orphaned `_MEIxxxxxx` dirs so the leak can never accumulate to a disk-filling level. Safety contract — only removes a dir that is (1) not this process's own `sys._MEIPASS`, (2) not holding any open file of a live `openreply` process (psutil check), and (3) older than a 300 s grace window (so a sibling mid-extraction is never touched). Refuses to act without psutil. Runs in a daemon thread (never blocks startup) and self-noops outside a frozen build.
- Wired into `scripts/pyinstaller-entrypoint.py` (runs on every bundled launch, before the CLI app).

### Fix B — truthful MCP "Connected" status (real handshake)
- `src/openreply/mcp/install.py`: new `probe_server_handshake()` spawns the configured command and performs a real stdio `initialize` round-trip with a bounded timeout (default 60 s to tolerate cold starts). `status()` gains `probe`/`probe_timeout` params and `live`/`handshake_ms`/`probe_error` fields; when `probe=True`, `connected` reflects the handshake result instead of mere config presence.
- `src/openreply/cli/main.py`: `mcp status` gains `--probe` / `--probe-timeout`, prints `live`/`handshake_ms`/`probe_error`.

### Fix C — daemon / run_cli timeouts (verified already present)
- Confirmed `cli.rs` already wraps `run_cli` (`.output()`) and all daemon `read_line` handshakes in `tokio::time::timeout` (`ONESHOT`/`DAEMON_REQUEST` = 120 s, `DAEMON_HANDSHAKE` = 45 s). The no-timeout hang from earlier observations is already fixed. No Rust change made (kept verifiable scope).

## Files Created
- `src/openreply/core/meipass_cleanup.py`
- `tests/test_meipass_cleanup.py` (9 tests — pure safety-rule logic + no-op contract)
- `tests/test_mcp_probe.py` (5 tests — spawn-failure, no-response timeout, probe=False introspection, hanging-command → not-connected, real venv handshake)

## Files Modified
- `scripts/pyinstaller-entrypoint.py` — start background `_MEI` sweep before app boot
- `src/openreply/mcp/install.py` — `probe_server_handshake()`, `status(probe=...)`, new live fields
- `src/openreply/cli/main.py` — `mcp status --probe / --probe-timeout`

## Verification
- `pytest tests/test_meipass_cleanup.py tests/test_mcp_probe.py tests/test_mcp_lock.py` → 17 passed (incl. real venv handshake).
- E2E against the real `~/.claude.json`: `openreply mcp status --client claude-code --probe` → `connected=true, live=true, handshake_ms=4214`. Without `--probe`: fast introspection, `live=null`.

## Not done (needs a build/release — deferred per user)
- **The real perf/leak root fix is onefile → onedir** in `openreply-cli.spec` (eliminates per-launch extraction entirely; no `_MEI`, no leak, ~1 s startup). Not changed here because it alters Tauri sidecar packaging and can't be verified without a full app rebuild. Fix A is the shipped safety net until then.
- These source fixes ship only in a **new build**; the installed app is unaffected until rebuilt/reinstalled. No release performed.
- App UI should call `status(probe=True)` (e.g. behind a "Verify connection" action) so the badge reflects real liveness.
