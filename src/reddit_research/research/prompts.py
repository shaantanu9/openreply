"""Load external prompt + query YAML files.

Prompts live in `<repo>/prompts/` so non-developers can tune the rubrics,
severity language, and query templates without touching Python.
"""
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml  # PyYAML ships transitively via fastmcp; explicit dep added to pyproject

# Allow override via env var so users can point at their own prompt set
_ENV = "REDDIT_MYIND_PROMPTS_DIR"


def _default_prompts_dir() -> Path:
    # 1. CWD/prompts  (when running from the repo root)
    cwd = Path.cwd() / "prompts"
    if cwd.is_dir():
        return cwd
    # 2. Installed package dir/../prompts  (editable install)
    here = Path(__file__).resolve()
    for up in (here.parent.parent.parent.parent, here.parent.parent.parent):
        candidate = up / "prompts"
        if candidate.is_dir():
            return candidate
    return cwd  # fall back (will raise on load)


def prompts_dir() -> Path:
    env = os.getenv(_ENV)
    if env:
        return Path(env).expanduser()
    return _default_prompts_dir()


@lru_cache(maxsize=32)
def load_yaml(name: str) -> dict[str, Any]:
    """Load a YAML file by bare name (e.g. 'queries', 'painpoints')."""
    p = prompts_dir() / f"{name}.yaml"
    if not p.exists():
        raise FileNotFoundError(f"Prompt file not found: {p}. Set {_ENV} to override.")
    with p.open(encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def render_queries(topic: str, categories: list[str] | None = None) -> dict[str, list[str]]:
    """Render query templates for a topic. categories default to all (pain/features/complaints/diy)."""
    cfg = load_yaml("queries")
    out: dict[str, list[str]] = {}
    wanted = categories or [k for k in cfg.keys() if k != "version"]
    for cat in wanted:
        templates = cfg.get(cat) or []
        out[cat] = [t.format(topic=topic) for t in templates]
    return out


def load_extractor(name: str) -> dict[str, str]:
    """Return {'system': ..., 'user_template': ...} for an extractor prompt."""
    cfg = load_yaml(name)
    return {
        "name": cfg.get("name", name),
        "system": cfg.get("system", "").strip(),
        "user_template": cfg.get("user_template", "Topic: {topic}\n\n{corpus}").strip(),
    }
