"""Thin subprocess bridge to the @jackwener/opencli CLI.

opencli is a Node.js CLI with 100+ site adapters. This module spawns
`node <opencli-entry> <site> <command> [args...] --format json`, parses
stdout JSON, and surfaces normal Python errors on failure.

Adapters live alongside the existing ones in collect_adapter.py and
reuse `_persist()` so opencli rows land in the same `posts` table and
auto-index into the mempalace via the existing palace hook.

Resolution order for the opencli entry:
  1. $OPENCLI_ENTRY env var (path to dist/src/main.js)
  2. $OPENCLI_REPO env var → joins dist/src/main.js
  3. Sibling repo at ../../opencli/dist/src/main.js (relative to this file)
  4. Global `opencli` on PATH (last resort — usually denied in sandboxed envs)

Failures are logged + return [] so a missing opencli never crashes
the wider collect run.
"""
from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
from pathlib import Path

log = logging.getLogger(__name__)

_DEFAULT_TIMEOUT_S = 60
_FALLBACK_NODE = "/usr/bin/env node"  # use whichever node is on PATH


def _resolve_entry() -> tuple[list[str], str] | None:
    """Return (argv-prefix, label) for invoking opencli, or None if unavailable."""
    env_entry = os.environ.get("OPENCLI_ENTRY")
    if env_entry and Path(env_entry).is_file():
        return (["node", env_entry], f"node {env_entry}")

    env_repo = os.environ.get("OPENCLI_REPO")
    if env_repo:
        candidate = Path(env_repo) / "dist" / "src" / "main.js"
        if candidate.is_file():
            return (["node", str(candidate)], f"node {candidate}")

    here = Path(__file__).resolve()
    sibling = here.parents[3].parent / "opencli" / "dist" / "src" / "main.js"
    if sibling.is_file():
        return (["node", str(sibling)], f"node {sibling}")

    on_path = shutil.which("opencli")
    if on_path:
        return ([on_path], on_path)

    return None


def is_available() -> bool:
    """Cheap probe — does opencli look runnable?"""
    return _resolve_entry() is not None


def run(
    site: str,
    command: str,
    args: list[str] | None = None,
    *,
    timeout_s: int = _DEFAULT_TIMEOUT_S,
) -> list[dict]:
    """Invoke `opencli <site> <command> <args...> --format json`.

    Returns the parsed JSON list, or [] on any error (logged).
    Errors are non-fatal so a missing opencli doesn't break collect.
    """
    entry = _resolve_entry()
    if entry is None:
        log.warning(
            "opencli not available; set OPENCLI_REPO or OPENCLI_ENTRY, "
            "or clone @jackwener/opencli alongside this repo"
        )
        return []

    argv_prefix, label = entry
    argv = [*argv_prefix, site, command, *(args or []), "--format", "json"]

    try:
        proc = subprocess.run(
            argv,
            capture_output=True,
            text=True,
            timeout=timeout_s,
            check=False,
        )
    except subprocess.TimeoutExpired:
        log.warning("opencli %s %s timed out after %ds", site, command, timeout_s)
        return []
    except FileNotFoundError as e:
        log.warning("opencli node entry missing: %s (%s)", label, e)
        return []

    if proc.returncode != 0:
        stderr_tail = (proc.stderr or "").strip().splitlines()[-3:]
        log.warning(
            "opencli %s %s exited %d: %s",
            site, command, proc.returncode, " | ".join(stderr_tail),
        )
        return []

    out = (proc.stdout or "").strip()
    if not out:
        return []

    try:
        data = json.loads(out)
    except json.JSONDecodeError:
        first_brace = out.find("[")
        if first_brace > 0:
            try:
                data = json.loads(out[first_brace:])
            except json.JSONDecodeError as e:
                log.warning("opencli %s %s: non-JSON stdout (%s)", site, command, e)
                return []
        else:
            log.warning("opencli %s %s: non-JSON stdout", site, command)
            return []

    if not isinstance(data, list):
        log.warning("opencli %s %s: expected list, got %s", site, command, type(data).__name__)
        return []

    return data
