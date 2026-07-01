# src/openreply/research/competitor_intel/digest_hook.py
"""Daily-digest hook: summarise competitor deltas as 'Competitor moves'."""
from __future__ import annotations

from typing import Any

from . import registry
from .sweep import latest_snapshot, run_competitor_sweep


def _latest(product_id: str, name: str):
    return latest_snapshot(product_id, name)


def competitor_moves(
    product_id: str, *, run: bool = False, provider=None
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for c in registry.list_competitors(product_id, active_only=True):
        if not c.get("daily_fetch"):
            continue
        if run:
            try:
                run_competitor_sweep(product_id, c["competitor_name"],
                                     provider=provider, trigger="scheduled")
            except Exception:
                pass
        snap = _latest(product_id, c["competitor_name"])
        if not snap:
            continue
        out.append(
            {
                "competitor": c["competitor_name"],
                "delta": snap.get("delta", {}),
                "top_painpoints": (snap.get("metrics", {}) or {}).get("top_painpoints", []),
            }
        )
    return out
