# MCP: per-client pidfile stops cross-client takeover thrash

**Date:** 2026-04-27
**Type:** Fix

## Summary

The reddit-myind MCP server was being restarted every 3-5 minutes — 164 startups in the last 7 days but only 88 actual tool calls and 2 clean `startup:exit` events. Symptom on the user side: "lost connection" mid-tool-call, sometimes mid-response.

Root cause: every install (`claude-code`, `claude-desktop`, `cursor`) shared a single `mcp-server.pid` lock file because the pidfile path was data-dir-scoped. Combined with `MCP_TAKEOVER_STALE_LOCK=1` baked into every entry's env (added 2026-04-24 to recover from genuine zombie pidfiles), each MCP client's reconnect SIGTERMed the *healthy* server owned by another client. The takeover code in `_acquire_pidfile_lock` couldn't tell a zombie from a legit-but-different-client live server, so it nuked everything. With three clients all reconnecting on slightly offset intervals, one of them would kill the server roughly every 90-180 seconds.

Fix: scope the pidfile per client. Each install now writes `MCP_CLIENT_TAG=<client>` into its env block; the server reads it and uses `mcp-server.<tag>.pid` instead of the shared name. Three clients = three independent server processes = no takeover battles. Backward-compatible — entries written before this change keep working via the original `mcp-server.pid` fallback path until they're re-synced.

## Changes

- **`src/reddit_research/mcp/server.py`** — `_pidfile_path()` reads `MCP_CLIENT_TAG`, sanitises it (`[a-z0-9-]` only — no path traversal), and returns `mcp-server.<tag>.pid` when present. Falls back to the original `mcp-server.pid` when the env var is missing.
- **`src/reddit_research/mcp/install.py`** — entry `env` block now includes `MCP_CLIENT_TAG: <client>` (defaults to `claude-code` when no client is specified). `status()` exposes a new `client_tag_configured` field and surfaces a "re-sync" reason when the tag is missing or stale.
- **`scripts/mcp_doctor.sh`** — config-sanity stanza now checks `MCP_CLIENT_TAG` per client, calls out missing tags as the cause of mid-tool-call disconnects, and recommends the exact `reddit-cli mcp install --client X` invocation to fix.
- **All three client configs reinstalled** — `claude-code` → tag `claude-code`, `claude-desktop` → tag `claude-desktop`, `cursor` → tag `cursor`. Doctor confirms green on all three; smoke launch reaches `startup:ready` in 323 ms with a clean `startup:exit` event.

## Files Modified

- `src/reddit_research/mcp/server.py` — per-client pidfile path resolution
- `src/reddit_research/mcp/install.py` — write `MCP_CLIENT_TAG` into entry env, surface `client_tag_configured` in status
- `scripts/mcp_doctor.sh` — diagnose missing/stale tags

## Files Created

- `changelogs/2026-04-27_02_mcp-per-client-pidfile-stops-cross-client-thrash.md` — this entry

## Verification

- `bash scripts/mcp_doctor.sh` — every config row green, including the new `MCP_CLIENT_TAG=<client> — per-client pidfile, no cross-client thrash` line for all three clients.
- Two parallel `mcp serve` processes with different `MCP_CLIENT_TAG` values coexisted without fighting in a manual smoke test (`mcp-server.cursor.pid` and `mcp-server.claude-code.pid` both present at the same time, neither killed the other).
- Tauri Rust command `mcp_install(client)` already plumbs `--client X` to the Python CLI, so the Settings panel "Connect" button writes the new tag automatically — no UI changes needed.

## What this means for shipped builds (activation-key users)

The Tauri MCP install command is gated by `ensure_mcp_allowed(&app)?` — i.e. a valid activation already controls who can connect. The per-client pidfile change is purely additive on top of that gate. End users who own the bundled `.app` and an activation key will see:

1. Settings → "Connect to Claude Code" → license check passes → per-client tag baked in.
2. They can connect Claude Code AND Cursor AND Claude Desktop at the same time without disconnects.
3. No more "lost connection" mid-response.

The fix benefits dev mode (where I tested) and prod mode (`--bin <PyInstaller binary>`) identically — the env var flows through the same `install()` path.

## Out of scope (follow-ups)

- Slow tools — `gapmap_fetch_appstore` averages 19 s and maxes at 37 s, exceeding Claude Code's ~25-30 s tool-call timeout. Even with a stable connection these can cause client-side cancellation. Candidates for chunked/streaming response, page-cap, or pre-warmed cache.
- `_sweep_stale_siblings` still kills any `reddit-cli mcp serve` older than 1 day regardless of tag — fine for now (per-tag pids prevent the cross-client kill at startup) but should eventually filter by `MCP_CLIENT_TAG` too.
- Migration: existing entries written before today still use the un-tagged pidfile path until re-synced. `status()` now flags this as a re-sync trigger; the Settings UI's "Re-sync" button (if present) handles it transparently.
