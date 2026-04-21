# MCP ↔ App integration spec (no code yet)

**Date:** 2026-04-21
**Type:** Documentation

## Summary

Captured the design for connecting the bundled `reddit-myind` MCP server to the Tauri app so they share the same SQLite + ChromaDB. Today they don't — the MCP defaults to `<repo>/data/reddit.db` (432 KB, stale) while the app writes to `~/Library/Application Support/com.shantanu.gapmap/reddit-myind/reddit.db` (49 MB). Anything fetched/scraped via Claude's MCP tools never reaches the app UI.

The spec covers a v1 one-click "Connect to Claude Code" Settings button that aligns DB paths, writes a provisioning token (no enforcement yet), and installs/uninstalls the MCP entry in `~/.claude.json` atomically. Token enforcement, OS-keychain storage, and capability-scoped tokens are deferred — explicitly listed as "find a better way to gate this feature in the future."

No code in this entry — just the spec.

## Files Created

- `docs/superpowers/specs/2026-04-21-mcp-app-integration.md` — full design (problem, goals, non-goals, install/uninstall/re-sync flows, CLI subcommands, Tauri commands, Settings UI, cross-platform paths, risks, test plan, future gating ideas)
- `changelogs/2026-04-21_02_mcp-integration-spec.md` — this entry
