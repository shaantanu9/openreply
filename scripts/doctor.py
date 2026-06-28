"""Sidecar health-check — run BEFORE `npm run tauri dev` to catch import /
schema / source-registration errors up front rather than mid-collect.

Exit codes:
  0 — healthy
  1 — critical failure (sidecar won't start)
  2 — warning (non-blocking, e.g. optional extras missing)

Called from scripts/dev.sh. Safe to run standalone:
    .venv/bin/python scripts/doctor.py
"""
from __future__ import annotations

import importlib
import sys
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))


GREEN, RED, YELLOW, CYAN, RESET = "\033[32m", "\033[31m", "\033[33m", "\033[36m", "\033[0m"


def ok(msg: str) -> None:
    print(f"  {GREEN}✓{RESET} {msg}")


def fail(msg: str) -> None:
    print(f"  {RED}✗{RESET} {msg}")


def warn(msg: str) -> None:
    print(f"  {YELLOW}!{RESET} {msg}")


def section(title: str) -> None:
    print(f"\n{CYAN}── {title} ──{RESET}")


def check_core_imports() -> list[str]:
    """Every module the Tauri sidecar will try to import on first `run_cli`."""
    errors: list[str] = []
    modules = [
        "openreply",
        "openreply.cli.main",
        "openreply.core.db",
        "openreply.research.collect",
        "openreply.research.chat",
        "openreply.research.gaps",
        "openreply.analyze.painpoints",
        "openreply.analyze.providers.base",
        "openreply.analyze.providers.openai",
        "openreply.analyze.providers.ollama",
        "openreply.graph.build",
        "openreply.graph.semantic",
        "openreply.sources.collect_adapter",
        "openreply.sources.rss",
        "openreply.sources.rss_catalog",
    ]
    for mod in modules:
        try:
            importlib.import_module(mod)
            ok(f"import {mod}")
        except Exception as e:  # pragma: no cover
            fail(f"import {mod}: {e}")
            errors.append(f"{mod}: {e}")
    return errors


def check_sources_dict() -> list[str]:
    errors: list[str] = []
    try:
        from openreply.sources.collect_adapter import SOURCES
    except Exception as e:
        fail(f"SOURCES import failed: {e}")
        return [str(e)]

    required = [
        "hn", "appstore", "playstore", "scholar", "stackoverflow",
        "trends", "arxiv", "openalex", "pubmed", "gnews", "devto",
        "lemmy", "mastodon", "github", "github_issues", "youtube",
        # RSS bundle (added 2026-04-20)
        "rss", "rss_startup", "rss_tech_news", "rss_products",
        "rss_ml", "rss_science", "rss_engineering", "rss_learning",
        "rss_design", "rss_psychology", "rss_neuroscience", "rss_marketing",
    ]
    for src in required:
        if src not in SOURCES:
            fail(f"SOURCES missing '{src}'")
            errors.append(f"SOURCES missing {src}")
        else:
            ok(f"SOURCES['{src}'] → {SOURCES[src].__name__}")
    return errors


def check_db_schema() -> list[str]:
    """Sanity-check that init_schema creates every table the UI queries."""
    errors: list[str] = []
    import os
    import pathlib
    import tempfile

    # Isolated scratch DB so we don't touch the user's real DB.
    with tempfile.TemporaryDirectory() as td:
        os.environ["OPENREPLY_DB_PATH"] = str(pathlib.Path(td) / "doctor.db")
        try:
            # Purge any cached get_db() that a previous import pinned to the
            # real DB path — otherwise init_schema initialises the wrong file.
            from openreply.core import db as _db
            if hasattr(_db, "_cache_clear"):
                _db._cache_clear()
            from openreply.core.db import get_db, init_schema

            db = get_db()
            init_schema(db)

            # topic_insights + experiments are created lazily on first use
            # (insights.py::_ensure_topic_insights_table,
            # gap_discovery.py::_ensure_experiments_table). Don't flag as
            # missing at boot — only fail on tables init_schema itself owns.
            required_tables = [
                "posts", "topic_posts", "comments", "users", "subreddits",
                "graph_nodes", "graph_edges",
                "fetches", "topic_runs", "topic_prefs",
                "paper_analyses",
                "topic_canonicalizations", "trend_series",
                "streams", "stream_hits", "hypothesis_tests",
            ]
            existing = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            for t in required_tables:
                if t in existing:
                    ok(f"table '{t}' present")
                else:
                    fail(f"table '{t}' missing after init_schema")
                    errors.append(f"missing table {t}")
        except Exception as e:
            fail(f"init_schema failed: {e}")
            traceback.print_exc()
            errors.append(str(e))
        finally:
            os.environ.pop("OPENREPLY_DB_PATH", None)
    return errors


def check_optional_extras() -> list[str]:
    """Non-blocking — warn if optional deps for specific sources are absent."""
    warnings: list[str] = []
    extras = {
        "feedparser": "RSS / gnews",
        "pypdf": "PDF ingest",
        "google_play_scraper": "Play Store reviews",
        "pytrends": "Google Trends",
        "networkx": "graph layout",
        "markdownify": "HTML→Markdown for LLM prompts",
    }
    for mod, feature in extras.items():
        try:
            importlib.import_module(mod)
            ok(f"optional: {feature} ({mod})")
        except ImportError:
            warn(f"optional extra missing: {feature} — run `pip install -e '.[sources]'`")
            warnings.append(mod)
    return warnings


def check_llm_provider_resolution() -> list[str]:
    errors: list[str] = []
    try:
        from openreply.analyze.providers.base import resolve_provider
        provider_name = resolve_provider()
        if provider_name:
            ok(f"resolved LLM provider: {provider_name}")
        else:
            warn("no LLM provider resolved — chat/enrich will need a BYOK key in Settings")
    except Exception as e:
        warn(f"resolve_provider raised: {e} — chat/enrich will need BYOK")
        # Not a blocker — BYOK is valid config state.
    return errors


def main() -> int:
    print(f"{CYAN}OpenReply sidecar doctor{RESET}")
    print(f"  root: {ROOT}")
    print(f"  python: {sys.version.split()[0]}")

    all_errors: list[str] = []

    section("Core imports")
    all_errors += check_core_imports()

    section("Optional extras")
    check_optional_extras()

    section("SOURCES registry")
    all_errors += check_sources_dict()

    section("Database schema")
    all_errors += check_db_schema()

    section("LLM provider")
    all_errors += check_llm_provider_resolution()

    print()
    if all_errors:
        print(f"{RED}✗ {len(all_errors)} critical issue(s):{RESET}")
        for e in all_errors:
            print(f"    - {e}")
        return 1
    print(f"{GREEN}✓ sidecar healthy{RESET}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
