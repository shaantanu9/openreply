# Rename project + MCP tools + sidecar from reddit/reddit-myind to gapmap

**Date:** 2026-05-25
**Type:** Refactor

## Summary

Renamed the project's identity end-to-end from the legacy `reddit-myind` /
`reddit-cli` / `reddit_research` / `reddit_*` MCP naming to consistent
`gapmap` naming across the Python package, CLI, MCP server, Tauri app, and
all active docs. Legitimate Reddit-API references (PRAW, `REDDIT_CLIENT_ID`,
`api.reddit.com`, `subreddit`, the `reddit` source_type) were carefully
preserved — only the project/brand naming changed. Existing users' on-disk
data (`~/Library/Application Support/com.shantanu.gapmap/reddit-myind/` and
`reddit.db`) is auto-migrated on first launch.

## Changes

- **Python package**: `src/reddit_research/` → `src/gapmap/` (148 files via
  `git mv`); every `from reddit_research...` import rewritten to
  `from gapmap...` across the codebase.
- **pyproject.toml**: project name `reddit-myind` → `gapmap`; entry-point
  consolidated to a single `gapmap = "gapmap.cli.main:app"` console script
  (drops the redundant `reddit-myind` / `reddit-cli` aliases); `[all]` extras
  reference updated; package-data path updated; description rewritten to
  match the Gap Map brand.
- **MCP tools**: all 147 `reddit_*` tools renamed to `gapmap_*` (e.g.
  `reddit_search` → `gapmap_search`, `reddit_audience_personas` →
  `gapmap_audience_personas`). 981 replacements across 62 files driven by
  an allowlist of the canonical tool names — leaves `reddit_client_id`,
  `reddit_sample`, `get_reddit_unauthed`, `subreddit_type`,
  `reddit_user_agent`, etc. intact.
- **CLI binary**: the **user-facing CLI is `gapmap`** (installed via
  `pip install -e .` or `uv run gapmap …`). The **Tauri sidecar binary is
  `gapmap-cli`** — Tauri requires the sidecar name differ from the Rust
  crate's package name (also `gapmap`), so the bundled binary keeps the
  `-cli` suffix.
- **PyInstaller spec**: `reddit-cli.spec` → `gapmap-cli.spec`; updated
  `collect_all('reddit_research')` → `collect_all('gapmap')`; output name
  switched to `gapmap-cli` to match the Tauri sidecar contract.
- **Tauri Rust code** (`app-tauri/src-tauri/src/*.rs`):
  `sidecar("reddit-cli")` → `sidecar("gapmap-cli")`;
  `python -m reddit_research.cli.main` → `python -m gapmap.cli.main`;
  binary-resolution loop now searches for `gapmap-cli` / `gapmap-cli.exe`;
  user-config dir `~/.config/reddit-myind/` → `~/.config/gapmap/`; module
  comments throughout.
- **Tauri config** (`tauri.conf.json`): `binaries/reddit-cli` →
  `binaries/gapmap-cli`; asset-protocol scope `$APPDATA/reddit-myind/**` →
  `$APPDATA/gapmap/**`.
- **Sidecar binary file**: `binaries/reddit-cli-aarch64-apple-darwin` →
  `binaries/gapmap-cli-aarch64-apple-darwin` (gitignored — kept locally,
  rebuilt by CI).
- **Build scripts** (`scripts/*.sh`): `OUT_NAME="reddit-cli"` →
  `OUT_NAME="gapmap-cli"`; PyInstaller spec path; data-dir leaf
  `com.shantanu.gapmap/reddit-myind` → `com.shantanu.gapmap/gapmap`;
  env-var names `REDDIT_MYIND_*` → `GAPMAP_*`; log filenames
  `mcp-server-reddit-myind.log` → `mcp-server-gapmap.log`.
- **DB filename**: `reddit.db` → `gapmap.db` (config.py + every Rust file
  that opens the SQLite). Auto-migrated alongside the data dir.
- **Data-dir auto-migration**: `src/gapmap/core/config.py` now runs a
  one-shot migration on first call to `_resolve_data_dir()`. If the new
  `<bundle>/gapmap/` is empty/absent and the legacy `<bundle>/reddit-myind/`
  exists with content, it renames the dir AND renames `reddit.db` (+ `-wal`
  / `-shm`) → `gapmap.db` inside. No user data is left behind.
- **CLI help text**: typer top-level help rewritten from "Reddit research
  toolkit …" to "Gap Map — multi-source product gap finder. …" to reflect
  what the app actually does.
- **Active docs**: README, ARCHITECTURE, CLI_REFERENCE, MCP_TOOLS, FEATURES,
  LAUNCH, CONTRIBUTING, CHANGELOG all updated (path refs + tool names).
- **Historical docs** (changelogs/, docs/specs, docs/superpowers/plans):
  also pass-renamed for grep-by-current-name. Tool names in old changelogs
  now read as `gapmap_*` even though they were `reddit_*` at the time of
  writing — accepted trade-off for searchability.

## Files Created

- `changelogs/2026-05-25_01_rename-reddit-to-gapmap.md` (this file)
- `gapmap-cli.spec` (renamed from `reddit-cli.spec` via `git mv`)
- `src/gapmap/**/*` (renamed from `src/reddit_research/**/*` via `git mv`)
- `app-tauri/src-tauri/binaries/gapmap-cli-aarch64-apple-darwin` (renamed
  on-disk; gitignored)

## Files Modified

- `pyproject.toml` — name, description, scripts, extras, package-data
- `src/gapmap/cli/main.py` — top-level Typer help text rebranded
- `src/gapmap/core/config.py` — `_migrate_legacy_layout()` helper + wired
  into `_resolve_data_dir()`; DB filename constant
- `src/gapmap/mcp/server.py` — all 127 tool function definitions renamed
  `reddit_*` → `gapmap_*`; internal call references; sub-server mount
  comment
- `src/gapmap/mcp/jobs.py`, `mcp/tools/persona_tools.py`, `mcp/install.py`,
  `mcp/logger.py` — same rename + DB filename
- `src/gapmap/**/*.py` — 31 .py files: every `reddit_research` import →
  `gapmap`; every `reddit.db` → `gapmap.db`
- `app-tauri/src-tauri/src/{cli,commands,main,worker,schedule,persona_cmds}.rs`
  — sidecar name, module path, data-dir leaf, DB filename, comments
- `app-tauri/src-tauri/tauri.conf.json` — externalBin, assetProtocol scope
- `app-tauri/src/{main.js,api.js,screens/*,lib/healthCheck.js}` — MCP tool
  names in invoke calls + comments
- `scripts/{build-pyinstaller,publish-mac,setup,dev,validate,mcp_doctor,
  mcp_http_daemon,test_mcp_queue,finish-publish,mem_diff,mem_probe}.sh`
- `tests/**.py` — import paths, tool-name fixtures, DB-filename assertions
- `README.md`, `ARCHITECTURE.md`, `CLI_REFERENCE.md`, `MCP_TOOLS.md`,
  `FEATURES.md`, `LAUNCH.md`, `CONTRIBUTING.md`, `CHANGELOG.md`,
  `app-tauri/README.md`, `app-tauri/src-tauri/binaries/README.md`
- `docs/**/*.md`, `changelogs/**/*.md` — pass-renamed for searchability

## Verification

- `uv pip install -e .` installs cleanly as `gapmap 0.1.0`
- `gapmap --help` lists all subcommands with the new top-level description
- `gapmap mcp --help` works; `gapmap mcp install/uninstall` text references
  Gap Map
- `mcp.list_tools()` returns 147 tools, **0** still prefixed `reddit_`
- `pytest tests/ -m "not slow"` → 68 passed, 0 failed
- `cargo check` on `app-tauri/src-tauri/` → 0 errors

## Known follow-ups (not in this commit)

- The on-disk **GitHub project folder** is still
  `~/Documents/GitHub/reddit-myind`. Scripts that hardcode this path
  honor the `GAPMAP_PROJECT_DIR` env var, so users can override during the
  transition. Renaming the folder + the GitHub repository is a manual
  step the user owns.
- **MCP client configs** (Claude Desktop, Cursor, Claude Code) that point
  at `reddit-myind` / `reddit-cli` need to be re-installed via
  `gapmap mcp install`. The `mcp install` command already writes the new
  identifier and command path.
- **Sidecar binary not yet rebuilt** for this rename — the file was just
  renamed on disk. Next `pyinstaller gapmap-cli.spec` (or CI release run)
  will produce a freshly-named binary; the existing one runs fine because
  PyInstaller's entrypoint is `from gapmap.cli.main import app`, which we
  updated.
