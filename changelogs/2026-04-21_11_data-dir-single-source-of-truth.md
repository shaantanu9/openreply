# Fix: single source of truth for data_dir across UI / CLI / MCP

**Date:** 2026-04-21
**Type:** Fix — critical correctness

## Summary

When a user invoked Gap Map's MCP server from Cursor / Claude Code, the
Python code created reports, SQLite DBs, and the palace store at
`<user-project>/data/` instead of the canonical app-data folder. The
desktop app couldn't see that data, and every new client session
forked a fresh DB in a different folder.

Root cause in `core/config.py::load_config`:
```python
data_dir = Path(os.getenv("REDDIT_MYIND_DATA_DIR") or (Path.cwd() / "data"))
```
When the env was missing (MCP case — Cursor/Claude Code don't set it),
the fallback was CWD. Every MCP client had a different CWD.

## Fix

New `_resolve_data_dir()` helper in `core/config.py`. Resolution order:

1. `REDDIT_MYIND_DATA_DIR` env var (Tauri sidecar continues to set this)
2. **Platform app-data folder matching Tauri's convention:**
   - macOS: `~/Library/Application Support/com.shantanu.gapmap/reddit-myind`
   - Linux: `$XDG_DATA_HOME/com.shantanu.gapmap/reddit-myind`
   - Windows: `%APPDATA%\com.shantanu.gapmap\reddit-myind`
3. Legacy `~/.config/reddit-myind/data`
4. CWD `./data` (absolute last resort, emits `warnings.warn`)

Also updated:
- `mcp/install.py::default_data_dir()` — delegates to the same resolver
  so the MCP install token lands in the canonical folder.
- `mcp/server.py::_pidfile_path()` — PID-file lock is in the canonical
  folder (was previously trying to import a non-existent
  `db._DATA_DIR`).

Bundle ID hardcoded in one constant (`_TAURI_BUNDLE_ID`); must match
`app-tauri/src-tauri/tauri.conf.json::identifier`.

## Verified convergence

From `/tmp` with no env set:
```
_resolve_data_dir   : /Users/x/Library/Application Support/com.shantanu.gapmap/reddit-myind
load_config.data_dir: /Users/x/Library/Application Support/com.shantanu.gapmap/reddit-myind
install.default_data_dir: /Users/x/Library/Application Support/com.shantanu.gapmap/reddit-myind
server._pidfile_path: /Users/x/Library/Application Support/com.shantanu.gapmap/reddit-myind/mcp-server.pid
```

All four entry points resolve to the same folder regardless of CWD.
21/21 existing tests still pass — they use `REDDIT_MYIND_DATA_DIR`
monkeypatch via `tmp_path` so they were insulated from the old CWD
fallback anyway.

## What this fixes user-side

- MCP-created data is immediately visible in the desktop UI.
- Topic lists, bets, findings, feedback, saved views stay in sync across
  surfaces.
- Soft-delete trash / custom prompts / product registrations don't
  fragment across N folders.
- "Reveal in Finder" from Settings opens the same folder that the MCP
  writes to.

## Recovery for existing users

Users on pre-fix builds may have orphan data folders. Find them:
```bash
find ~ -name "reddit.db" -not -path "*/Library/Application*" 2>/dev/null
```
Copy rows into the canonical DB OR re-collect the affected topics.

## Files Created

- `docs/ops/data-dir-single-source-of-truth.md` — full why/what/how
- `changelogs/2026-04-21_11_data-dir-single-source-of-truth.md`

## Files Modified

- `src/reddit_research/core/config.py` — `_resolve_data_dir()` +
  platform logic + 3-step fallback chain
- `src/reddit_research/mcp/install.py` — `default_data_dir()` delegates
  to resolver
- `src/reddit_research/mcp/server.py` — `_pidfile_path()` uses resolver
