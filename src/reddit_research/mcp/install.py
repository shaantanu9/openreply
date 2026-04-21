"""MCP server install / uninstall / status — Claude Code config integration.

Spec: docs/superpowers/specs/2026-04-21-mcp-app-integration.md (v1).

Goals (v1):
  1. Same DB. Set REDDIT_MYIND_DATA_DIR in the MCP entry's env so MCP tools
     write to the same SQLite + Palace ChromaDB the Tauri app reads.
  2. One-click. Tauri Settings calls install() / uninstall() / status() —
     all the JSON-merge + token-gen + atomic-write logic lives here.
  3. Future-proof. We write a token to `<data_dir>/mcp_token` and inject it
     into env so the MCP server can enforce later (v2). For v1 the server
     reads it but doesn't enforce.

Non-destructive contracts:
  - Atomic writes (tmp + os.replace), one-time backup `.gapmap-bak` of the
    original config the first time we touch it.
  - Only mutate `mcpServers.<name>` — never delete keys we didn't add.
  - install() is idempotent. Re-running updates command/args/env without
    rotating the token unless force=True.
"""
from __future__ import annotations

import json
import os
import secrets
import shutil
import sys
from pathlib import Path
from typing import Any

DEFAULT_SERVER_NAME = "reddit-myind"
TOKEN_FILE = "mcp_token"
BACKUP_SUFFIX = ".gapmap-bak"


# ── known MCP clients (all use the same `mcpServers` JSON shape) ──────────────
#
# Same install/uninstall/status flow works for every client below — only the
# config path differs. Caller passes --client X (or the UI's dropdown) and we
# merge into the right file. Anyone with the app installed can wire it into
# any of these without copy-paste config gymnastics.
def _home() -> Path:
    return Path.home()


def known_clients() -> dict[str, dict[str, Any]]:
    """Return per-client config paths + display labels.

    Path is resolved at call time, not import time — keeps tests deterministic
    when monkeypatching HOME.
    """
    h = _home()
    return {
        "claude-code": {
            "label": "Claude Code (CLI / IDE extension)",
            "path":  h / ".claude.json",
        },
        "claude-desktop": {
            "label": "Claude Desktop (mac)",
            "path":  h / "Library" / "Application Support" / "Claude" / "claude_desktop_config.json",
        },
        "cursor": {
            "label": "Cursor",
            "path":  h / ".cursor" / "mcp.json",
        },
        "windsurf": {
            "label": "Windsurf",
            "path":  h / ".codeium" / "windsurf" / "mcp_config.json",
        },
        "cline": {
            "label": "Cline (VSCode)",
            "path":  h / "Library" / "Application Support" / "Code" / "User"
                       / "globalStorage" / "saoudrizwan.claude-dev" / "settings"
                       / "cline_mcp_settings.json",
        },
    }


def resolve_client(client: str | None) -> Path:
    """Map a client key to its config path. Defaults to claude-code."""
    if client is None or client == "":
        return known_clients()["claude-code"]["path"]
    clients = known_clients()
    if client not in clients:
        raise ValueError(f"unknown client {client!r}. options: {sorted(clients)}")
    return clients[client]["path"]


def list_clients() -> list[dict[str, Any]]:
    """For each known client: key, label, path, present (does the file exist)."""
    out = []
    for key, info in known_clients().items():
        out.append({
            "key": key,
            "label": info["label"],
            "path": str(info["path"]),
            "present": info["path"].exists(),
        })
    return out


# ── path helpers ──────────────────────────────────────────────────────────────

def default_claude_config_path() -> Path:
    """`~/.claude.json` on macOS/Linux; `%USERPROFILE%\\.claude.json` on Win."""
    return Path.home() / ".claude.json"


def default_data_dir() -> Path:
    """Delegates to core.config._resolve_data_dir — the single source of
    truth. Ensures MCP-install writes the token file AND the MCP server
    reads its state from the SAME directory as the desktop app, no matter
    where the installer was invoked from."""
    from ..core.config import _resolve_data_dir
    return _resolve_data_dir()


def _read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    raw = path.read_text(encoding="utf-8").strip()
    if not raw:
        return {}
    return json.loads(raw)


def _atomic_write_json(path: Path, data: dict[str, Any]) -> None:
    """Write JSON via tmp file + replace so partial writes can never corrupt
    the user's Claude Code config."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def _backup_once(path: Path) -> None:
    bak = path.with_suffix(path.suffix + BACKUP_SUFFIX)
    if path.exists() and not bak.exists():
        try:
            shutil.copy2(path, bak)
        except OSError:
            # Backup is best-effort; don't block install if FS denies it.
            pass


# ── token ─────────────────────────────────────────────────────────────────────

def _read_token(data_dir: Path) -> str | None:
    f = data_dir / TOKEN_FILE
    if not f.exists():
        return None
    try:
        t = f.read_text(encoding="utf-8").strip()
        return t or None
    except OSError:
        return None


def _write_token(data_dir: Path) -> str:
    data_dir.mkdir(parents=True, exist_ok=True)
    token = secrets.token_urlsafe(32)
    f = data_dir / TOKEN_FILE
    f.write_text(token + "\n", encoding="utf-8")
    try:
        os.chmod(f, 0o600)
    except OSError:
        # Windows / restricted FS — skip silently.
        pass
    return token


def _delete_token(data_dir: Path) -> None:
    f = data_dir / TOKEN_FILE
    try:
        f.unlink()
    except FileNotFoundError:
        pass
    except OSError:
        pass


# ── command resolution ────────────────────────────────────────────────────────

def _ensure_mcp_extra_in_project(project_dir: Path) -> dict[str, Any]:
    """In dev mode, make sure the project venv has the `[mcp]` extra.

    Without this, `uv run reddit-cli mcp serve` raises ModuleNotFoundError on
    `from fastmcp import FastMCP`, the server crashes on import, and Claude
    Code's `/mcp` panel hangs at "connecting…" forever waiting for a handshake
    that will never come.

    Returns {ok, ran, reason?} so the caller can surface failures cleanly
    without aborting install (best-effort: if uv is missing, we still wire
    the entry — user can `pip install -e '.[mcp]'` manually).
    """
    import shutil
    import subprocess

    if shutil.which("uv") is None:
        return {"ok": True, "ran": False, "reason": "uv not on PATH; skipped extras install"}
    try:
        # `uv pip install -e .[mcp]` is idempotent and fast when fastmcp is
        # already present (resolves in <1s). Quiet mode keeps install logs
        # out of the JSON response.
        proc = subprocess.run(
            ["uv", "pip", "install", "-q", "-e", ".[mcp]"],
            cwd=str(project_dir),
            capture_output=True,
            text=True,
            timeout=120,
        )
        if proc.returncode != 0:
            return {"ok": False, "ran": True, "reason": f"uv pip install failed: {proc.stderr.strip()[:300]}"}
        return {"ok": True, "ran": True}
    except subprocess.TimeoutExpired:
        return {"ok": False, "ran": True, "reason": "uv pip install timed out after 120s"}
    except OSError as e:
        return {"ok": False, "ran": True, "reason": f"uv pip install errored: {e}"}


def _resolve_command(bin_path: Path | None, project_dir: Path | None) -> dict[str, Any]:
    """Decide what `command` + `args` Claude Code will spawn.

    Priority:
      1. Caller passed --bin (PyInstaller binary or `reddit-cli` on PATH) →
         direct exec, no `uv` middleman. Used by the bundled app on prod.
      2. Caller passed --project-dir → `uv --directory <proj> run reddit-cli mcp serve`.
         Used in dev where we want the venv-managed environment.
      3. Neither → default to current `sys.executable` + `-m reddit_research.cli.main mcp serve`.
         Last-resort path: works wherever this Python is installed.
    """
    if bin_path:
        return {
            "command": str(bin_path.expanduser().resolve()),
            "args":    ["mcp", "serve"],
        }
    if project_dir:
        proj = project_dir.expanduser().resolve()
        return {
            "command": "uv",
            "args":    ["--directory", str(proj), "run", "reddit-cli", "mcp", "serve"],
        }
    return {
        "command": sys.executable,
        "args":    ["-m", "reddit_research.cli.main", "mcp", "serve"],
    }


# ── public API ────────────────────────────────────────────────────────────────

def _resolve_config(config_path: Path | None, client: str | None) -> Path:
    if config_path is not None:
        return config_path.expanduser()
    if client:
        return resolve_client(client).expanduser()
    return default_claude_config_path()


def status(
    *,
    config_path: Path | None = None,
    client: str | None = None,
    data_dir: Path | None = None,
    server_name: str = DEFAULT_SERVER_NAME,
) -> dict[str, Any]:
    """Report the current state of the MCP entry.

    Returns:
        installed:    bool — Claude config has an entry under `server_name`
        connected:    bool — same as installed (synonym for the UI)
        db_aligned:   bool — entry's REDDIT_MYIND_DATA_DIR matches the requested data_dir
        has_token:    bool — token file exists in the data_dir
        token_in_env: bool — entry's REDDIT_MYIND_TOKEN matches the token file
        config_path:  str  — resolved Claude config path
        data_dir:     str  — resolved data dir
        entry_data_dir: str | None — data dir the entry currently points at
        claude_present: bool — config file exists on disk
        reason: str | None — short human explanation when something's off
    """
    cfg_path = _resolve_config(config_path, client)
    dd = (data_dir or default_data_dir()).expanduser()

    out: dict[str, Any] = {
        "installed": False,
        "connected": False,
        "db_aligned": False,
        "has_token": False,
        "token_in_env": False,
        "config_path": str(cfg_path),
        "data_dir": str(dd),
        "entry_data_dir": None,
        "claude_present": cfg_path.exists(),  # legacy field name; means "client config exists"
        "client_present": cfg_path.exists(),  # canonical multi-client name
        "client": client or "claude-code",
        "server_name": server_name,
        "reason": None,
    }

    if not cfg_path.exists():
        out["reason"] = (
            f"Config for {out['client']} not found at {cfg_path}. "
            "Install the client first, then come back."
        )
        return out

    try:
        cfg = _read_json(cfg_path)
    except json.JSONDecodeError as e:
        out["reason"] = f"Claude config is not valid JSON ({e})."
        return out

    entry = (cfg.get("mcpServers") or {}).get(server_name)
    token = _read_token(dd)
    out["has_token"] = bool(token)

    if not entry:
        out["reason"] = f"Not connected. Click Connect to register Gap Map with {out['client']}."
        return out

    out["installed"] = True
    out["connected"] = True
    env = entry.get("env") or {}
    out["entry_data_dir"] = env.get("REDDIT_MYIND_DATA_DIR")
    out["db_aligned"] = (out["entry_data_dir"] == str(dd))
    out["token_in_env"] = bool(token and env.get("REDDIT_MYIND_TOKEN") == token)

    if not out["db_aligned"]:
        out["reason"] = f"Connected, but {out['client']} is reading a different DB. Click Re-sync to align."
    elif not out["token_in_env"]:
        out["reason"] = "Connected, but token mismatch. Re-sync to refresh."
    return out


def install(
    *,
    config_path: Path | None = None,
    client: str | None = None,
    data_dir: Path | None = None,
    bin_path: Path | None = None,
    project_dir: Path | None = None,
    server_name: str = DEFAULT_SERVER_NAME,
    rotate_token: bool = False,
) -> dict[str, Any]:
    """Connect (or re-sync) Gap Map's MCP entry in `~/.claude.json`.

    - Generates a token on first install (and only then unless rotate_token).
    - Atomic-writes the merged config and creates a one-time backup.
    - Idempotent: safe to call repeatedly to re-sync paths after the app moves.
    """
    cfg_path = _resolve_config(config_path, client)
    dd = (data_dir or default_data_dir()).expanduser()
    dd.mkdir(parents=True, exist_ok=True)
    cfg_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        cfg = _read_json(cfg_path)
    except json.JSONDecodeError as e:
        return {"ok": False, "reason": f"Client config is not valid JSON ({e})."}

    token = _read_token(dd)
    if token is None or rotate_token:
        token = _write_token(dd)

    # Dev mode: ensure the [mcp] extra is installed so `uv run reddit-cli mcp
    # serve` doesn't crash on `from fastmcp import FastMCP`. Without this the
    # MCP server exits on import and the client hangs at "connecting…".
    extra_status: dict[str, Any] = {"ok": True, "ran": False}
    if project_dir and not bin_path:
        extra_status = _ensure_mcp_extra_in_project(project_dir.expanduser().resolve())

    cmd = _resolve_command(bin_path, project_dir)
    entry = {
        **cmd,
        "env": {
            "REDDIT_MYIND_DATA_DIR": str(dd),
            "REDDIT_MYIND_TOKEN": token,
        },
    }

    _backup_once(cfg_path)
    servers = cfg.setdefault("mcpServers", {})
    servers[server_name] = entry
    _atomic_write_json(cfg_path, cfg)

    return {
        "ok": True,
        "config_path": str(cfg_path),
        "data_dir": str(dd),
        "client": client or "claude-code",
        "server_name": server_name,
        "entry": entry,
        "rotated": rotate_token,
        "extra_install": extra_status,
        "message": f"Connected. Restart {client or 'Claude Code'} to pick up changes.",
    }


def uninstall(
    *,
    config_path: Path | None = None,
    client: str | None = None,
    data_dir: Path | None = None,
    server_name: str = DEFAULT_SERVER_NAME,
    delete_token: bool = True,
) -> dict[str, Any]:
    """Remove Gap Map's MCP entry. Leaves other entries untouched.

    delete_token=False keeps the token file so re-installing later from the
    same data_dir doesn't break Claude sessions that cached the old token.
    """
    cfg_path = _resolve_config(config_path, client)
    dd = (data_dir or default_data_dir()).expanduser()

    if not cfg_path.exists():
        return {"ok": True, "removed": False, "reason": "No client config to update."}

    try:
        cfg = _read_json(cfg_path)
    except json.JSONDecodeError as e:
        return {"ok": False, "reason": f"Client config is not valid JSON ({e})."}

    servers = cfg.get("mcpServers") or {}
    removed = server_name in servers
    if removed:
        del servers[server_name]
        if not servers:
            cfg.pop("mcpServers", None)
        _atomic_write_json(cfg_path, cfg)

    if delete_token:
        _delete_token(dd)

    return {
        "ok": True,
        "removed": removed,
        "config_path": str(cfg_path),
        "message": (
            "Disconnected. Restart Claude Code so it forgets the entry."
            if removed
            else "Nothing to remove — Gap Map wasn't connected."
        ),
    }
