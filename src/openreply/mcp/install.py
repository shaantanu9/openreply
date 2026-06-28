"""MCP server install / uninstall / status — Claude Code config integration.

Spec: docs/superpowers/specs/2026-04-21-mcp-app-integration.md (v1).

Goals (v1):
  1. Same DB. Set OPENREPLY_DATA_DIR in the MCP entry's env so MCP tools
     write to the same SQLite + Palace ChromaDB the Tauri app reads.
  2. One-click. Tauri Settings calls install() / uninstall() / status() —
     all the JSON-merge + token-gen + atomic-write logic lives here.
  3. Future-proof. We write a token to `<data_dir>/mcp_token` and inject it
     into env so the MCP server can enforce later (v2). For v1 the server
     reads it but doesn't enforce.

Non-destructive contracts:
  - Atomic writes (tmp + os.replace), one-time backup `.openreply-bak` of the
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

DEFAULT_SERVER_NAME = "openreply"
TOKEN_FILE = "mcp_token"
BACKUP_SUFFIX = ".openreply-bak"


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

    Without this, `uv run openreply mcp serve` raises ModuleNotFoundError on
    `from fastmcp import FastMCP`, the server crashes on import, and Claude
    Code's `/mcp` panel hangs at "connecting…" forever waiting for a handshake
    that will never come.

    Returns {ok, ran, reason?} so the caller can surface failures cleanly
    without aborting install (best-effort: if uv is missing, we still wire
    the entry — user can `pip install -e '.[mcp]'` manually).
    """
    import shutil
    import subprocess

    sentinel = project_dir / ".venv" / ".openreply_mcp_extra_ready"
    if sentinel.exists():
        return {"ok": True, "ran": False, "reason": "mcp extra previously prepared"}

    # Fast-path: if the project's venv already imports fastmcp, skip the
    # expensive `uv pip install -e .[mcp]` call. This keeps connect/re-sync
    # near-instant instead of 30-90s on every click/app-open.
    venv_py = project_dir / ".venv" / "bin" / "python"
    if venv_py.exists():
        try:
            probe = subprocess.run(
                [str(venv_py), "-c", "import fastmcp"],
                cwd=str(project_dir),
                capture_output=True,
                text=True,
                timeout=10,
            )
            if probe.returncode == 0:
                try:
                    sentinel.parent.mkdir(parents=True, exist_ok=True)
                    sentinel.write_text("ok\n", encoding="utf-8")
                except OSError:
                    pass
                return {"ok": True, "ran": False, "reason": "mcp extra already installed"}
        except Exception:
            # Probe is best-effort. Fall through to `uv pip install`.
            pass

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
        try:
            sentinel.parent.mkdir(parents=True, exist_ok=True)
            sentinel.write_text("ok\n", encoding="utf-8")
        except OSError:
            pass
        return {"ok": True, "ran": True}
    except subprocess.TimeoutExpired:
        return {"ok": False, "ran": True, "reason": "uv pip install timed out after 120s"}
    except OSError as e:
        return {"ok": False, "ran": True, "reason": f"uv pip install errored: {e}"}


def _resolve_command(bin_path: Path | None, project_dir: Path | None) -> dict[str, Any]:
    """Decide what `command` + `args` Claude Code will spawn.

    Priority:
      1. Caller passed --bin (PyInstaller binary or `openreply` on PATH) →
         direct exec, no `uv` middleman. Used by the bundled app on prod.
      2. Caller passed --project-dir → `uv --directory <proj> run openreply mcp serve`.
         Used in dev where we want the venv-managed environment.
      3. Neither → default to current `sys.executable` + `-m openreply.cli.main mcp serve`.
         Last-resort path: works wherever this Python is installed.
    """
    if bin_path:
        return {
            "command": str(bin_path.expanduser().resolve()),
            "args":    ["mcp", "serve"],
        }
    if project_dir:
        proj = project_dir.expanduser().resolve()
        # PREFERRED: point directly at the project's `.venv/bin/openreply`
        # console-script. Boot time is ~50 ms (single Python interpreter
        # startup) vs 1-3 s for `uv run` (lockfile resolve + venv check on
        # every invocation) — and 5-10 s on a cold uv cache. Claude Desktop
        # / Cursor have ~10 s init timeouts; `uv run` on a slow disk
        # silently exhausts them and the client logs "lost connection".
        # The venv binary always exists once the dev has run `uv sync` /
        # `pip install -e .` in the project, which is a prerequisite anyway.
        venv_bin = proj / ".venv" / "bin" / "openreply"
        if venv_bin.is_file():
            return {
                "command": str(venv_bin),
                "args":    ["mcp", "serve"],
            }
        # Fallback: `uv run`. GUI MCP clients (Claude Desktop, Cursor)
        # inherit launchd's PATH — `/usr/bin:/bin:/usr/sbin:/sbin` plus
        # a few extras — NOT the user's zsh login PATH. A bare
        # `"command": "uv"` works from a shell-launched CLI but ENOENTs
        # in GUI clients, so resolve to absolute path at install time.
        uv_path = shutil.which("uv") or "uv"
        # --all-extras is mandatory: plain `uv run` syncs to base deps only
        # and PRUNES `fastmcp` (declared in [project.optional-dependencies].mcp),
        # which crashes the server on import. See skill: tauri-python-sidecar-app
        # gotcha "MCP server keeps disconnecting". Battle-tested on OpenReply 2026-05-18.
        return {
            "command": uv_path,
            "args":    ["--directory", str(proj), "run", "--all-extras",
                        "openreply", "mcp", "serve"],
        }
    return {
        "command": sys.executable,
        "args":    ["-m", "openreply.cli.main", "mcp", "serve"],
    }


# ── liveness probe ──────────────────────────────────────────────────────────

# How long to wait for a real `initialize` handshake before declaring the
# server unreachable. Generous because the PyInstaller-bundled sidecar
# cold-starts can take 30-50s (onefile archive extraction) on a busy/cold disk.
DEFAULT_PROBE_TIMEOUT = 60.0


def probe_server_handshake(
    command: str,
    args: list[str],
    env: dict[str, str] | None = None,
    *,
    timeout: float = DEFAULT_PROBE_TIMEOUT,
) -> dict[str, Any]:
    """Spawn the configured MCP command and perform a real stdio `initialize`
    handshake. Returns ``{live: bool, handshake_ms: int|None, error: str|None}``.

    This is the ONLY honest test that the entry actually works — config
    introspection (does the entry exist, does the data dir match) cannot detect
    a binary that hangs on startup, which is exactly the failure mode where the
    app shows "Connected" but the MCP client reports "failed to connect". Best
    effort: never raises; always reaps the child process.
    """
    import json as _json
    import subprocess
    import threading
    import time

    merged = dict(os.environ)
    if env:
        merged.update({k: str(v) for k, v in env.items()})

    init_req = (
        _json.dumps(
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": {"name": "openreply-statusprobe", "version": "1"},
                },
            }
        )
        + "\n"
    ).encode("utf-8")

    started = time.monotonic()
    proc: subprocess.Popen | None = None
    result: dict[str, Any] = {"live": False, "handshake_ms": None, "error": None}
    try:
        proc = subprocess.Popen(
            [command, *args],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            env=merged,
            bufsize=0,
        )
    except (OSError, ValueError) as e:
        result["error"] = f"spawn failed: {e}"
        return result

    found = threading.Event()

    def _reader() -> None:
        try:
            assert proc is not None and proc.stdout is not None
            for raw in proc.stdout:
                line = raw.strip()
                if not line:
                    continue
                try:
                    msg = _json.loads(line)
                except (ValueError, TypeError):
                    continue  # banner / log noise — keep reading
                if isinstance(msg, dict) and msg.get("id") == 1 and "result" in msg:
                    found.set()
                    return
        except Exception:
            return

    reader = threading.Thread(target=_reader, name="mcp-probe-reader", daemon=True)
    reader.start()
    try:
        if proc.stdin is not None:
            proc.stdin.write(init_req)
            proc.stdin.flush()
    except (OSError, ValueError) as e:
        result["error"] = f"write failed: {e}"

    if found.wait(timeout=timeout):
        result["live"] = True
        result["handshake_ms"] = int((time.monotonic() - started) * 1000)
    elif result["error"] is None:
        result["error"] = f"no initialize response within {int(timeout)}s"

    # Always reap the child — terminate, then hard-kill if it ignores us.
    try:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc.kill()
    except Exception:
        pass
    return result


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
    probe: bool = False,
    probe_timeout: float = DEFAULT_PROBE_TIMEOUT,
) -> dict[str, Any]:
    """Report the current state of the MCP entry.

    By default this is pure config introspection (fast, no subprocess). Pass
    ``probe=True`` to additionally spawn the configured command and perform a
    real `initialize` handshake — the only way to detect an entry that is
    written correctly but whose binary hangs on startup (the "app says
    Connected, client says failed-to-connect" case).

    Returns:
        installed:    bool — Claude config has an entry under `server_name`
        connected:    bool — entry exists AND, when probe=True, handshake passed
        live:         bool | None — handshake succeeded (None when probe=False)
        handshake_ms: int | None — round-trip time of a successful handshake
        probe_error:  str | None — why the handshake failed, if it did
        db_aligned:   bool — entry's OPENREPLY_DATA_DIR matches the requested data_dir
        has_token:    bool — token file exists in the data_dir
        token_in_env: bool — entry's OPENREPLY_TOKEN matches the token file
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
        "live": None,
        "handshake_ms": None,
        "probe_error": None,
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
        out["reason"] = f"Not connected. Click Connect to register OpenReply with {out['client']}."
        return out

    out["installed"] = True
    out["connected"] = True
    env = entry.get("env") or {}
    out["entry_data_dir"] = env.get("OPENREPLY_DATA_DIR")
    out["db_aligned"] = (out["entry_data_dir"] == str(dd))
    out["token_in_env"] = bool(token and env.get("OPENREPLY_TOKEN") == token)
    # Stale-lock takeover flag presence — entries written before 2026-04-24
    # lack this and will fail with `another_mcp_server_running` when the
    # MCP client restarts while a prior zombie instance holds the pid
    # lock. We treat absence as a re-sync trigger so older installs
    # self-heal on next status check.
    out["takeover_configured"] = (
        str(env.get("MCP_TAKEOVER_STALE_LOCK") or "").strip().lower()
        in ("1", "true", "yes", "on")
    )
    # Per-client pidfile tag — entries written before 2026-04-27 lack
    # this and share one lock file with every other client, causing the
    # cross-client SIGTERM thrash that surfaces as "lost connection"
    # mid-tool-call. We treat absence as a re-sync trigger.
    expected_tag = (client or "claude-code").strip().lower()
    out["client_tag_configured"] = (
        (env.get("MCP_CLIENT_TAG") or "").strip().lower() == expected_tag
    )
    # Entries written before 2026-05-26 lack the explicit `timeout` field and
    # inherit Claude Code's 12s default. Bundled-sidecar cold-starts on macOS
    # 26.5+ regularly exceed 12s on first launch; the client gives up with
    # "MCP timeout after 12000ms" before initialize lands. Re-syncing writes
    # `timeout: 60000` so this never bites again.
    out["timeout_configured"] = int(entry.get("timeout") or 0) >= 30000
    # Entries written before 2026-05-29 don't pin OPENREPLY_IDLE_TIMEOUT=0, so
    # server.py's idle watcher self-exits (os._exit) after 30 min idle and the
    # client marks the server permanently disconnected ("MCP keeps
    # disconnecting"). Treat a non-"0" / missing value as a re-sync trigger so
    # older installs self-heal.
    out["idle_disabled"] = (
        str(env.get("OPENREPLY_IDLE_TIMEOUT") or "").strip() == "0"
    )

    # Optional liveness probe — the only check that catches a correctly-written
    # entry whose binary hangs on startup (e.g. the PyInstaller onefile sidecar
    # blocking on _MEI extraction when the disk is full). Without this, the app
    # reports "Connected" purely because the config entry exists, while the MCP
    # client reports "failed to connect".
    if probe:
        pr = probe_server_handshake(
            entry.get("command") or "",
            list(entry.get("args") or []),
            {str(k): str(v) for k, v in (env or {}).items()},
            timeout=probe_timeout,
        )
        out["live"] = bool(pr.get("live"))
        out["handshake_ms"] = pr.get("handshake_ms")
        out["probe_error"] = pr.get("error")
        # Truthful UI: "connected" only stays True if the server actually
        # answered. A configured-but-dead entry is NOT connected.
        out["connected"] = out["live"]

    if probe and not out["live"]:
        out["reason"] = (
            f"Entry is registered with {out['client']}, but the server did not "
            f"respond to an MCP handshake ({out.get('probe_error') or 'no response'}). "
            "The configured command is hanging or failing on startup — it will "
            "show as 'failed to connect' in the client."
        )
    elif not out["db_aligned"]:
        out["reason"] = f"Connected, but {out['client']} is reading a different DB. Click Re-sync to align."
    elif not out["token_in_env"]:
        out["reason"] = "Connected, but token mismatch. Re-sync to refresh."
    elif not out["takeover_configured"]:
        out["reason"] = (
            "Connected, but this entry predates stale-lock auto-recovery. "
            "Re-sync to avoid `another_mcp_server_running` errors on client restart."
        )
    elif not out["timeout_configured"]:
        out["reason"] = (
            "Connected, but this entry uses the 12s default timeout. Re-sync "
            "so cold-starts on macOS Tahoe don't trip 'MCP timeout after 12000ms'."
        )
    elif not out["client_tag_configured"]:
        out["reason"] = (
            "Connected, but this entry predates per-client pidfile scoping. "
            "Re-sync so this client stops fighting other MCP clients for "
            "the same lock (cause of mid-tool-call disconnects)."
        )
    elif not out["idle_disabled"]:
        out["reason"] = (
            "Connected, but this entry's idle-timeout watcher can self-exit "
            "after 30 min idle, which the client reads as a permanent "
            "disconnect. Re-sync to pin OPENREPLY_IDLE_TIMEOUT=0."
        )
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
    """Connect (or re-sync) OpenReply's MCP entry in `~/.claude.json`.

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

    # Dev mode: ensure the [mcp] extra is installed so `uv run openreply mcp
    # serve` doesn't crash on `from fastmcp import FastMCP`. Without this the
    # MCP server exits on import and the client hangs at "connecting…".
    extra_status: dict[str, Any] = {"ok": True, "ran": False}
    if project_dir and not bin_path:
        extra_status = _ensure_mcp_extra_in_project(project_dir.expanduser().resolve())

    cmd = _resolve_command(bin_path, project_dir)
    client_tag = (client or "claude-code").strip().lower()
    entry = {
        **cmd,
        # Claude Code / Cursor / Claude Desktop default to a 12s timeout on
        # the MCP `initialize` handshake. Our PyInstaller-bundled sidecar
        # cold-starts in 30-60s the first time after install (macOS
        # Gatekeeper verifies every .so on first launch). Without this
        # field the client gives up before initialize lands, and the user
        # sees "MCP timeout after 12000ms" with no recovery. Setting 60s
        # buys enough room for first-launch + leaves headroom for slow
        # disks. Subsequent launches use the Gatekeeper cache and respond
        # in ~3-5s, well under either threshold.
        "timeout": 60000,
        "env": {
            "OPENREPLY_DATA_DIR": str(dd),
            "OPENREPLY_TOKEN": token,
            # MCP client restarts frequently leave a zombie `mcp serve`
            # attached to a dead stdin pipe. Without takeover, the next
            # spawn fails with `another_mcp_server_running` until the
            # user manually deletes the pid file. Setting this flag in
            # the entry means every client-spawned instance can reclaim
            # the stale lock on startup — ~3s SIGTERM grace, then SIGKILL.
            "MCP_TAKEOVER_STALE_LOCK": "1",
            # Per-client pidfile. Without this, Claude Code / Claude
            # Desktop / Cursor all share `mcp-server.pid` and the
            # takeover flag above causes them to SIGTERM each other
            # every reconnect — the user sees "lost connection" mid-
            # tool-call. With it, each client gets
            # `mcp-server.<tag>.pid` and they coexist quietly. See
            # _pidfile_path() in server.py.
            "MCP_CLIENT_TAG": client_tag,
            # Disable the idle-timeout watcher for client-managed entries.
            # server.py's watcher calls os._exit(0) after OPENREPLY_IDLE_TIMEOUT
            # seconds (default 1800 = 30 min) of no tool calls. But when a
            # stdio MCP server self-exits, the CLIENT (Claude Code / Cursor /
            # Claude Desktop) marks it disconnected and does NOT auto-respawn
            # — it thinks the server finished its job. The user perceives this
            # as "MCP keeps disconnecting" and has to restart the client to
            # get tools back. The client already owns this subprocess's
            # lifecycle (spawns on launch, kills on quit), so the idle guard
            # is redundant AND harmful here. "0" disables it.
            "OPENREPLY_IDLE_TIMEOUT": "0",
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


def config_snippet(
    *,
    client: str | None = None,
    data_dir: Path | None = None,
    bin_path: Path | None = None,
    project_dir: Path | None = None,
    server_name: str = DEFAULT_SERVER_NAME,
    config_path: Path | None = None,
) -> dict[str, Any]:
    """Dry-run of :func:`install`: build the EXACT ``mcpServers`` entry that
    install() would write, WITHOUT touching any file or creating a token.

    Powers the Settings "Copy config" button so users can paste the entry
    into a client we don't auto-write (or add it by hand). The entry is
    byte-for-byte what Connect would write, including the hardening fields
    (``timeout``, ``MCP_TAKEOVER_STALE_LOCK``, ``MCP_CLIENT_TAG``,
    ``OPENREPLY_IDLE_TIMEOUT``) that prevent the cold-start / idle / lock churn.
    """
    cfg_path = _resolve_config(config_path, client)
    dd = (data_dir or default_data_dir()).expanduser()
    # Read an existing token but DON'T mint one on a pure preview.
    token = _read_token(dd)
    cmd = _resolve_command(bin_path, project_dir)
    client_tag = (client or "claude-code").strip().lower()
    env: dict[str, str] = {"OPENREPLY_DATA_DIR": str(dd)}
    if token:
        env["OPENREPLY_TOKEN"] = token
    env["MCP_TAKEOVER_STALE_LOCK"] = "1"
    env["MCP_CLIENT_TAG"] = client_tag
    env["OPENREPLY_IDLE_TIMEOUT"] = "0"
    entry = {**cmd, "timeout": 60000, "env": env}
    return {
        "ok": True,
        "client": client_tag,
        "config_path": str(cfg_path),
        "server_name": server_name,
        "has_token": bool(token),
        "entry": entry,
        # Ready-to-paste wrapper — drop this into the client's config file.
        "snippet": {"mcpServers": {server_name: entry}},
    }


def uninstall(
    *,
    config_path: Path | None = None,
    client: str | None = None,
    data_dir: Path | None = None,
    server_name: str = DEFAULT_SERVER_NAME,
    delete_token: bool = True,
) -> dict[str, Any]:
    """Remove OpenReply's MCP entry. Leaves other entries untouched.

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
            else "Nothing to remove — OpenReply wasn't connected."
        ),
    }
