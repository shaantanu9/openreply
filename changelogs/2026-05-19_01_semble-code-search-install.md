# Install Semble code search

**Date:** 2026-05-19
**Type:** Infrastructure

## Summary

Installed Semble (MinishLab) — a fast local code-search tool for AI agents (~98% fewer tokens than grep-and-read, CPU-only, no API keys). The MCP server was already registered at user scope; this change adds the standalone CLI and a Claude Code sub-agent for the `reddit-myind` repo.

## Changes

- Verified the `semble` MCP server is connected at user scope (`uvx --from semble[mcp] semble`) — tools `search` and `find_related` available in all projects.
- Installed the standalone CLI: `uv tool install semble` → `~/.local/bin/semble` (subcommands: `search`, `find-related`, `init`, `savings`).
- Ran `semble init` in the repo, creating a dedicated `semble-search` sub-agent.
- Smoke-tested `semble search` against the repo — returns ranked code chunks correctly (one transient tree-sitter grammar download retry needed on first run).

## Files Created

- `.claude/agents/semble-search.md` — Claude Code sub-agent definition for semantic code search.
