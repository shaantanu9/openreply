# Fix MCP Settings card hanging forever + auto-connect all detected clients on app load

**Date:** 2026-06-01
**Type:** Fix

## Summary

The "Use with an MCP client" card in Settings could sit on `loading…` /
`checking…` indefinitely (reported: 10 minutes, never resolved). Root cause was
an **unbounded daemon request round-trip** in the Rust sidecar layer: once a
`run_cli` call acquired the daemon lock and wrote a request, it awaited
`read_line` on the daemon's stdout with **no timeout**. A Python sidecar daemon
that wedged mid-command (deadlock, stuck I/O, runaway query) therefore blocked
forever, holding the lock — the Tauri command never returned, so the JS
`invoke` promise never settled. The Settings card's init awaits
(`api.licenseGateStatus()`, `api.mcpClients()`) had no JS timeout either, so the
card froze before it ever reached `refresh()` (which *does* have a 45s timeout).

Fixed at the root in Rust (bounded round-trip that kills + re-spawns a wedged
daemon and falls back to one-shot) and hardened the JS layers so the card always
reaches an interactive state. Also made app-load auto-connect cover **every
detected MCP client** (previously only Cursor / Claude Code / Claude Desktop),
per the user's request.

## Changes

- **Rust root cause:** Added `DAEMON_REQUEST_TIMEOUT_SECS = 120` and wrapped the
  write+flush+`read_line` round-trip in both `run_via_dev_daemon` and
  `run_via_sidecar_daemon` (`cli.rs`) in `tokio::time::timeout`. On timeout the
  wedged daemon child is **killed** (so the next call re-spawns a fresh one) and
  the call returns `DaemonOutcome::DaemonBroken`, falling back to the one-shot
  spawn. No single command can freeze the daemon lane again. 120s is generous
  enough never to abort a legitimately slow daemon command (a sync LLM job can
  take 30–90s) but finite so a genuine wedge self-heals.
- **Settings card resilience:** Added a `withTimeout` helper in the MCP card IIFE
  and wrapped the previously-unbounded init awaits — `licenseGateStatus()` (8s),
  `licenseStatus()` (8s), `mcpClients()` (8s) — so a slow/stuck backend can no
  longer block the card before `refresh()` runs.
- **Auto-connect on Settings open:** The Settings card now delegates to the
  shared `bootstrapMcpClients()` helper (once per launch, fire-and-forget) and
  repaints, self-healing clients installed after launch or when app-open
  bootstrap was skipped.
- **All detected clients:** `bootstrapMcpClients()` now defaults its target set
  to **every detected client** instead of a fixed 3-client list. Explicit
  `targets` still win; `DEFAULT_TARGETS` (now incl. windsurf + cline) is only a
  fallback when enumeration yields nothing. This applies to every caller
  (app-open, onboarding, post-activation, Settings-open).
- **Bootstrap timeouts:** Wrapped `mcpClients` / `mcpStatus` / `mcpInstall` in
  `mcp_bootstrap.js` with per-call timeouts (12s / 45s) so one slow client can't
  stall the whole bootstrap.
- **App-open probe timeout:** Bounded the ephemeral-path `api.mcpStatus()` probe
  in `main.js` (12s) that previously could hang the app-open bootstrap.

## Verification

- `cargo check` (src-tauri): 0 errors.
- `npm run build` (vite): success.
- `npm test`: 50/50 pass.

## Note (deployment)

The frontend is bundled into `Gap Map.app`, so these changes (JS + Rust) reach
users only via a **rebuild of the app** — the currently-installed
`/Applications/Gap Map.app` will not pick them up until then. Immediate relief
for a live freeze: quit (⌘Q) and relaunch, which kills the wedged daemon child.

## Files Modified

- `app-tauri/src-tauri/src/cli.rs` — `DAEMON_REQUEST_TIMEOUT_SECS` constant +
  bounded round-trip (kill+respawn on wedge) in both daemon functions.
- `app-tauri/src/lib/mcp_bootstrap.js` — `withTimeout` helper, default to all
  detected clients, per-call timeouts, expanded `DEFAULT_TARGETS`.
- `app-tauri/src/screens/settings.js` — `withTimeout` helper, bounded init
  awaits, Settings-open auto-connect via shared bootstrap helper.
- `app-tauri/src/main.js` — bounded the app-open ephemeral-path MCP status probe.
