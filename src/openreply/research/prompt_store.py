"""Prompt override store (T3.7).

Layers user-editable overrides on top of the bundled ``prompts/*.yaml``
set. A prompt "key" is the bare name of an extractor or template
(e.g. ``painpoints``, ``insights_synthesis``, ``queries``).

Storage lives in the ``prompt_overrides`` table already created by
``core.db.init_schema``:

    key TEXT PRIMARY KEY
    override_text TEXT
    updated_at TEXT

Callers pass a ``default_loader`` callable so the exact bundled
representation (YAML dict, rendered string, whatever the call site
wants) is computed only if no override exists. This keeps the store
format-agnostic.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Callable

from ..core.db import get_db


_TABLE = "prompt_overrides"


def _utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _get_override_text(key: str) -> str | None:
    """Return the override text for ``key`` or None if unset."""
    db = get_db()
    if _TABLE not in db.table_names():
        return None
    try:
        row = db[_TABLE].get(key)
    except Exception:
        return None
    if not row:
        return None
    txt = row.get("override_text")
    if not txt or not str(txt).strip():
        return None
    return str(txt)


def get_prompt(key: str, default_loader: Callable[[], Any]) -> Any:
    """Return override_text for ``key`` if present, else ``default_loader()``.

    The return type is whatever ``default_loader`` returns — the store
    just short-circuits with the override string when one exists.
    """
    override = _get_override_text(key)
    if override is not None:
        return override
    return default_loader()


def set_prompt(key: str, text: str) -> dict[str, Any]:
    """Upsert an override. Empty/whitespace text clears the override."""
    db = get_db()
    key = (key or "").strip()
    if not key:
        raise ValueError("prompt key required")
    now = _utc_now()
    if text is None or not str(text).strip():
        # Empty = unset
        try:
            db[_TABLE].delete(key)
        except Exception:
            pass
        return {"ok": True, "key": key, "cleared": True, "updated_at": now}
    db[_TABLE].upsert(
        {"key": key, "override_text": str(text), "updated_at": now},
        pk="key",
    )
    return {"ok": True, "key": key, "cleared": False, "updated_at": now}


def clear_prompt(key: str) -> dict[str, Any]:
    """Remove the override for ``key`` (idempotent)."""
    db = get_db()
    key = (key or "").strip()
    if not key:
        raise ValueError("prompt key required")
    try:
        db[_TABLE].delete(key)
    except Exception:
        pass
    return {"ok": True, "key": key, "cleared": True}


def _bundled_text(key: str) -> str:
    """Best-effort load of the bundled YAML as raw text (for preview)."""
    try:
        from .prompts import prompts_dir
        p = prompts_dir() / f"{key}.yaml"
        if p.exists():
            return p.read_text(encoding="utf-8")
    except Exception:
        pass
    return ""


def _known_keys() -> list[str]:
    """Enumerate prompt keys from the bundled prompts directory."""
    try:
        from .prompts import prompts_dir
        pdir = prompts_dir()
        if pdir.is_dir():
            return sorted(p.stem for p in pdir.glob("*.yaml"))
    except Exception:
        pass
    return []


def _preview(text: str, n: int = 240) -> str:
    s = (text or "").strip()
    if len(s) <= n:
        return s
    return s[:n].rstrip() + "…"


def list_prompts() -> dict[str, dict[str, Any]]:
    """Map of ``key → {has_override, bundled_preview, override_preview,
    updated_at, override_text, bundled_text}``.

    Includes every bundled key plus any orphan override whose key no
    longer has a bundled counterpart.
    """
    db = get_db()
    overrides: dict[str, dict[str, Any]] = {}
    if _TABLE in db.table_names():
        try:
            for row in db[_TABLE].rows:
                k = row.get("key")
                if k:
                    overrides[str(k)] = {
                        "override_text": row.get("override_text") or "",
                        "updated_at": row.get("updated_at") or "",
                    }
        except Exception:
            pass
    keys = set(_known_keys()) | set(overrides.keys())
    out: dict[str, dict[str, Any]] = {}
    for k in sorted(keys):
        bundled = _bundled_text(k)
        ov = overrides.get(k)
        has = bool(ov and str(ov.get("override_text", "")).strip())
        out[k] = {
            "has_override": has,
            "bundled_preview": _preview(bundled),
            "override_preview": _preview(ov["override_text"]) if has else "",
            "updated_at": ov["updated_at"] if ov else "",
            "bundled_text": bundled,
            "override_text": ov["override_text"] if ov else "",
        }
    return out


__all__ = ["get_prompt", "set_prompt", "clear_prompt", "list_prompts"]
