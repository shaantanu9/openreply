"""SQLite storage for X/Twitter accounts."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from ..core.db import get_db


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@dataclass
class XAccount:
    id: int
    handle: str
    auth_token: str
    ct0: str
    active: bool
    created_at: str
    updated_at: str

    def __post_init__(self) -> None:
        if isinstance(self.active, int):
            self.active = bool(self.active)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "handle": self.handle,
            "auth_token": self.auth_token[:4] + "***" if self.auth_token else "",
            "ct0": self.ct0[:4] + "***" if self.ct0 else "",
            "active": self.active,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }


def _ensure_table() -> None:
    db = get_db()
    db["x_accounts"].create(
        {
            "id": int,
            "handle": str,
            "auth_token": str,
            "ct0": str,
            "active": int,
            "created_at": str,
            "updated_at": str,
        },
        pk="id",
        not_null={"handle", "auth_token", "ct0"},
        if_not_exists=True,
    )
    db["x_accounts"].create_index(["handle"], unique=True, if_not_exists=True)


def add_account(handle: str, auth_token: str, ct0: str, active: bool = True) -> XAccount:
    _ensure_table()
    now = _utc_now()
    row = {
        "handle": handle.lstrip("@").lower(),
        "auth_token": auth_token,
        "ct0": ct0,
        "active": int(active),
        "created_at": now,
        "updated_at": now,
    }
    db = get_db()
    row["id"] = db["x_accounts"].insert(row).last_pk
    db.conn.commit()
    return XAccount(**row)


def list_accounts(active_only: bool = False) -> list[XAccount]:
    _ensure_table()
    db = get_db()
    where = "active = 1" if active_only else None
    rows = db["x_accounts"].rows_where(where=where, order_by="handle")
    return [XAccount(**row) for row in rows]


def get_account(handle: str) -> XAccount | None:
    _ensure_table()
    db = get_db()
    rows = list(db["x_accounts"].rows_where("handle = ?", [handle.lstrip("@").lower()], limit=1))
    if not rows:
        return None
    return XAccount(**rows[0])


def remove_account(handle: str) -> bool:
    _ensure_table()
    db = get_db()
    handle_clean = handle.lstrip("@").lower()
    existed = get_account(handle_clean) is not None
    db["x_accounts"].delete_where("handle = ?", [handle_clean])
    db.conn.commit()
    return existed
