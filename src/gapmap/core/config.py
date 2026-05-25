"""Config loading — env vars + .env files.

Single source of truth for `data_dir`: the Tauri app's platform-standard
app-data folder, regardless of CWD. This ensures the MCP server (spawned
by Claude Code / Cursor from *their* CWD), the CLI (spawned from
anywhere), and the desktop app all land on the SAME SQLite file + palace
store + exports folder.

Resolution order (first non-empty wins):
  1. GAPMAP_DATA_DIR env var (set by the Tauri sidecar)
  2. Platform app-data dir:
       macOS:   ~/Library/Application Support/com.shantanu.gapmap/gapmap
       Linux:   ~/.local/share/com.shantanu.gapmap/gapmap
                (or $XDG_DATA_HOME if set)
       Windows: %APPDATA%\\com.shantanu.gapmap\\gapmap
  3. ~/.config/gapmap/data (legacy fallback; old `reddit-myind` migrated on first run)
  4. CWD / "data" (dev-only, discouraged)

Prior behavior (`cwd/data`) caused MCP-created reports + DB state to land
in whatever folder the MCP client happened to be running from. The
desktop app would then render stale / empty views because its DB handle
pointed at the real app-data folder. Unifying at step 2 fixes it.
"""
from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

# Load .env from CWD, then user config dir. Existing env vars always win.
_USER_CONFIG_DIR = Path.home() / ".config" / "gapmap"
load_dotenv(Path.cwd() / ".env", override=False)
load_dotenv(_USER_CONFIG_DIR / ".env", override=False)


# Tauri bundle identifier — must match tauri.conf.json's `identifier`.
# Hardcoded here (not read from the Rust side) because the Python CLI
# may be invoked standalone (tests, MCP serve) without the Tauri context.
_TAURI_BUNDLE_ID = "com.shantanu.gapmap"
_APP_SUBDIR = "gapmap"
_LEGACY_APP_SUBDIR = "reddit-myind"
_LEGACY_DB_FILENAME = "reddit.db"
_DB_FILENAME = "gapmap.db"


def _migrate_legacy_layout(target: Path) -> None:
    """One-shot migration from the old `reddit-myind` layout.

    Renames `<bundle>/reddit-myind` → `<bundle>/gapmap` on disk, and
    renames `reddit.db*` → `gapmap.db*` inside. Runs only when:
      - target dir is empty / absent, AND
      - a sibling legacy dir exists and is non-empty
    """
    if target.exists() and any(target.iterdir()):
        return
    legacy = target.parent / _LEGACY_APP_SUBDIR
    if not (legacy.exists() and any(legacy.iterdir())):
        return
    try:
        if target.exists():
            target.rmdir()  # remove empty target so rename succeeds
        legacy.rename(target)
    except OSError:
        return
    # Rename SQLite + WAL/SHM siblings inside the migrated dir.
    for suffix in ("", "-wal", "-shm"):
        old = target / (_LEGACY_DB_FILENAME + suffix)
        if old.exists():
            try:
                old.rename(target / (_DB_FILENAME + suffix))
            except OSError:
                pass


def _canonical_app_data_dir() -> Path:
    """Platform-standard app-data folder for Gap Map.

    Mirrors what Tauri's `app.path().app_data_dir()` returns so the
    Python side agrees with the Rust side without needing IPC. If any
    step raises (odd filesystem, headless CI), falls back down the chain.
    """
    # macOS: ~/Library/Application Support/<bundle>/<app>
    if sys.platform == "darwin":
        return (Path.home() / "Library" / "Application Support"
                / _TAURI_BUNDLE_ID / _APP_SUBDIR)

    # Linux: $XDG_DATA_HOME/<bundle>/<app> or ~/.local/share/<bundle>/<app>
    if sys.platform.startswith("linux"):
        xdg = os.environ.get("XDG_DATA_HOME") or str(Path.home() / ".local" / "share")
        return Path(xdg) / _TAURI_BUNDLE_ID / _APP_SUBDIR

    # Windows: %APPDATA%\<bundle>\<app>
    if sys.platform.startswith("win"):
        appdata = os.environ.get("APPDATA") or str(Path.home() / "AppData" / "Roaming")
        return Path(appdata) / _TAURI_BUNDLE_ID / _APP_SUBDIR

    # Unknown platform — fall through to the legacy ~/.config location
    return _USER_CONFIG_DIR / "data"


def _resolve_data_dir() -> Path:
    """Single-source-of-truth resolver. Always returns an existing dir."""
    # 1. Explicit env override (Tauri sidecar sets this)
    env_override = os.getenv("GAPMAP_DATA_DIR")
    if env_override:
        p = Path(env_override).expanduser()
        p.mkdir(parents=True, exist_ok=True)
        return p

    # 2. Platform app-data folder (primary path — matches Tauri).
    # Run the one-shot legacy migration before mkdir so we don't strand
    # the user's old `reddit-myind` data dir + `reddit.db` next to a
    # freshly-created empty `gapmap` folder.
    app_dir = _canonical_app_data_dir()
    try:
        app_dir.parent.mkdir(parents=True, exist_ok=True)
        _migrate_legacy_layout(app_dir)
        app_dir.mkdir(parents=True, exist_ok=True)
        return app_dir
    except OSError:
        pass

    # 3. Legacy ~/.config/reddit-myind/data
    legacy = _USER_CONFIG_DIR / "data"
    try:
        legacy.mkdir(parents=True, exist_ok=True)
        return legacy
    except OSError:
        pass

    # 4. Absolute last resort — CWD. Loud warning so dev knows.
    fallback = Path.cwd() / "data"
    fallback.mkdir(parents=True, exist_ok=True)
    import warnings
    warnings.warn(
        f"Using CWD-local data dir {fallback} — all other locations failed. "
        "Set GAPMAP_DATA_DIR to pin to a canonical location.",
        stacklevel=2,
    )
    return fallback


@dataclass(frozen=True)
class Config:
    # Reddit auth — OAuth refresh-token flow (no password).
    reddit_client_id: str | None
    reddit_client_secret: str | None
    reddit_refresh_token: str | None
    reddit_user_agent: str
    reddit_redirect_uri: str

    # LLM keys (optional)
    anthropic_api_key: str | None
    openai_api_key: str | None
    ollama_base_url: str

    # Paths
    data_dir: Path

    @property
    def db_path(self) -> Path:
        return self.data_dir / "gapmap.db"

    @property
    def has_oauth(self) -> bool:
        return bool(
            self.reddit_client_id
            and self.reddit_client_secret
            and self.reddit_refresh_token
        )

    @property
    def mode(self) -> str:
        """'auth' (OAuth via PRAW) or 'public' (no-auth JSON endpoints).

        Forced via GAPMAP_MODE if set; otherwise auto-selected.
        """
        forced = os.getenv("GAPMAP_MODE", "").strip().lower()
        if forced in ("auth", "public"):
            return forced
        return "auth" if self.has_oauth else "public"

    def require_reddit(self) -> None:
        missing = [
            name
            for name, val in {
                "REDDIT_CLIENT_ID": self.reddit_client_id,
                "REDDIT_CLIENT_SECRET": self.reddit_client_secret,
                "REDDIT_REFRESH_TOKEN": self.reddit_refresh_token,
            }.items()
            if not val
        ]
        if missing:
            raise RuntimeError(
                "Missing Reddit credentials: "
                + ", ".join(missing)
                + "\nRun `gapmap auth login` to do OAuth setup."
            )


def load_config() -> Config:
    data_dir = _resolve_data_dir()
    return Config(
        reddit_client_id=os.getenv("REDDIT_CLIENT_ID") or None,
        reddit_client_secret=os.getenv("REDDIT_CLIENT_SECRET") or None,
        reddit_refresh_token=os.getenv("REDDIT_REFRESH_TOKEN") or None,
        reddit_user_agent=os.getenv("REDDIT_USER_AGENT") or "gapmap/0.1",
        reddit_redirect_uri=os.getenv("REDDIT_REDIRECT_URI") or "http://localhost:8080",
        anthropic_api_key=os.getenv("ANTHROPIC_API_KEY") or None,
        openai_api_key=os.getenv("OPENAI_API_KEY") or None,
        ollama_base_url=os.getenv("OLLAMA_BASE_URL") or "http://localhost:11434",
        data_dir=data_dir,
    )
