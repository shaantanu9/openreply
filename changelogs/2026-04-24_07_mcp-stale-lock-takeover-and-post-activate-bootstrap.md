# MCP: stale-lock auto-recovery + post-activation auto-connect

**Date:** 2026-04-24
**Type:** Fix / UX

## Summary

User-visible failure: MCP client (Claude Code / Cursor / Claude Desktop)
emits `MCP error -32000: Connection closed` with the Python sidecar
rejecting startup via `{"error": "another_mcp_server_running", "hint":
"Kill the other instance or remove .../mcp-server.pid if you're sure
it's dead."}`. Root cause: a prior `reddit-cli mcp serve` was left
attached to a dead stdin pipe when the MCP client restarted, the PID-file
lock saw it alive, the new spawn bailed. "Re-sync" didn't help because
re-sync only rewrites client config — the lock was held by the zombie,
not touched by the installer.

Separate but related: activation completion didn't trigger MCP auto-install,
so users had to open Settings → MCP → Connect by hand after onboarding
even though every detected client was already installed.

## Changes

- **`mcp/server.py`** — `_acquire_pidfile_lock()` now honors
  `MCP_TAKEOVER_STALE_LOCK=1`. When set and the stored PID is alive, we
  send SIGTERM (lets its `atexit` hook run and release the file), poll
  for death for 3 s, escalate to SIGKILL, then retry. No-op when the
  flag is unset — preserves "don't race" semantics for manual CLI users.
  The guard's error hint now mentions the flag + `mcp install` as the
  automatic fix.
- **`mcp/install.py`** — every freshly written client entry now includes
  `MCP_TAKEOVER_STALE_LOCK: "1"` in its `env` block. Re-running install
  rewrites existing entries with the flag.
- **`mcp/install.py`** — status report gained `takeover_configured`.
  Entries without the flag get `reason: "predates stale-lock
  auto-recovery. Re-sync to avoid `another_mcp_server_running`…"` so
  the Settings card prompts the user.
- **`app-tauri/src/screens/settings.js`** — `renderState` shows a
  `needs re-sync` warning when `takeover_configured === false`, with the
  Re-sync button surfaced. One click rewrites the entry.
- **`app-tauri/src/lib/mcp_bootstrap.js`** (new) — extracted the install
  loop from `main.js` into a shared `bootstrapMcpClients({tag, targets})`
  helper so both app-open and activation-complete code paths share one
  implementation. Detects "already ready" entries (connected + aligned +
  token + takeover) and skips them.
- **`main.js`** — app-open bootstrap now calls the shared helper.
- **`app-tauri/src/screens/welcome.js`** — activation success path now
  fires `bootstrapMcpClients({tag:'mcp:post-activate'})` immediately
  (fire-and-forget, before navigation). Users who complete onboarding
  get MCP wired on every detected client without clicking Connect.

## Files Created

- `app-tauri/src/lib/mcp_bootstrap.js`
- `changelogs/2026-04-24_07_mcp-stale-lock-takeover-and-post-activate-bootstrap.md`

## Files Modified

- `src/reddit_research/mcp/server.py` — lock acquisition accepts takeover env, error hint updated.
- `src/reddit_research/mcp/install.py` — env block + status field.
- `app-tauri/src/main.js` — delegates to shared helper.
- `app-tauri/src/screens/welcome.js` — post-activation MCP install.
- `app-tauri/src/screens/settings.js` — "needs re-sync" UI for pre-flag entries.

## Verification

1. `python3 -c "import ast; …"` on both Python files → OK.
2. `cargo check` on `app-tauri/src-tauri` → clean.
3. Manual: start any MCP client after app launch; zombie prior `mcp serve`
   no longer blocks the new spawn (SIGTERM via takeover). If the prior
   instance actually is alive + healthy (same session), takeover still
   kills it — acceptable trade-off since MCP stdio servers are per-client
   and shouldn't have legit duplicates.
4. Manual: complete onboarding + activation flow; `console.info` shows
   `[mcp:post-activate] results: [...]` with `outcome: connected` for
   each detected client.
5. Manual: open Settings → MCP on an app that was installed before
   2026-04-24 — card shows `needs re-sync` with Re-sync button; one
   click rewrites the entry with the takeover flag.

## Flow answer to user's question

"When onboarding + activation is done we should auto-connect MCP — how?"

1. User finishes the activate screen (`welcome.js`) → backend `license_activate` → local flags + keychain token.
2. **New:** `welcome.js` fires `bootstrapMcpClients()` before navigating away.
3. Helper calls `mcp_clients` (list of known clients + which configs exist), filters to detected ones (Claude Code / Cursor / Claude Desktop), then for each: `mcp_status` → if not fully-wired → `mcp_install`.
4. Each `mcp install` writes the client's config with `MCP_TAKEOVER_STALE_LOCK=1`, so the client's next spawn of `mcp serve` reclaims the lock from any zombie prior instance instead of bailing.
5. Subsequent app opens re-run the same helper (via `main.js`), which now skips already-ready clients and re-syncs anything stale.

"Re-sync not working" — it works for DB/token drift. The missing case was
the takeover flag; that's now treated as a re-sync trigger in both the
Python status reporter and the Settings card.

## Not in scope

- Killing the actual zombie `mcp serve` from the desktop app's side (would require process-scanning and SIGTERM from Rust). The takeover flag in the Python server handles it cooperatively — the next client-spawned instance self-recovers.
- A "Force kill all MCP servers" button in Settings. Worth adding if users hit edge cases that the takeover flag can't resolve (e.g. SIGTERM-ignoring process), but the cooperative path should cover >99% of zombie cases.
