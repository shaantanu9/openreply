# MCP ↔ App integration v1 — one-click "Connect to Claude Code"

**Date:** 2026-04-21
**Type:** Feature

## Summary

Implements v1 of the spec at `docs/superpowers/specs/2026-04-21-mcp-app-integration.md`. Adds a Settings → Use with Claude Code card with three states (Not connected · Connected & DB-aligned · Connected but DB mismatch) and Connect / Re-sync / Disconnect buttons. The buttons shell out to a new `reddit-cli mcp {install,uninstall,status} --json` group that atomically merges the `mcpServers["reddit-myind"]` entry into `~/.claude.json`, generates a 32-byte token under `<data_dir>/mcp_token`, and aligns the entry's `REDDIT_MYIND_DATA_DIR` env to the same SQLite + Palace ChromaDB the Tauri app reads. After Connect + a Claude Code restart, every MCP tool call lands in the app's DB.

Token gating is plumbed through `env.REDDIT_MYIND_TOKEN` and the MCP server reads it on startup but does not enforce yet — by design, deferred to a future iteration with concrete options listed in the spec (OS keychain, capability-scoped tokens, time-boxed rotation).

Verified end-to-end against a tmp Claude config: install, status, uninstall round-trip preserves other entries and produces the expected JSON / token-file / cleanup. UI hangs at "connecting…" if the user doesn't restart `tauri dev` after the change (Rust commands don't hot-reload).

## Changes

- New `mcp install` / `mcp uninstall` / `mcp status` CLI subcommands, all with `--json` for programmatic callers
- New `src/reddit_research/mcp/install.py` module: atomic JSON writes, one-time `.gapmap-bak` of the user's config, secrets.token_urlsafe(32) → `mcp_token` (mode 0600), idempotent install (re-running re-syncs paths without rotating token)
- New Tauri commands `mcp_status`, `mcp_install`, `mcp_uninstall` — thin wrappers around the CLI; resolve sidecar bin path in prod (sibling of `current_exe()` in `Contents/MacOS/`) or `--project-dir` in dev (walk up to repo with `pyproject.toml` + `.venv`)
- Settings card replaced — old static "use with Claude Code" instructions swapped for a live status card with colored status dot, three-state UI, and Connect / Re-sync / Disconnect buttons
- MCP server `run()` now reads `REDDIT_MYIND_TOKEN` from env (no enforcement yet — plumbed for v2)
- `mcp/__init__.py` made lazy so `mcp.install` can be imported without the optional `[mcp]` extra (fastmcp) being installed

## Files Created

- `src/reddit_research/mcp/install.py`
- `changelogs/2026-04-21_03_mcp-app-integration-v1.md`

## Files Modified

- `src/reddit_research/cli/main.py` — replaced the basic `mcp install` with the richer install (with --bin / --project-dir / --data-dir / --rotate-token / --json), added `mcp uninstall` and `mcp status`
- `src/reddit_research/mcp/__init__.py` — lazy `__getattr__` so optional fastmcp dep doesn't block sibling imports
- `src/reddit_research/mcp/server.py` — read `REDDIT_MYIND_TOKEN` env var on startup (no-op for v1, plumbed for v2 enforcement)
- `app-tauri/src-tauri/src/commands.rs` — added `mcp_status` / `mcp_install` / `mcp_uninstall` Tauri commands + `resolve_sidecar_bin_path` / `dev_project_dir` helpers
- `app-tauri/src-tauri/src/main.rs` — registered the three new commands in `generate_handler!`
- `app-tauri/src/api.js` — added `api.mcpStatus / mcpInstall / mcpUninstall`
- `app-tauri/src/screens/settings.js` — replaced the static MCP card with a working three-state UI, wired Connect / Re-sync / Disconnect buttons
- `app-tauri/src/style.css` — `.mcp-status-row` / `.mcp-status-dot` / `#card-mcp` styling

## Manual step

Restart the running `tauri dev` (Ctrl-C → `npm run tauri dev` again) — Rust's `generate_handler!` doesn't hot-reload, so the live process needs to come up with the new commands compiled in. Symptom of skipping this step: the Settings card hangs at "connecting…" because `invoke('mcp_install')` finds no handler.
