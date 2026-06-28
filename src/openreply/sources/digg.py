"""Digg AI 1000 clustered-story source.

Shells out to the read-only `digg-pp-cli` (no auth). Activation gate:
only available when the binary is on PATH. Ported from last30days
lib/digg.py — each story cluster becomes one row; rank drives the score.
"""
from __future__ import annotations

import json
import shutil
import subprocess
from datetime import datetime, timezone
from typing import Any

_CLI_BIN = "digg-pp-cli"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _rank_score(rank: Any) -> int:
    """Top-50 leaderboard rank → positive signal in [0, 50]; else 0."""
    try:
        r = int(rank)
    except (TypeError, ValueError):
        return 0
    return (51 - r) if 1 <= r <= 50 else 0


def _run_cli(args: list[str], timeout: float = 60.0) -> dict:
    """Run digg-pp-cli and parse its JSON stdout. Returns {} on any failure."""
    try:
        proc = subprocess.run(
            [_CLI_BIN, *args],
            capture_output=True, text=True, timeout=timeout,
        )
    except (subprocess.SubprocessError, OSError):
        return {}
    if proc.returncode != 0 or not proc.stdout.strip():
        return {}
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError:
        return {}


def _row(c: dict[str, Any]) -> dict[str, Any]:
    cid = c.get("clusterUrlId") or ""
    title = str(c.get("title") or "").strip()
    tldr = str(c.get("tldr") or "").strip()
    return {
        "id": f"digg_{cid}",
        "sub": "digg",
        "source_type": "digg",
        "author": "[digg-cluster]",
        "title": title[:200],
        "selftext": tldr,
        "url": f"https://di.gg/ai/{cid}" if cid else "",
        "score": _rank_score(c.get("rank")),
        "upvote_ratio": None,
        "num_comments": int(c.get("postCount") or 0),
        "created_utc": 0.0,
        "is_self": 1,
        "over_18": 0,
        "flair": f"authors={int(c.get('uniqueAuthors') or 0)}",
        "permalink": f"https://di.gg/ai/{cid}" if cid else "",
        "fetched_at": _now_iso(),
    }


def fetch_digg(query: str, limit: int = 20) -> list[dict]:
    if not shutil.which(_CLI_BIN):
        return [{"_error": "digg-pp-cli not on PATH — install it to enable the "
                 "Digg AI-1000 source (read-only, no auth)"}]
    if not query.strip():
        return []
    resp = _run_cli(["search", query, "--since", "30d", "--agent", "--limit", str(limit)])
    clusters = (resp.get("results") if isinstance(resp, dict) else None) or []
    return [_row(c) for c in clusters[:limit] if isinstance(c, dict) and c.get("clusterUrlId")]
