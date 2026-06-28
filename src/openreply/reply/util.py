"""Small shared helpers for the reply engine."""
from __future__ import annotations

import json


def loads_json(raw: str) -> dict:
    """Tolerant JSON parse for LLM output (strips ``` fences and surrounding prose)."""
    if not raw:
        return {}
    s = raw.strip()
    if s.startswith("```"):
        s = s.strip("`")
        s = s.split("\n", 1)[1] if "\n" in s else s
    i, j = s.find("{"), s.rfind("}")
    if i >= 0 and j > i:
        s = s[i : j + 1]
    try:
        return json.loads(s)
    except Exception:
        return {}
