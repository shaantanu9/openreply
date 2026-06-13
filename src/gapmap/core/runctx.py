"""Per-pipeline-run id, grouping checks_ledger + lineage rows for one
collect/enrich/build invocation. Best-effort: unset → "" (rows still write)."""
from __future__ import annotations
import contextvars, uuid

_run_id: contextvars.ContextVar[str] = contextvars.ContextVar("gapmap_run_id", default="")


def new_run_id() -> str:
    return uuid.uuid4().hex


def set_run_id(rid: str) -> None:
    _run_id.set(rid or "")


def current_run_id() -> str:
    try:
        return _run_id.get()
    except Exception:
        return ""
