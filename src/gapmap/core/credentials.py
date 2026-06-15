"""Per-source credential store (cookies / API keys).

Backs the in-app "Reach Connections" flow: a browser login → cookie capture →
store → verify → use cycle for sources that need an authenticated session
(reddit, xueqiu, xiaohongshu, linkedin, twitter, bilibili) or a free API key
(exa_search).

Design rules:
  - Reads NEVER raise — a missing table / locked DB / bad JSON yields None or {}.
  - Storage is the local gapmap SQLite DB (`source_credentials` table), same
    trust boundary as the rest of the app's local data. OS-keychain hardening
    is future scope.
  - `get_credential` returns {"source","cookies","username","kind",
    "last_verified_at"}; `cookie_header` renders the "k=v; k2=v2" header.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

from .db import get_db, init_schema


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def get_credential(source: str) -> dict | None:
    """Return the stored credential for *source*, or None. Never raises."""
    try:
        db = get_db()
        init_schema(db)
        row = db["source_credentials"].get(source)
    except Exception:
        return None
    if not row:
        return None
    try:
        cookies = json.loads(row.get("cookie_json") or "{}")
    except Exception:
        cookies = {}
    if not isinstance(cookies, dict):
        cookies = {}
    return {
        "source": source,
        "cookies": cookies,
        "username": row.get("username") or "",
        "kind": row.get("kind") or "cookie",
        "last_verified_at": row.get("last_verified_at"),
    }


def set_credential(
    source: str,
    cookies: dict,
    username: str = "",
    kind: str = "cookie",
    verified: bool = False,
) -> None:
    """Upsert the credential for *source*. `cookies` is a {name: value} map
    (for api keys, store {"api_key": "..."} and kind="api_key")."""
    db = get_db()
    init_schema(db)
    db["source_credentials"].upsert(
        {
            "source": source,
            "cookie_json": json.dumps(cookies or {}),
            "username": username or "",
            "kind": kind,
            "saved_at": _now(),
            "last_verified_at": _now() if verified else None,
        },
        pk="source",
    )


def mark_verified(source: str, username: str | None = None) -> None:
    """Stamp last_verified_at (and optionally username) without touching cookies."""
    try:
        db = get_db()
        init_schema(db)
        patch = {"last_verified_at": _now()}
        if username is not None:
            patch["username"] = username
        db["source_credentials"].update(source, patch)
    except Exception:
        pass


def delete_credential(source: str) -> None:
    """Remove the stored credential for *source*. Never raises."""
    try:
        db = get_db()
        init_schema(db)
        db["source_credentials"].delete(source)
    except Exception:
        pass


def has_credential(source: str) -> bool:
    return get_credential(source) is not None


def cookie_header(source: str) -> str:
    """Render the stored cookies as a 'k=v; k2=v2' Cookie header, or '' if none."""
    cred = get_credential(source)
    if not cred or not cred["cookies"]:
        return ""
    return "; ".join(f"{k}={v}" for k, v in cred["cookies"].items())


def api_key(source: str) -> str:
    """Return the stored API key for a key-gated source, or '' if none."""
    cred = get_credential(source)
    if not cred:
        return ""
    return str(cred["cookies"].get("api_key") or "")
