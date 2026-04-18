"""Config loading — env vars + .env files (CWD and ~/.config/reddit-myind/)."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

# Load .env from CWD, then user config dir. Existing env vars always win.
_USER_CONFIG_DIR = Path.home() / ".config" / "reddit-myind"
load_dotenv(Path.cwd() / ".env", override=False)
load_dotenv(_USER_CONFIG_DIR / ".env", override=False)


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
        return self.data_dir / "reddit.db"

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
                + "\nRun `reddit-cli auth login` to do OAuth setup."
            )


def load_config() -> Config:
    data_dir = Path(os.getenv("REDDIT_MYIND_DATA_DIR") or (Path.cwd() / "data")).expanduser()
    data_dir.mkdir(parents=True, exist_ok=True)
    return Config(
        reddit_client_id=os.getenv("REDDIT_CLIENT_ID") or None,
        reddit_client_secret=os.getenv("REDDIT_CLIENT_SECRET") or None,
        reddit_refresh_token=os.getenv("REDDIT_REFRESH_TOKEN") or None,
        reddit_user_agent=os.getenv("REDDIT_USER_AGENT") or "reddit-myind/0.1",
        reddit_redirect_uri=os.getenv("REDDIT_REDIRECT_URI") or "http://localhost:8080",
        anthropic_api_key=os.getenv("ANTHROPIC_API_KEY") or None,
        openai_api_key=os.getenv("OPENAI_API_KEY") or None,
        ollama_base_url=os.getenv("OLLAMA_BASE_URL") or "http://localhost:11434",
        data_dir=data_dir,
    )
