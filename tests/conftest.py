"""pytest bootstrap — makes `src/`-layout imports work without an editable install.

Why this exists: fresh contributors (and CI runners that skip `uv sync`) would
otherwise hit `ModuleNotFoundError: No module named 'reddit_research'` on every
test collection. The editable install via `uv sync` also papers over this, but
this file is a defensive backstop so `pytest tests/` Just Works on any checkout.

Keep this file minimal. Real fixtures live in individual test modules (see
`test_smoke.py::db` and `test_solutions_persist.py::db` for the canonical
pattern of a tmp-path SQLite fixture).
"""
from __future__ import annotations

import sys
from pathlib import Path

_SRC = Path(__file__).resolve().parent.parent / "src"
if _SRC.is_dir() and str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))
