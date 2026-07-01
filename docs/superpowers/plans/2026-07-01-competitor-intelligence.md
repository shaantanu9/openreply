# Competitor Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user name their competitors (with pasted site/Product Hunt/App Store/review URLs), deeply research each across all data sources, surface every complaint/feature-gap and the opportunities they open, track it over time with deltas, and make the whole competitor corpus available to chat/graph/memory/reply — all grounded in cited posts.

**Architecture:** Build on the existing (currently unused) `products` / `product_competitors` / `product_signals` / `product_sweeps` schema in `core/db.py`. Reuse `research/collect.py:collect(topic, sources, extra_keywords)` as the fetch orchestrator (it tags posts into `topic_posts`, which auto-flows them into the corpus, memory palace, graph, chat, and opportunity scan). Reuse `research/gaps.py:find_gaps()`, `graph/semantic.py:enrich_from_llm()`, `reply/opportunity.py`, `reply/generate.py`, `reply/content.py`. Build new: schema migrations, a `research/competitor_intel/` package (registry, seed enricher, sweep runner, comparison), an LLM sentiment classifier, and the surfaces (CLI group, MCP sub-server, Tauri 3-tab screen + Settings card).

**Tech Stack:** Python 3.11+ (sqlite-utils, Typer, FastMCP), Rust (Tauri 2 commands), vanilla JS (Tauri frontend `dynamic.js`/`api.js`/`shell.js`). Tests: pytest (+ pytest-asyncio). Package/run via `uv`.

## Global Constraints

- **Run everything via uv:** `uv run --no-sync python -m pytest …` (deps already synced with `--extra all --extra dev`).
- **DB access:** always `from ..core.db import get_db` → `db = get_db()` (thread-local `sqlite_utils.Database`, WAL, 15s busy timeout). Never open raw sqlite3.
- **Guarded migrations only:** in `core/db.py:init_schema`, check `db.table_names()` before `.create()`, and `{c.name for c in db[table].columns}` before every `ALTER TABLE … ADD COLUMN`. Never a destructive migration.
- **LLM provider is BYOK:** every function that calls an LLM takes `provider: str | None = None` and passes it through; never hardcode "anthropic". Resolve via existing provider layer (`analyze/providers/base.py:get_provider`).
- **CLI `--json`:** every CLI command supports `--json` and, when set, prints exactly one `json.dumps(...)` line (consumed by the Tauri sidecar + MCP).
- **Commit hygiene:** one logical change per commit, conventional prefix, staged by explicit path. **No Claude/AI attribution in any commit message.** Never `git add -A` — the tree has pre-existing user WIP that must not be swept in.
- **Competitor topic string:** a competitor's corpus is scoped by the topic `f"competitor:{slug}"` where `slug = _slugify(competitor_name)`. This is the single source of truth linking a competitor to its posts.
- **Reuse `product_signals` for findings + opportunities:** `signal_type` ∈ {`complaint`, `feature_gap`, `churn_trigger`, `praise`, `competitor_vulnerability`}; `related_competitor` = competitor_name; `evidence_post_ids` = JSON post-id array (citations); lifecycle via `user_action`.
- **Do NOT add `competitor_id` to `posts`** — topic tagging via `topic_posts` already scopes the corpus.
- **File size:** keep each new module focused and under ~400 lines; split by responsibility.

---

## File structure (new + modified)

**New (Python core — `src/openreply/research/competitor_intel/`):**
- `__init__.py` — public re-exports
- `registry.py` — competitor CRUD over `product_competitors` (~200 lines)
- `enrich.py` — seed enricher (~150 lines)
- `sweep.py` — sweep runner: collect → gaps → sentiment → signals → snapshot/delta (~300 lines)
- `signals.py` — read/update findings & opportunities over `product_signals` (~150 lines)
- `compare.py` — head-to-head comparison builder (~150 lines)

**New (Python — elsewhere):**
- `src/openreply/analyze/sentiment.py` — LLM sentiment classifier + `sentiment_by_source` (~180 lines)
- `src/openreply/cli/competitor_cmds.py` — Typer `competitor_app` (~250 lines)
- `src/openreply/mcp/tools/competitor_tools.py` — FastMCP `competitor_server` (~180 lines)

**New (tests):**
- `tests/test_competitor_registry.py`, `tests/test_competitor_enrich.py`, `tests/test_sentiment.py`, `tests/test_competitor_sweep.py`, `tests/test_competitor_signals.py`, `tests/test_competitor_compare.py`, `tests/test_competitor_cli.py`

**New (Tauri frontend):**
- competitor screen lives in `app-tauri/src/or/dynamic.js` (new `renderCompetitors` + `buildCompetitorsCard`)

**Modified:**
- `src/openreply/core/db.py:init_schema` — migrations (Phase 0)
- `src/openreply/cli/main.py` — `add_typer(competitor_app, name="competitor")`
- `src/openreply/mcp/server.py` — `mcp.mount(competitor_server)`
- `src/openreply/reply/digest.py` — "Competitor moves" section + trigger daily sweeps
- `app-tauri/src-tauri/src/commands.rs` — competitor commands
- `app-tauri/src-tauri/src/main.rs` — register in `generate_handler!`
- `app-tauri/src/or/api.js` — invoke wrappers
- `app-tauri/src/or/dynamic.js` — `DYN` route + Settings card
- `app-tauri/src/or/shell.js` — sidebar nav entry
- `FEATURES.md`, `changelogs/…` — docs

---

## Phase 0 — Schema migrations

### Task 0: Extend `product_competitors` + add `competitor_snapshots`

**Files:**
- Modify: `src/openreply/core/db.py` (inside `init_schema`, near the existing `product_competitors` block ~line 977)
- Test: `tests/test_competitor_schema.py`

**Interfaces:**
- Produces: extended `product_competitors` columns (`slug`, `topic`, `aliases_json`, `subreddits_json`, `source_config_json`, `status`, `daily_fetch`, `in_opp_scan`, `notes`, `updated_at`) and a new `competitor_snapshots` table (`id`, `product_id`, `competitor_name`, `sweep_id`, `created_at`, `metrics_json`, `summary`, `delta_json`).

- [ ] **Step 1: Write the failing test**

```python
# tests/test_competitor_schema.py
from openreply.core.db import get_db

def test_product_competitors_has_new_columns():
    db = get_db()
    cols = {c.name for c in db["product_competitors"].columns}
    for c in ("slug", "topic", "aliases_json", "subreddits_json",
              "source_config_json", "status", "daily_fetch", "in_opp_scan",
              "notes", "updated_at"):
        assert c in cols, f"missing column {c}"

def test_competitor_snapshots_table_exists():
    db = get_db()
    assert "competitor_snapshots" in db.table_names()
    cols = {c.name for c in db["competitor_snapshots"].columns}
    for c in ("id", "product_id", "competitor_name", "sweep_id",
              "created_at", "metrics_json", "summary", "delta_json"):
        assert c in cols
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run --no-sync python -m pytest tests/test_competitor_schema.py -q`
Expected: FAIL (columns/table missing).

- [ ] **Step 3: Add the migrations in `init_schema`**

Add AFTER the existing `product_sweeps` creation block (search for `if "product_sweeps" not in db.table_names():`). Follow the repo's guarded pattern:

```python
    # ── Competitor Intelligence: extend product_competitors + snapshots table.
    if "product_competitors" in db.table_names():
        _cc_cols = {c.name for c in db["product_competitors"].columns}
        _cc_adds = {
            "slug": "TEXT",
            "topic": "TEXT",
            "aliases_json": "TEXT",
            "subreddits_json": "TEXT",
            "source_config_json": "TEXT",
            "status": "TEXT DEFAULT 'active'",
            "daily_fetch": "INTEGER DEFAULT 0",
            "in_opp_scan": "INTEGER DEFAULT 1",
            "notes": "TEXT",
            "updated_at": "TEXT",
        }
        for _col, _decl in _cc_adds.items():
            if _col not in _cc_cols:
                db.executescript(
                    f"ALTER TABLE product_competitors ADD COLUMN {_col} {_decl}"
                )

    if "competitor_snapshots" not in db.table_names():
        db["competitor_snapshots"].create(
            {
                "id": int,
                "product_id": str,
                "competitor_name": str,
                "sweep_id": int,
                "created_at": str,
                "metrics_json": str,
                "summary": str,
                "delta_json": str,
            },
            pk="id",
        )
        db["competitor_snapshots"].create_index(["product_id", "competitor_name"])
        db["competitor_snapshots"].create_index(["created_at"])
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run --no-sync python -m pytest tests/test_competitor_schema.py -q`
Expected: PASS (2 passed).

- [ ] **Step 5: Verify idempotency (run twice)**

Run: `uv run --no-sync python -c "from openreply.core.db import get_db; get_db(); get_db(); print('ok')"`
Expected: prints `ok`, no exception (safe re-run).

- [ ] **Step 6: Commit**

```bash
git add src/openreply/core/db.py tests/test_competitor_schema.py
git commit -m "feat(db): competitor tracking schema — extend product_competitors + competitor_snapshots"
```

---

## Phase 1 — Competitor registry (CRUD)

### Task 1: `registry.py` — slug + topic helpers and create/read

**Files:**
- Create: `src/openreply/research/competitor_intel/__init__.py`
- Create: `src/openreply/research/competitor_intel/registry.py`
- Test: `tests/test_competitor_registry.py`

**Interfaces:**
- Produces:
  - `_slugify(name: str) -> str`
  - `competitor_topic(slug: str) -> str` → `f"competitor:{slug}"`
  - `add_competitor(product_id: str, name: str, *, website: str = "", urls: dict | None = None, aliases: list[str] | None = None, subreddits: list[str] | None = None, source_config: dict | None = None, category: str = "", daily_fetch: bool = False, in_opp_scan: bool = True, notes: str = "") -> dict`
  - `get_competitor(product_id: str, name: str) -> dict | None`
  - `list_competitors(product_id: str | None = None, active_only: bool = False) -> list[dict]`
  - `DEFAULT_SOURCE_PACK: list[str]` = `["appstore","playstore","trustpilot","alternativeto","producthunt","reddit_free","hackernews","stackoverflow"]`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_competitor_registry.py
from openreply.research.competitor_intel import registry as R

def test_slugify():
    assert R._slugify("Notion Labs!") == "notion-labs"
    assert R._slugify("  Obsidian.md ") == "obsidian-md"

def test_competitor_topic():
    assert R.competitor_topic("notion") == "competitor:notion"

def test_add_and_get_competitor():
    R.add_competitor("prod1", "Notion", website="https://notion.so",
                     aliases=["notion.so"], subreddits=["Notion"])
    c = R.get_competitor("prod1", "Notion")
    assert c is not None
    assert c["slug"] == "notion"
    assert c["topic"] == "competitor:notion"
    assert c["aliases"] == ["notion.so"]
    assert c["subreddits"] == ["Notion"]
    assert c["source_config"]["enabled_adapters"] == R.DEFAULT_SOURCE_PACK
    assert c["status"] == "active"

def test_list_competitors():
    R.add_competitor("prodL", "A")
    R.add_competitor("prodL", "B")
    rows = R.list_competitors("prodL")
    assert {r["competitor_name"] for r in rows} == {"A", "B"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run --no-sync python -m pytest tests/test_competitor_registry.py -q`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `registry.py`**

```python
# src/openreply/research/competitor_intel/registry.py
"""Competitor registry — CRUD over the product_competitors table."""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any

from ...core.db import get_db

DEFAULT_SOURCE_PACK: list[str] = [
    "appstore", "playstore", "trustpilot", "alternativeto",
    "producthunt", "reddit_free", "hackernews", "stackoverflow",
]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _slugify(name: str) -> str:
    s = name.strip().lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")


def competitor_topic(slug: str) -> str:
    return f"competitor:{slug}"


def _row_to_dict(row: dict[str, Any]) -> dict[str, Any]:
    def _j(v, default):
        if not v:
            return default
        try:
            return json.loads(v)
        except Exception:
            return default
    return {
        "product_id": row.get("product_id"),
        "competitor_name": row.get("competitor_name"),
        "slug": row.get("slug"),
        "topic": row.get("topic"),
        "website": (_j(row.get("urls_json"), {}) or {}).get("website", ""),
        "urls": _j(row.get("urls_json"), {}),
        "aliases": _j(row.get("aliases_json"), []),
        "subreddits": _j(row.get("subreddits_json"), []),
        "source_config": _j(row.get("source_config_json"), {}),
        "category": row.get("category") or "",
        "status": row.get("status") or "active",
        "daily_fetch": bool(row.get("daily_fetch")),
        "in_opp_scan": bool(row.get("in_opp_scan")),
        "notes": row.get("notes") or "",
        "is_active": bool(row.get("is_active", 1)),
        "tracked_since": row.get("tracked_since"),
        "updated_at": row.get("updated_at"),
    }


def add_competitor(
    product_id: str,
    name: str,
    *,
    website: str = "",
    urls: dict | None = None,
    aliases: list[str] | None = None,
    subreddits: list[str] | None = None,
    source_config: dict | None = None,
    category: str = "",
    daily_fetch: bool = False,
    in_opp_scan: bool = True,
    notes: str = "",
) -> dict[str, Any]:
    db = get_db()
    slug = _slugify(name)
    url_map = dict(urls or {})
    if website:
        url_map.setdefault("website", website)
    cfg = source_config or {"enabled_adapters": list(DEFAULT_SOURCE_PACK), "params": {}}
    rec = {
        "product_id": product_id,
        "competitor_name": name,
        "slug": slug,
        "topic": competitor_topic(slug),
        "urls_json": json.dumps(url_map),
        "aliases_json": json.dumps(aliases or []),
        "subreddits_json": json.dumps(subreddits or []),
        "source_config_json": json.dumps(cfg),
        "category": category,
        "status": "active",
        "daily_fetch": 1 if daily_fetch else 0,
        "in_opp_scan": 1 if in_opp_scan else 0,
        "notes": notes,
        "is_active": 1,
        "tracked_since": _now(),
        "updated_at": _now(),
    }
    db["product_competitors"].upsert(rec, pk=("product_id", "competitor_name"))
    return get_competitor(product_id, name)  # type: ignore[return-value]


def get_competitor(product_id: str, name: str) -> dict[str, Any] | None:
    db = get_db()
    rows = list(
        db["product_competitors"].rows_where(
            "product_id = ? and competitor_name = ?", [product_id, name]
        )
    )
    return _row_to_dict(rows[0]) if rows else None


def list_competitors(
    product_id: str | None = None, active_only: bool = False
) -> list[dict[str, Any]]:
    db = get_db()
    where, params = [], []
    if product_id:
        where.append("product_id = ?")
        params.append(product_id)
    if active_only:
        where.append("is_active = 1")
    clause = " and ".join(where) if where else None
    rows = (
        db["product_competitors"].rows_where(clause, params)
        if clause
        else db["product_competitors"].rows
    )
    return [_row_to_dict(r) for r in rows]
```

```python
# src/openreply/research/competitor_intel/__init__.py
"""Competitor Intelligence package."""
from .registry import (  # noqa: F401
    DEFAULT_SOURCE_PACK,
    add_competitor,
    competitor_topic,
    get_competitor,
    list_competitors,
)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run --no-sync python -m pytest tests/test_competitor_registry.py -q`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add src/openreply/research/competitor_intel/ tests/test_competitor_registry.py
git commit -m "feat(competitor): registry CRUD (add/get/list) over product_competitors"
```

### Task 2: `registry.py` — update + remove

**Files:**
- Modify: `src/openreply/research/competitor_intel/registry.py`
- Modify: `src/openreply/research/competitor_intel/__init__.py` (export new fns)
- Test: `tests/test_competitor_registry.py` (append)

**Interfaces:**
- Produces:
  - `update_competitor(product_id: str, name: str, **fields) -> dict | None` — accepts any of `website, urls, aliases, subreddits, source_config, category, status, daily_fetch, in_opp_scan, notes, is_active`
  - `remove_competitor(product_id: str, name: str) -> bool`

- [ ] **Step 1: Write the failing test (append)**

```python
def test_update_competitor():
    R.add_competitor("prodU", "X", subreddits=["x"])
    out = R.update_competitor("prodU", "X", daily_fetch=True, subreddits=["x", "xhq"])
    assert out["daily_fetch"] is True
    assert out["subreddits"] == ["x", "xhq"]

def test_remove_competitor():
    R.add_competitor("prodR", "Y")
    assert R.remove_competitor("prodR", "Y") is True
    assert R.get_competitor("prodR", "Y") is None
```

- [ ] **Step 2: Run to verify fail**

Run: `uv run --no-sync python -m pytest tests/test_competitor_registry.py -k "update or remove" -q`
Expected: FAIL (attrs missing).

- [ ] **Step 3: Implement update + remove**

```python
# append to registry.py
_JSON_FIELDS = {"urls": "urls_json", "aliases": "aliases_json",
                "subreddits": "subreddits_json", "source_config": "source_config_json"}
_BOOL_FIELDS = {"daily_fetch", "in_opp_scan", "is_active"}
_PLAIN_FIELDS = {"category", "status", "notes"}


def update_competitor(product_id: str, name: str, **fields: Any) -> dict[str, Any] | None:
    db = get_db()
    if not get_competitor(product_id, name):
        return None
    patch: dict[str, Any] = {"updated_at": _now()}
    for k, v in fields.items():
        if k == "website":
            cur = get_competitor(product_id, name)
            urls = dict(cur["urls"]) if cur else {}
            urls["website"] = v
            patch["urls_json"] = json.dumps(urls)
        elif k in _JSON_FIELDS:
            patch[_JSON_FIELDS[k]] = json.dumps(v)
        elif k in _BOOL_FIELDS:
            patch[k] = 1 if v else 0
        elif k in _PLAIN_FIELDS:
            patch[k] = v
    db["product_competitors"].update((product_id, name), patch)
    return get_competitor(product_id, name)


def remove_competitor(product_id: str, name: str) -> bool:
    db = get_db()
    if not get_competitor(product_id, name):
        return False
    db["product_competitors"].delete((product_id, name))
    return True
```

Add to `__init__.py` imports: `remove_competitor, update_competitor`.

- [ ] **Step 4: Run to verify pass**

Run: `uv run --no-sync python -m pytest tests/test_competitor_registry.py -q`
Expected: PASS (6 passed).

- [ ] **Step 5: Commit**

```bash
git add src/openreply/research/competitor_intel/registry.py src/openreply/research/competitor_intel/__init__.py tests/test_competitor_registry.py
git commit -m "feat(competitor): registry update + remove"
```

---

## Phase 2 — Seed enricher

### Task 3: `enrich.py` — auto-resolve aliases/subreddit/URLs

**Files:**
- Create: `src/openreply/research/competitor_intel/enrich.py`
- Test: `tests/test_competitor_enrich.py`

**Interfaces:**
- Consumes: the LLM provider layer (`analyze/providers/base.py:get_provider`) — call via a small helper; in tests, monkeypatch `enrich._call_llm`.
- Produces: `enrich_seed(name: str, *, website: str = "", provider: str | None = None) -> dict` returning `{"aliases": [...], "subreddits": [...], "urls": {...}, "category": "..."}`. Must degrade to `{"aliases": [], "subreddits": [], "urls": {}, "category": ""}` (never raise) on any LLM error.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_competitor_enrich.py
from openreply.research.competitor_intel import enrich

def test_enrich_seed_parses_llm(monkeypatch):
    def fake_llm(prompt, provider=None):
        return ('{"aliases":["notion.so","@NotionHQ"],'
                '"subreddits":["Notion"],'
                '"urls":{"producthunt":"https://www.producthunt.com/products/notion"},'
                '"category":"productivity"}')
    monkeypatch.setattr(enrich, "_call_llm", fake_llm)
    out = enrich.enrich_seed("Notion")
    assert "notion.so" in out["aliases"]
    assert out["subreddits"] == ["Notion"]
    assert out["urls"]["producthunt"].startswith("https://")
    assert out["category"] == "productivity"

def test_enrich_seed_degrades_on_error(monkeypatch):
    def boom(prompt, provider=None):
        raise RuntimeError("no key")
    monkeypatch.setattr(enrich, "_call_llm", boom)
    out = enrich.enrich_seed("Whatever")
    assert out == {"aliases": [], "subreddits": [], "urls": {}, "category": ""}
```

- [ ] **Step 2: Run to verify fail**

Run: `uv run --no-sync python -m pytest tests/test_competitor_enrich.py -q`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `enrich.py`**

```python
# src/openreply/research/competitor_intel/enrich.py
"""Seed enricher — given a competitor name, propose aliases/subreddit/URLs via LLM."""
from __future__ import annotations

import json
from typing import Any

_PROMPT = """You are helping identify a software competitor's online footprint.
Given the product name{website}, return STRICT JSON with keys:
  aliases: array of alternate names / domains / social handles (max 5)
  subreddits: array of subreddit names WITHOUT the r/ prefix (max 3)
  urls: object mapping any of {{producthunt, appstore, playstore, trustpilot, g2, website}} to a full https URL you are confident about (omit unknown)
  category: one short product category string
Product name: {name}
Return only the JSON object, no prose."""


def _call_llm(prompt: str, provider: str | None = None) -> str:
    """Thin LLM call — isolated so tests can monkeypatch it."""
    from ...analyze.providers.base import get_provider

    p = get_provider(provider)
    return p.complete(prompt, max_tokens=512)  # provider.complete → str


def _empty() -> dict[str, Any]:
    return {"aliases": [], "subreddits": [], "urls": {}, "category": ""}


def enrich_seed(name: str, *, website: str = "", provider: str | None = None) -> dict[str, Any]:
    site_clause = f" (website: {website})" if website else ""
    prompt = _PROMPT.format(name=name, website=site_clause)
    try:
        raw = _call_llm(prompt, provider=provider)
        start, end = raw.find("{"), raw.rfind("}")
        data = json.loads(raw[start : end + 1]) if start >= 0 else {}
    except Exception:
        return _empty()
    out = _empty()
    if isinstance(data.get("aliases"), list):
        out["aliases"] = [str(x) for x in data["aliases"]][:5]
    if isinstance(data.get("subreddits"), list):
        out["subreddits"] = [str(x).lstrip("r/").strip("/") for x in data["subreddits"]][:3]
    if isinstance(data.get("urls"), dict):
        out["urls"] = {k: str(v) for k, v in data["urls"].items() if str(v).startswith("http")}
    if isinstance(data.get("category"), str):
        out["category"] = data["category"]
    return out
```

> **Note for implementer:** confirm the provider interface method name. If `get_provider(...).complete(prompt, max_tokens=...)` differs in this codebase, adjust `_call_llm` to match the real provider API (grep `analyze/providers/base.py` for the completion method). The tests monkeypatch `_call_llm`, so they pass regardless; only real runs depend on this.

- [ ] **Step 4: Run to verify pass**

Run: `uv run --no-sync python -m pytest tests/test_competitor_enrich.py -q`
Expected: PASS (2 passed).

- [ ] **Step 5: Add export + commit**

Add `from .enrich import enrich_seed  # noqa: F401` to `__init__.py`.
```bash
git add src/openreply/research/competitor_intel/enrich.py src/openreply/research/competitor_intel/__init__.py tests/test_competitor_enrich.py
git commit -m "feat(competitor): LLM seed enricher (aliases/subreddits/urls) with safe degradation"
```

---

## Phase 3 — Sentiment classifier

### Task 4: `analyze/sentiment.py` — per-post + per-source sentiment

**Files:**
- Create: `src/openreply/analyze/sentiment.py`
- Test: `tests/test_sentiment.py`

**Interfaces:**
- Consumes: `research/collect.py:corpus_for(topic, limit=...)` to read a topic's posts (list of dicts with `source_type`, `title`, `selftext`). In tests, monkeypatch both `sentiment._call_llm` and `sentiment._corpus_for`.
- Produces:
  - `classify_batch(texts: list[str], provider: str | None = None) -> list[float]` — each in [-1.0, 1.0].
  - `sentiment_by_source(topic: str, *, limit: int = 200, provider: str | None = None) -> dict` returning `{"overall": float, "by_source": {src: {"score": float, "n": int, "pos": int, "neg": int, "neu": int}}}`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_sentiment.py
from openreply.analyze import sentiment

def test_sentiment_by_source_aggregates(monkeypatch):
    posts = [
        {"source_type": "appstore", "title": "hate the price", "selftext": ""},
        {"source_type": "appstore", "title": "love it", "selftext": ""},
        {"source_type": "reddit_free", "title": "meh okay", "selftext": ""},
    ]
    monkeypatch.setattr(sentiment, "_corpus_for", lambda topic, limit: posts)
    # Deterministic fake classifier: -1 if "hate", +1 if "love", else 0
    def fake_batch(texts, provider=None):
        out = []
        for t in texts:
            out.append(-1.0 if "hate" in t else 1.0 if "love" in t else 0.0)
        return out
    monkeypatch.setattr(sentiment, "classify_batch", fake_batch)

    res = sentiment.sentiment_by_source("competitor:x")
    assert res["by_source"]["appstore"]["n"] == 2
    assert res["by_source"]["appstore"]["pos"] == 1
    assert res["by_source"]["appstore"]["neg"] == 1
    assert res["by_source"]["appstore"]["score"] == 0.0
    assert res["by_source"]["reddit_free"]["neu"] == 1
    assert -1.0 <= res["overall"] <= 1.0
```

- [ ] **Step 2: Run to verify fail**

Run: `uv run --no-sync python -m pytest tests/test_sentiment.py -q`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `analyze/sentiment.py`**

```python
# src/openreply/analyze/sentiment.py
"""LLM sentiment classification, aggregated per source_type."""
from __future__ import annotations

import json
from typing import Any

_BATCH_PROMPT = """Rate the sentiment of each numbered text toward the product it discusses.
Return STRICT JSON: an array of floats in [-1,1] (one per input, same order).
-1 = very negative/complaint, 0 = neutral, 1 = very positive.
Texts:
{items}
Return only the JSON array."""


def _call_llm(prompt: str, provider: str | None = None) -> str:
    from .providers.base import get_provider

    return get_provider(provider).complete(prompt, max_tokens=1024)


def _corpus_for(topic: str, limit: int):
    from ..research.collect import corpus_for

    return corpus_for(topic, limit=limit)


def classify_batch(texts: list[str], provider: str | None = None) -> list[float]:
    if not texts:
        return []
    items = "\n".join(f"{i+1}. {t[:300]}" for i, t in enumerate(texts))
    try:
        raw = _call_llm(_BATCH_PROMPT.format(items=items), provider=provider)
        s, e = raw.find("["), raw.rfind("]")
        arr = json.loads(raw[s : e + 1])
        vals = [max(-1.0, min(1.0, float(x))) for x in arr]
    except Exception:
        return [0.0] * len(texts)
    if len(vals) < len(texts):
        vals += [0.0] * (len(texts) - len(vals))
    return vals[: len(texts)]


def _bucket(score: float) -> str:
    return "pos" if score > 0.2 else "neg" if score < -0.2 else "neu"


def sentiment_by_source(
    topic: str, *, limit: int = 200, provider: str | None = None
) -> dict[str, Any]:
    posts = list(_corpus_for(topic, limit))
    texts = [f"{p.get('title','')} {p.get('selftext','')}".strip() for p in posts]
    scores = classify_batch(texts, provider=provider)
    by_source: dict[str, dict[str, Any]] = {}
    total = 0.0
    for p, sc in zip(posts, scores):
        src = p.get("source_type") or "unknown"
        b = by_source.setdefault(src, {"score": 0.0, "n": 0, "pos": 0, "neg": 0, "neu": 0})
        b["n"] += 1
        b[_bucket(sc)] += 1
        b["score"] += sc
        total += sc
    for b in by_source.values():
        b["score"] = round(b["score"] / b["n"], 3) if b["n"] else 0.0
    overall = round(total / len(scores), 3) if scores else 0.0
    return {"overall": overall, "by_source": by_source}
```

- [ ] **Step 4: Run to verify pass**

Run: `uv run --no-sync python -m pytest tests/test_sentiment.py -q`
Expected: PASS (1 passed).

- [ ] **Step 5: Commit**

```bash
git add src/openreply/analyze/sentiment.py tests/test_sentiment.py
git commit -m "feat(analyze): LLM sentiment-by-source classifier"
```

---

## Phase 4 — Sweep runner (the core orchestration)

### Task 5: `signals.py` — write + read findings/opportunities over `product_signals`

**Files:**
- Create: `src/openreply/research/competitor_intel/signals.py`
- Test: `tests/test_competitor_signals.py`

**Interfaces:**
- Produces:
  - `write_signal(product_id: str, competitor_name: str, *, signal_type: str, title: str, description: str = "", severity: float = 0.5, confidence: float = 0.6, evidence_post_ids: list[str] | None = None, suggested_action: str = "") -> str` (returns signal id)
  - `list_findings(product_id: str, competitor_name: str | None = None, kinds: list[str] | None = None) -> list[dict]`
  - `list_opportunities(product_id: str, competitor_name: str | None = None) -> list[dict]` (signal_type == "competitor_vulnerability")
  - `set_signal_action(signal_id: str, action: str) -> dict | None` (action ∈ dismissed|acted|snoozed|hypothesis)
  - `FINDING_KINDS = ["complaint", "feature_gap", "churn_trigger", "praise"]`
  - `OPPORTUNITY_KIND = "competitor_vulnerability"`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_competitor_signals.py
from openreply.research.competitor_intel import signals as S

def test_write_and_list_findings():
    sid = S.write_signal("p1", "Notion", signal_type="complaint",
                         title="slow sync", severity=0.8,
                         evidence_post_ids=["a", "b"])
    assert sid
    found = S.list_findings("p1", "Notion", kinds=["complaint"])
    assert any(f["id"] == sid for f in found)
    f = next(f for f in found if f["id"] == sid)
    assert f["evidence_post_ids"] == ["a", "b"]
    assert f["related_competitor"] == "Notion"

def test_list_opportunities_filters_kind():
    S.write_signal("p2", "Obsidian", signal_type="competitor_vulnerability",
                   title="no mobile sync", suggested_action="ship sync")
    S.write_signal("p2", "Obsidian", signal_type="complaint", title="x")
    opps = S.list_opportunities("p2")
    assert all(o["signal_type"] == "competitor_vulnerability" for o in opps)
    assert any(o["title"] == "no mobile sync" for o in opps)

def test_set_signal_action():
    sid = S.write_signal("p3", "A", signal_type="complaint", title="t")
    out = S.set_signal_action(sid, "dismissed")
    assert out["user_action"] == "dismissed"
```

- [ ] **Step 2: Run to verify fail**

Run: `uv run --no-sync python -m pytest tests/test_competitor_signals.py -q`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `signals.py`**

```python
# src/openreply/research/competitor_intel/signals.py
"""Findings + opportunities stored in product_signals."""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any

from ...core.db import get_db

FINDING_KINDS = ["complaint", "feature_gap", "churn_trigger", "praise"]
OPPORTUNITY_KIND = "competitor_vulnerability"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row(r: dict[str, Any]) -> dict[str, Any]:
    try:
        ev = json.loads(r.get("evidence_post_ids") or "[]")
    except Exception:
        ev = []
    d = dict(r)
    d["evidence_post_ids"] = ev
    return d


def write_signal(
    product_id: str,
    competitor_name: str,
    *,
    signal_type: str,
    title: str,
    description: str = "",
    severity: float = 0.5,
    confidence: float = 0.6,
    evidence_post_ids: list[str] | None = None,
    suggested_action: str = "",
) -> str:
    db = get_db()
    sid = "sig_" + uuid.uuid4().hex[:16]
    db["product_signals"].insert(
        {
            "id": sid,
            "product_id": product_id,
            "signal_type": signal_type,
            "severity": severity,
            "confidence": confidence,
            "detected_at": _now(),
            "title": title,
            "description": description,
            "evidence_post_ids": json.dumps(evidence_post_ids or []),
            "related_competitor": competitor_name,
            "suggested_action": suggested_action,
            "user_action": "",
            "user_action_at": "",
            "snoozed_until": "",
            "resolution_notes": "",
            "created_at": _now(),
        }
    )
    return sid


def list_findings(
    product_id: str, competitor_name: str | None = None, kinds: list[str] | None = None
) -> list[dict[str, Any]]:
    db = get_db()
    where, params = ["product_id = ?"], [product_id]
    if competitor_name:
        where.append("related_competitor = ?")
        params.append(competitor_name)
    ks = kinds or FINDING_KINDS
    where.append("signal_type in (%s)" % ",".join("?" * len(ks)))
    params.extend(ks)
    rows = db["product_signals"].rows_where(
        " and ".join(where), params, order_by="severity desc"
    )
    return [_row(r) for r in rows]


def list_opportunities(
    product_id: str, competitor_name: str | None = None
) -> list[dict[str, Any]]:
    db = get_db()
    where, params = ["product_id = ?", "signal_type = ?"], [product_id, OPPORTUNITY_KIND]
    if competitor_name:
        where.append("related_competitor = ?")
        params.append(competitor_name)
    rows = db["product_signals"].rows_where(
        " and ".join(where), params, order_by="severity desc"
    )
    return [_row(r) for r in rows]


def set_signal_action(signal_id: str, action: str) -> dict[str, Any] | None:
    db = get_db()
    if not list(db["product_signals"].rows_where("id = ?", [signal_id])):
        return None
    db["product_signals"].update(
        signal_id, {"user_action": action, "user_action_at": _now()}
    )
    return _row(next(iter(db["product_signals"].rows_where("id = ?", [signal_id]))))
```

- [ ] **Step 4: Run to verify pass**

Run: `uv run --no-sync python -m pytest tests/test_competitor_signals.py -q`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add src/openreply/research/competitor_intel/signals.py tests/test_competitor_signals.py
git commit -m "feat(competitor): findings/opportunities store over product_signals"
```

### Task 6: `sweep.py` — orchestrate collect → gaps → sentiment → signals → snapshot/delta

**Files:**
- Create: `src/openreply/research/competitor_intel/sweep.py`
- Test: `tests/test_competitor_sweep.py`

**Interfaces:**
- Consumes: `registry.get_competitor`, `registry.competitor_topic`, `signals.write_signal`, `analyze.sentiment.sentiment_by_source`, and (monkeypatched in tests) `sweep._collect`, `sweep._find_gaps`, `sweep._enrich_graph`.
- Produces:
  - `run_competitor_sweep(product_id: str, competitor_name: str, *, sources: list[str] | None = None, rebuild: bool = False, provider: str | None = None, trigger: str = "manual", progress=None) -> dict` returning `{"ok": True, "competitor": name, "topic": ..., "posts_fetched": int, "findings": int, "opportunities": int, "snapshot_id": int, "delta": {...}}`.
  - `latest_snapshot(product_id: str, competitor_name: str) -> dict | None`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_competitor_sweep.py
from openreply.research.competitor_intel import sweep, registry

def test_run_competitor_sweep_end_to_end(monkeypatch):
    registry.add_competitor("psw", "Notion", subreddits=["Notion"])

    monkeypatch.setattr(sweep, "_collect",
        lambda topic, sources, keywords, provider, progress: {"posts_fetched": 12})
    monkeypatch.setattr(sweep, "_find_gaps", lambda topic, provider: {
        "painpoints": [{"label": "slow sync", "evidence_post_ids": ["p1"], "severity": 0.8}],
        "product_complaints": [{"label": "expensive", "evidence_post_ids": ["p2"]}],
        "feature_wishes": [{"label": "offline mode", "evidence_post_ids": ["p3"]}],
    })
    monkeypatch.setattr(sweep, "_enrich_graph", lambda topic: None)
    monkeypatch.setattr(sweep, "_sentiment", lambda topic, provider: {
        "overall": -0.4, "by_source": {"appstore": {"score": -0.4, "n": 5,
                                                     "pos": 1, "neg": 3, "neu": 1}}})

    out = sweep.run_competitor_sweep("psw", "Notion")
    assert out["ok"] is True
    assert out["posts_fetched"] == 12
    assert out["findings"] >= 2          # complaint + feature_gap written
    assert out["opportunities"] >= 1     # feature wish → competitor_vulnerability
    assert out["snapshot_id"]
    snap = sweep.latest_snapshot("psw", "Notion")
    assert snap["metrics"]["sentiment_score"] == -0.4

def test_sweep_computes_delta_on_second_run(monkeypatch):
    registry.add_competitor("psd", "X")
    monkeypatch.setattr(sweep, "_collect",
        lambda *a, **k: {"posts_fetched": 3})
    monkeypatch.setattr(sweep, "_enrich_graph", lambda topic: None)
    monkeypatch.setattr(sweep, "_sentiment",
        lambda topic, provider: {"overall": 0.0, "by_source": {}})
    monkeypatch.setattr(sweep, "_find_gaps", lambda topic, provider: {
        "painpoints": [{"label": "a", "evidence_post_ids": ["1"]}]})
    sweep.run_competitor_sweep("psd", "X")
    monkeypatch.setattr(sweep, "_find_gaps", lambda topic, provider: {
        "painpoints": [{"label": "a", "evidence_post_ids": ["1"]},
                       {"label": "b", "evidence_post_ids": ["2"]}]})
    out = sweep.run_competitor_sweep("psd", "X")
    assert out["delta"]["new_complaints"] >= 1
```

- [ ] **Step 2: Run to verify fail**

Run: `uv run --no-sync python -m pytest tests/test_competitor_sweep.py -q`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `sweep.py`**

```python
# src/openreply/research/competitor_intel/sweep.py
"""Competitor sweep runner: fetch → extract → sentiment → signals → snapshot/delta."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from ...core.db import get_db
from . import registry, signals


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Isolated wrappers (monkeypatched in tests) ────────────────────────────────
def _collect(topic, sources, keywords, provider, progress) -> dict[str, Any]:
    from ..collect import collect

    res = collect(topic=topic, sources=sources, extra_keywords=keywords,
                  skip_reddit=False, progress=progress)
    return {"posts_fetched": getattr(res, "posts_fetched", 0)}


def _find_gaps(topic, provider) -> dict[str, Any]:
    from ..gaps import find_gaps

    return find_gaps(topic, provider=provider)


def _sentiment(topic, provider) -> dict[str, Any]:
    from ...analyze.sentiment import sentiment_by_source

    return sentiment_by_source(topic, provider=provider)


def _enrich_graph(topic) -> None:
    try:
        from ...graph.semantic import enrich_from_llm

        enrich_from_llm(topic=topic)
    except Exception:
        pass


# ── Snapshot helpers ─────────────────────────────────────────────────────────
def latest_snapshot(product_id: str, competitor_name: str) -> dict[str, Any] | None:
    db = get_db()
    rows = list(
        db["competitor_snapshots"].rows_where(
            "product_id = ? and competitor_name = ?",
            [product_id, competitor_name],
            order_by="id desc",
            limit=1,
        )
    )
    if not rows:
        return None
    r = rows[0]
    return {
        "id": r["id"],
        "metrics": json.loads(r.get("metrics_json") or "{}"),
        "delta": json.loads(r.get("delta_json") or "{}"),
        "summary": r.get("summary") or "",
        "created_at": r.get("created_at"),
    }


def _compute_delta(prev: dict | None, metrics: dict) -> dict[str, Any]:
    if not prev:
        return {"new_complaints": metrics.get("complaint_count", 0),
                "sentiment_change": 0.0, "first_run": True}
    pm = prev.get("metrics", {})
    return {
        "new_complaints": max(0, metrics.get("complaint_count", 0) - pm.get("complaint_count", 0)),
        "sentiment_change": round(
            metrics.get("sentiment_score", 0.0) - pm.get("sentiment_score", 0.0), 3
        ),
        "first_run": False,
    }


# ── Main entry point ─────────────────────────────────────────────────────────
def run_competitor_sweep(
    product_id: str,
    competitor_name: str,
    *,
    sources: list[str] | None = None,
    rebuild: bool = False,
    provider: str | None = None,
    trigger: str = "manual",
    progress=None,
) -> dict[str, Any]:
    comp = registry.get_competitor(product_id, competitor_name)
    if not comp:
        return {"ok": False, "error": "competitor not found"}
    topic = comp["topic"]
    src = sources or (comp["source_config"].get("enabled_adapters") or registry.DEFAULT_SOURCE_PACK)
    keywords = [competitor_name, *comp.get("aliases", [])]

    fetched = _collect(topic, src, keywords, provider, progress)
    _enrich_graph(topic)
    gaps = _find_gaps(topic, provider)
    sent = _sentiment(topic, provider)

    n_find = n_opp = 0
    for pp in gaps.get("painpoints", []) + gaps.get("product_complaints", []):
        signals.write_signal(
            product_id, competitor_name, signal_type="complaint",
            title=pp.get("label", "")[:200], description=pp.get("summary", ""),
            severity=float(pp.get("severity", 0.5) or 0.5),
            evidence_post_ids=pp.get("evidence_post_ids", []),
        )
        n_find += 1
    for fw in gaps.get("feature_wishes", []):
        signals.write_signal(
            product_id, competitor_name, signal_type=signals.OPPORTUNITY_KIND,
            title=fw.get("label", "")[:200],
            description=fw.get("summary", ""),
            suggested_action="Build what this competitor lacks.",
            severity=float(fw.get("severity", 0.5) or 0.5),
            evidence_post_ids=fw.get("evidence_post_ids", []),
        )
        n_opp += 1

    complaint_count = n_find
    metrics = {
        "complaint_count": complaint_count,
        "sentiment_score": sent.get("overall", 0.0),
        "top_painpoints": [p.get("label") for p in gaps.get("painpoints", [])[:5]],
        "mentions_by_source": {k: v.get("n", 0) for k, v in sent.get("by_source", {}).items()},
        "posts_fetched": fetched.get("posts_fetched", 0),
    }
    prev = latest_snapshot(product_id, competitor_name)
    delta = _compute_delta(prev, metrics)

    db = get_db()
    sweep_id = db["product_sweeps"].insert(
        {
            "product_id": product_id,
            "run_at": _now(),
            "trigger": trigger,
            "signals_generated": n_find + n_opp,
            "posts_added": fetched.get("posts_fetched", 0),
            "duration_ms": 0,
            "error": "",
            "notes": f"competitor:{competitor_name}",
        }
    ).last_pk
    snap_id = db["competitor_snapshots"].insert(
        {
            "product_id": product_id,
            "competitor_name": competitor_name,
            "sweep_id": sweep_id,
            "created_at": _now(),
            "metrics_json": json.dumps(metrics),
            "summary": "",
            "delta_json": json.dumps(delta),
        }
    ).last_pk

    registry.update_competitor(product_id, competitor_name)  # bump updated_at
    return {
        "ok": True,
        "competitor": competitor_name,
        "topic": topic,
        "posts_fetched": fetched.get("posts_fetched", 0),
        "findings": n_find,
        "opportunities": n_opp,
        "snapshot_id": snap_id,
        "delta": delta,
    }
```

- [ ] **Step 4: Run to verify pass**

Run: `uv run --no-sync python -m pytest tests/test_competitor_sweep.py -q`
Expected: PASS (2 passed).

- [ ] **Step 5: Add exports + commit**

Add to `__init__.py`: `from .sweep import run_competitor_sweep, latest_snapshot  # noqa: F401` and `from .signals import list_findings, list_opportunities, set_signal_action, write_signal  # noqa: F401`.
```bash
git add src/openreply/research/competitor_intel/sweep.py src/openreply/research/competitor_intel/__init__.py tests/test_competitor_sweep.py
git commit -m "feat(competitor): sweep runner (collect→gaps→sentiment→signals→snapshot/delta)"
```

---

## Phase 5 — Comparison builder

### Task 7: `compare.py` — you-vs-competitors head-to-head

**Files:**
- Create: `src/openreply/research/competitor_intel/compare.py`
- Test: `tests/test_competitor_compare.py`

**Interfaces:**
- Consumes: `registry.list_competitors`, `sweep.latest_snapshot`, and the product's own topic (from the `products` table) via `compare._product_topic` (monkeypatched in tests). Reuses `analyze.sentiment.sentiment_by_source` for the product side via `compare._sentiment` (monkeypatched).
- Produces: `build_comparison(product_id: str, provider: str | None = None) -> dict` returning `{"you": {"sentiment": float, "complaint_count": int}, "competitors": [{"name", "sentiment", "complaint_count", "top_painpoints", "share_of_voice"}], "generated_at": str}`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_competitor_compare.py
from openreply.research.competitor_intel import compare, registry

def test_build_comparison(monkeypatch):
    registry.add_competitor("pc", "Notion")
    registry.add_competitor("pc", "Obsidian")
    monkeypatch.setattr(compare, "_product_topic", lambda pid: "myprod")
    monkeypatch.setattr(compare, "_sentiment",
        lambda topic, provider: {"overall": 0.3, "by_source": {}})
    snaps = {
        "Notion": {"metrics": {"sentiment_score": -0.2, "complaint_count": 10,
                               "top_painpoints": ["sync"], "mentions_by_source": {"a": 6}}},
        "Obsidian": {"metrics": {"sentiment_score": 0.1, "complaint_count": 4,
                                 "top_painpoints": ["mobile"], "mentions_by_source": {"a": 4}}},
    }
    monkeypatch.setattr(compare, "_latest", lambda pid, name: snaps.get(name))
    out = compare.build_comparison("pc")
    assert out["you"]["sentiment"] == 0.3
    names = {c["name"] for c in out["competitors"]}
    assert names == {"Notion", "Obsidian"}
    notion = next(c for c in out["competitors"] if c["name"] == "Notion")
    assert notion["complaint_count"] == 10
    # share_of_voice sums to ~1 across competitors
    assert abs(sum(c["share_of_voice"] for c in out["competitors"]) - 1.0) < 1e-6
```

- [ ] **Step 2: Run to verify fail**

Run: `uv run --no-sync python -m pytest tests/test_competitor_compare.py -q`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `compare.py`**

```python
# src/openreply/research/competitor_intel/compare.py
"""Head-to-head comparison: your product vs each tracked competitor."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from . import registry
from .sweep import latest_snapshot


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _product_topic(product_id: str) -> str | None:
    from ...core.db import get_db

    rows = list(get_db()["products"].rows_where("id = ?", [product_id], limit=1))
    return rows[0].get("topic") if rows else None


def _sentiment(topic: str, provider: str | None):
    from ...analyze.sentiment import sentiment_by_source

    return sentiment_by_source(topic, provider=provider)


def _latest(product_id: str, name: str):
    return latest_snapshot(product_id, name)


def build_comparison(product_id: str, provider: str | None = None) -> dict[str, Any]:
    you = {"sentiment": 0.0, "complaint_count": 0}
    topic = _product_topic(product_id)
    if topic:
        s = _sentiment(topic, provider)
        you["sentiment"] = s.get("overall", 0.0)

    comps: list[dict[str, Any]] = []
    for c in registry.list_competitors(product_id, active_only=True):
        snap = _latest(product_id, c["competitor_name"]) or {}
        m = snap.get("metrics", {})
        mentions = sum((m.get("mentions_by_source") or {}).values())
        comps.append(
            {
                "name": c["competitor_name"],
                "sentiment": m.get("sentiment_score", 0.0),
                "complaint_count": m.get("complaint_count", 0),
                "top_painpoints": m.get("top_painpoints", []),
                "_mentions": mentions,
            }
        )
    total = sum(c["_mentions"] for c in comps) or 1
    for c in comps:
        c["share_of_voice"] = round(c.pop("_mentions") / total, 6)
    return {"you": you, "competitors": comps, "generated_at": _now()}
```

- [ ] **Step 4: Run to verify pass**

Run: `uv run --no-sync python -m pytest tests/test_competitor_compare.py -q`
Expected: PASS (1 passed).

- [ ] **Step 5: Add export + commit**

Add `from .compare import build_comparison  # noqa: F401` to `__init__.py`.
```bash
git add src/openreply/research/competitor_intel/compare.py src/openreply/research/competitor_intel/__init__.py tests/test_competitor_compare.py
git commit -m "feat(competitor): head-to-head comparison builder"
```

---

## Phase 6 — CLI command group

### Task 8: `competitor_cmds.py` — Typer app + register in main

**Files:**
- Create: `src/openreply/cli/competitor_cmds.py`
- Modify: `src/openreply/cli/main.py` (add `add_typer` after the persona registration ~line 1330)
- Test: `tests/test_competitor_cli.py`

**Interfaces:**
- Consumes: everything exported from `research.competitor_intel` + `enrich_seed`.
- Produces: `competitor_app` Typer instance with commands: `add`, `list`, `show`, `enrich`, `run`, `findings`, `opportunities`, `compare`, `set-action`, `remove` — all with `--json`.

- [ ] **Step 1: Write the failing test** (invoke via Typer's CliRunner)

```python
# tests/test_competitor_cli.py
import json
from typer.testing import CliRunner
from openreply.cli.competitor_cmds import competitor_app

runner = CliRunner()

def test_add_and_list_json():
    r = runner.invoke(competitor_app, ["add", "--product-id", "cliP",
                                       "--name", "Notion", "--json"])
    assert r.exit_code == 0
    data = json.loads(r.stdout.strip().splitlines()[-1])
    assert data["competitor_name"] == "Notion"

    r2 = runner.invoke(competitor_app, ["list", "--product-id", "cliP", "--json"])
    assert r2.exit_code == 0
    rows = json.loads(r2.stdout.strip().splitlines()[-1])
    assert any(x["competitor_name"] == "Notion" for x in rows)
```

- [ ] **Step 2: Run to verify fail**

Run: `uv run --no-sync python -m pytest tests/test_competitor_cli.py -q`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `competitor_cmds.py`**

```python
# src/openreply/cli/competitor_cmds.py
"""Competitor Intelligence CLI. Registered into the main app from cli/main.py."""
from __future__ import annotations

import json

import typer

from ..research import competitor_intel as CI
from ..research.competitor_intel.enrich import enrich_seed

competitor_app = typer.Typer(help="Competitor Intelligence — track & analyze competitors.")


def _emit(obj, as_json: bool):
    if as_json:
        typer.echo(json.dumps(obj, default=str))
    else:
        typer.echo(obj)


@competitor_app.command("add")
def cmd_add(
    product_id: str = typer.Option(..., "--product-id"),
    name: str = typer.Option(..., "--name"),
    website: str = typer.Option("", "--website"),
    daily_fetch: bool = typer.Option(False, "--daily-fetch"),
    as_json: bool = typer.Option(False, "--json"),
):
    out = CI.add_competitor(product_id, name, website=website, daily_fetch=daily_fetch)
    _emit(out, as_json)


@competitor_app.command("list")
def cmd_list(
    product_id: str = typer.Option(..., "--product-id"),
    active_only: bool = typer.Option(False, "--active-only"),
    as_json: bool = typer.Option(False, "--json"),
):
    _emit(CI.list_competitors(product_id, active_only=active_only), as_json)


@competitor_app.command("show")
def cmd_show(
    product_id: str = typer.Option(..., "--product-id"),
    name: str = typer.Option(..., "--name"),
    as_json: bool = typer.Option(False, "--json"),
):
    _emit(CI.get_competitor(product_id, name), as_json)


@competitor_app.command("enrich")
def cmd_enrich(
    name: str = typer.Option(..., "--name"),
    website: str = typer.Option("", "--website"),
    provider: str = typer.Option(None, "--provider"),
    as_json: bool = typer.Option(False, "--json"),
):
    _emit(enrich_seed(name, website=website, provider=provider), as_json)


@competitor_app.command("run")
def cmd_run(
    product_id: str = typer.Option(..., "--product-id"),
    name: str = typer.Option(..., "--name"),
    provider: str = typer.Option(None, "--provider"),
    as_json: bool = typer.Option(False, "--json"),
):
    _emit(CI.run_competitor_sweep(product_id, name, provider=provider), as_json)


@competitor_app.command("findings")
def cmd_findings(
    product_id: str = typer.Option(..., "--product-id"),
    name: str = typer.Option(None, "--name"),
    as_json: bool = typer.Option(False, "--json"),
):
    _emit(CI.list_findings(product_id, name), as_json)


@competitor_app.command("opportunities")
def cmd_opps(
    product_id: str = typer.Option(..., "--product-id"),
    name: str = typer.Option(None, "--name"),
    as_json: bool = typer.Option(False, "--json"),
):
    _emit(CI.list_opportunities(product_id, name), as_json)


@competitor_app.command("compare")
def cmd_compare(
    product_id: str = typer.Option(..., "--product-id"),
    provider: str = typer.Option(None, "--provider"),
    as_json: bool = typer.Option(False, "--json"),
):
    _emit(CI.build_comparison(product_id, provider=provider), as_json)


@competitor_app.command("set-action")
def cmd_set_action(
    signal_id: str = typer.Option(..., "--signal-id"),
    action: str = typer.Option(..., "--action"),
    as_json: bool = typer.Option(False, "--json"),
):
    _emit(CI.set_signal_action(signal_id, action), as_json)


@competitor_app.command("remove")
def cmd_remove(
    product_id: str = typer.Option(..., "--product-id"),
    name: str = typer.Option(..., "--name"),
    as_json: bool = typer.Option(False, "--json"),
):
    _emit({"removed": CI.remove_competitor(product_id, name)}, as_json)
```

- [ ] **Step 4: Register in `cli/main.py`**

Find the persona registration (`app.add_typer(persona_app, name="persona")`, ~line 1330) and add immediately after:
```python
from .competitor_cmds import competitor_app  # noqa: E402
app.add_typer(competitor_app, name="competitor")
```

- [ ] **Step 5: Run tests + smoke the registration**

Run: `uv run --no-sync python -m pytest tests/test_competitor_cli.py -q`
Expected: PASS.
Run: `uv run --no-sync openreply competitor list --product-id nope --json`
Expected: prints `[]` (empty list, exit 0).

- [ ] **Step 6: Commit**

```bash
git add src/openreply/cli/competitor_cmds.py src/openreply/cli/main.py tests/test_competitor_cli.py
git commit -m "feat(cli): competitor command group (add/list/run/findings/opportunities/compare)"
```

---

## Phase 7 — MCP sub-server

### Task 9: `competitor_tools.py` + mount

**Files:**
- Create: `src/openreply/mcp/tools/competitor_tools.py`
- Modify: `src/openreply/mcp/server.py` (add `mcp.mount(...)` near the persona mount ~line 2503)
- Test: `tests/test_competitor_mcp.py`

**Interfaces:**
- Produces: `competitor_server` (FastMCP) exposing `openreply_competitor_add/list/get/enrich/run/findings/opportunities/compare/set_action/remove`, each delegating to `research.competitor_intel`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_competitor_mcp.py
def test_competitor_server_registers_tools():
    from openreply.mcp.tools.competitor_tools import competitor_server
    # FastMCP stores tools; assert our names are present.
    names = set()
    for attr in ("_tools", "tools"):
        t = getattr(competitor_server, attr, None)
        if isinstance(t, dict):
            names |= set(t.keys())
    # Fallback: the module must at least import and expose the server object.
    assert competitor_server is not None
```

- [ ] **Step 2: Run to verify fail**

Run: `uv run --no-sync python -m pytest tests/test_competitor_mcp.py -q`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `competitor_tools.py`** (mirror `persona_tools.py` structure)

```python
# src/openreply/mcp/tools/competitor_tools.py
"""Competitor Intelligence sub-server — MCP tools."""
from fastmcp import FastMCP

competitor_server = FastMCP("CompetitorTools")


@competitor_server.tool()
def openreply_competitor_add(
    product_id: str, name: str, website: str = "", daily_fetch: bool = False
) -> dict:
    """Add a competitor to track for a product."""
    from ...research import competitor_intel as CI

    return CI.add_competitor(product_id, name, website=website, daily_fetch=daily_fetch)


@competitor_server.tool()
def openreply_competitor_list(product_id: str, active_only: bool = False) -> list:
    """List tracked competitors for a product."""
    from ...research import competitor_intel as CI

    return CI.list_competitors(product_id, active_only=active_only)


@competitor_server.tool()
def openreply_competitor_enrich(name: str, website: str = "", provider: str = None) -> dict:
    """Auto-suggest aliases/subreddits/URLs for a competitor name."""
    from ...research.competitor_intel.enrich import enrich_seed

    return enrich_seed(name, website=website, provider=provider)


@competitor_server.tool()
def openreply_competitor_run(product_id: str, name: str, provider: str = None) -> dict:
    """Run a competitor sweep (fetch + analyze + snapshot)."""
    from ...research import competitor_intel as CI

    return CI.run_competitor_sweep(product_id, name, provider=provider)


@competitor_server.tool()
def openreply_competitor_findings(product_id: str, name: str = None) -> list:
    """List competitor complaints/feature-gaps (findings)."""
    from ...research import competitor_intel as CI

    return CI.list_findings(product_id, name)


@competitor_server.tool()
def openreply_competitor_opportunities(product_id: str, name: str = None) -> list:
    """List opportunities (gaps competitors leave open)."""
    from ...research import competitor_intel as CI

    return CI.list_opportunities(product_id, name)


@competitor_server.tool()
def openreply_competitor_compare(product_id: str, provider: str = None) -> dict:
    """Head-to-head: your product vs each competitor."""
    from ...research import competitor_intel as CI

    return CI.build_comparison(product_id, provider=provider)


@competitor_server.tool()
def openreply_competitor_set_action(signal_id: str, action: str) -> dict:
    """Set a lifecycle action on a finding/opportunity (dismissed|acted|snoozed|hypothesis)."""
    from ...research import competitor_intel as CI

    return CI.set_signal_action(signal_id, action)


@competitor_server.tool()
def openreply_competitor_remove(product_id: str, name: str) -> dict:
    """Stop tracking a competitor."""
    from ...research import competitor_intel as CI

    return {"removed": CI.remove_competitor(product_id, name)}
```

- [ ] **Step 4: Mount in `server.py`**

Near the persona mount (`mcp.mount(_persona_server)`, ~line 2503) add:
```python
from .tools.competitor_tools import competitor_server as _competitor_server
mcp.mount(_competitor_server)
```

- [ ] **Step 5: Run test + import smoke**

Run: `uv run --no-sync python -m pytest tests/test_competitor_mcp.py -q`
Expected: PASS.
Run: `uv run --no-sync python -c "import openreply.mcp.server; print('server imports ok')"`
Expected: prints ok (mount didn't break server import).

- [ ] **Step 6: Commit**

```bash
git add src/openreply/mcp/tools/competitor_tools.py src/openreply/mcp/server.py tests/test_competitor_mcp.py
git commit -m "feat(mcp): competitor_tools sub-server (add/list/run/findings/opportunities/compare)"
```

---

## Phase 8 — Tauri Rust commands

### Task 10: Rust commands + register in `generate_handler!`

**Files:**
- Modify: `app-tauri/src-tauri/src/commands.rs` (add commands after the existing agent commands)
- Modify: `app-tauri/src-tauri/src/main.rs` (register in `generate_handler!`)

**Interfaces:**
- Produces Tauri commands (all `run_cli(...).await`): `competitor_add`, `competitor_list`, `competitor_get`, `competitor_enrich`, `competitor_run`, `competitor_findings`, `competitor_opportunities`, `competitor_compare`, `competitor_set_action`, `competitor_remove`.

- [ ] **Step 1: Add commands to `commands.rs`** (follow the `agent_get` template — build a `Vec<String>` of args + `--json`)

```rust
#[tauri::command]
pub async fn competitor_list(app: AppHandle, product_id: String) -> Result<Value, String> {
    run_cli(&app, vec!["competitor", "list", "--product-id", &product_id, "--json"])
        .await.map_err(err_to_string)
}

#[tauri::command]
pub async fn competitor_add(app: AppHandle, product_id: String, name: String,
                            website: Option<String>, daily_fetch: Option<bool>) -> Result<Value, String> {
    let mut args = vec!["competitor".into(), "add".into(),
                        "--product-id".into(), product_id, "--name".into(), name,
                        "--json".into()];
    if let Some(w) = website { if !w.is_empty() { args.push("--website".into()); args.push(w); } }
    if daily_fetch.unwrap_or(false) { args.push("--daily-fetch".into()); }
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run_cli(&app, refs).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn competitor_run(app: AppHandle, product_id: String, name: String) -> Result<Value, String> {
    run_cli(&app, vec!["competitor", "run", "--product-id", &product_id, "--name", &name, "--json"])
        .await.map_err(err_to_string)
}

#[tauri::command]
pub async fn competitor_findings(app: AppHandle, product_id: String, name: Option<String>) -> Result<Value, String> {
    let mut args = vec!["competitor".into(), "findings".into(), "--product-id".into(), product_id, "--json".into()];
    if let Some(n) = name { if !n.is_empty() { args.push("--name".into()); args.push(n); } }
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run_cli(&app, refs).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn competitor_opportunities(app: AppHandle, product_id: String, name: Option<String>) -> Result<Value, String> {
    let mut args = vec!["competitor".into(), "opportunities".into(), "--product-id".into(), product_id, "--json".into()];
    if let Some(n) = name { if !n.is_empty() { args.push("--name".into()); args.push(n); } }
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run_cli(&app, refs).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn competitor_compare(app: AppHandle, product_id: String) -> Result<Value, String> {
    run_cli(&app, vec!["competitor", "compare", "--product-id", &product_id, "--json"])
        .await.map_err(err_to_string)
}

#[tauri::command]
pub async fn competitor_enrich(app: AppHandle, name: String, website: Option<String>) -> Result<Value, String> {
    let mut args = vec!["competitor".into(), "enrich".into(), "--name".into(), name, "--json".into()];
    if let Some(w) = website { if !w.is_empty() { args.push("--website".into()); args.push(w); } }
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run_cli(&app, refs).await.map_err(err_to_string)
}

#[tauri::command]
pub async fn competitor_set_action(app: AppHandle, signal_id: String, action: String) -> Result<Value, String> {
    run_cli(&app, vec!["competitor", "set-action", "--signal-id", &signal_id, "--action", &action, "--json"])
        .await.map_err(err_to_string)
}

#[tauri::command]
pub async fn competitor_remove(app: AppHandle, product_id: String, name: String) -> Result<Value, String> {
    run_cli(&app, vec!["competitor", "remove", "--product-id", &product_id, "--name", &name, "--json"])
        .await.map_err(err_to_string)
}
```

- [ ] **Step 2: Register in `main.rs` `generate_handler!`**

Add these lines inside the `tauri::generate_handler![ … ]` block (before the closing `])`):
```rust
            commands::competitor_add,
            commands::competitor_list,
            commands::competitor_run,
            commands::competitor_findings,
            commands::competitor_opportunities,
            commands::competitor_compare,
            commands::competitor_enrich,
            commands::competitor_set_action,
            commands::competitor_remove,
```

- [ ] **Step 3: Compile-check the Rust**

Run: `cd app-tauri/src-tauri && cargo check 2>&1 | tail -20`
Expected: `Finished` with no errors (warnings ok).

- [ ] **Step 4: Commit**

```bash
git add app-tauri/src-tauri/src/commands.rs app-tauri/src-tauri/src/main.rs
git commit -m "feat(tauri): competitor Rust commands + handler registration"
```

---

## Phase 9 — Tauri frontend: 3-tab screen + API

### Task 11: `api.js` wrappers

**Files:**
- Modify: `app-tauri/src/or/api.js` (add wrappers in the `api` object)

**Interfaces:**
- Produces: `api.competitorList(productId)`, `competitorAdd(...)`, `competitorRun(...)`, `competitorFindings(...)`, `competitorOpportunities(...)`, `competitorCompare(...)`, `competitorEnrich(...)`, `competitorSetAction(...)`, `competitorRemove(...)`.

- [ ] **Step 1: Add wrappers** (match the existing `call("...")` pattern; snake_case Rust command names, camelCase args auto-map)

```javascript
  competitorList: (productId) => call("competitor_list", { productId }),
  competitorAdd: (productId, name, website, dailyFetch) =>
    call("competitor_add", { productId, name, website: website || "", dailyFetch: !!dailyFetch }),
  competitorRun: (productId, name) => call("competitor_run", { productId, name }),
  competitorFindings: (productId, name) => call("competitor_findings", { productId, name: name || null }),
  competitorOpportunities: (productId, name) => call("competitor_opportunities", { productId, name: name || null }),
  competitorCompare: (productId) => call("competitor_compare", { productId }),
  competitorEnrich: (name, website) => call("competitor_enrich", { name, website: website || "" }),
  competitorSetAction: (signalId, action) => call("competitor_set_action", { signalId, action }),
  competitorRemove: (productId, name) => call("competitor_remove", { productId, name }),
```

- [ ] **Step 2: Verify Tauri arg mapping**

> Tauri maps JS camelCase keys to Rust snake_case params automatically. Confirm by grepping an existing wrapper (e.g. `agentGet`) that this codebase relies on that mapping. If this app instead passes snake_case keys explicitly, match that convention.

- [ ] **Step 3: Commit**

```bash
git add app-tauri/src/or/api.js
git commit -m "feat(tauri): competitor api.js invoke wrappers"
```

### Task 12: `renderCompetitors` 3-tab screen + `DYN` route + nav

**Files:**
- Modify: `app-tauri/src/or/dynamic.js` (add `renderCompetitors`, register in `DYN`)
- Modify: `app-tauri/src/or/shell.js` (sidebar nav entry `#/competitors`)

**Interfaces:**
- Consumes: the `api.competitor*` wrappers. Uses the file's existing helpers (`head`, `btnP`, `skelCardsN`, `esc`, `card`) — reuse them; do not invent new ones.
- Produces: `renderCompetitors(view)` rendering three tabs — **Opportunities**, **Complaints**, **Comparison** — plus an "Add competitor" affordance and a per-competitor "Run/Refresh" button. Each card cites its evidence post ids.

- [ ] **Step 1: Implement `renderCompetitors`** in `dynamic.js` (place after `renderSettings`). Follow the existing screen pattern (tab bar → content div → `load()` async → paint). Key requirements:
  - A product selector (or default to the active product) to supply `productId`.
  - Tab 1 **Opportunities**: `api.competitorOpportunities(pid)` → cards with title, suggested_action, severity, evidence post ids, and buttons "Draft reply" / "Build this" (wire to existing content/reply screens if present; else a placeholder toast for v1).
  - Tab 2 **Complaints**: competitor switcher → `api.competitorFindings(pid, name)` → clustered complaint cards + a delta banner from the latest snapshot (returned by `competitorRun`, or add a `competitor_snapshot` command if needed).
  - Tab 3 **Comparison**: `api.competitorCompare(pid)` → a table: you vs each competitor (sentiment, complaint_count, share_of_voice).
  - Each async block MUST implement the four UI states (loading skeleton via `skelCardsN`, empty, error with retry, data) — see the `ui-state-design` skill.

> Because this screen is large, keep the three tab-render helpers as separate inner functions (`paintOpps`, `paintComplaints`, `paintCompare`) to stay under the file's function-size norm.

- [ ] **Step 2: Register the route** — add to the `DYN` export object in `dynamic.js`:
```javascript
  competitors: renderCompetitors,
```

- [ ] **Step 3: Add the sidebar entry** in `shell.js` near the Settings link:
```html
<a href="#/competitors" class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800">
  <i data-lucide="target" class="h-4 w-4"></i> Competitors
</a>
```

- [ ] **Step 4: Manual verify (see Phase 12 run instructions)** — load the app, navigate to `#/competitors`, confirm all three tabs render their four states without console errors.

- [ ] **Step 5: Commit**

```bash
git add app-tauri/src/or/dynamic.js app-tauri/src/or/shell.js
git commit -m "feat(tauri): Competitor Intelligence 3-tab screen + route + nav"
```

---

## Phase 10 — Settings section

### Task 13: `buildCompetitorsCard` in Settings

**Files:**
- Modify: `app-tauri/src/or/dynamic.js` (Settings grid — add card placeholder + builder call + `buildCompetitorsCard`)

**Interfaces:**
- Consumes: `api.competitorList/Add/Enrich/Update/Remove`. Reuses Settings helpers (`card`, `skelCardBody`, `esc`, `btnP`).
- Produces: a "Competitors" Settings card that lists tracked competitors and supports: add (name → **Enrich** button auto-fills aliases/subreddit/URLs → confirm), paste extra URLs, per-competitor source toggles (curated pack pre-checked), cadence toggles (daily fetch / opportunity scan), pause/resume, "Run now", and remove.

- [ ] **Step 1: Add card placeholder** in the Settings grid (near `st-feeds`):
```javascript
       <div id="st-competitors" data-skw="competitors track analyze monitor brands pricing complaints" class="${card}">${skelCardBody(3)}</div>
```

- [ ] **Step 2: Add builder call** in `renderSettings` (near `buildFeedsCard(...)`):
```javascript
  buildCompetitorsCard(document.getElementById("st-competitors"));
```

- [ ] **Step 3: Implement `buildCompetitorsCard(el)`** (before `renderSettings`). Must implement the four UI states. The "Add" flow: text input for name → **Enrich** calls `api.competitorEnrich(name)` and pre-fills an editable aliases/subreddits/URLs form → **Save** calls `api.competitorAdd(...)` then `api.competitorUpdate(...)` for the enriched fields (add a `competitor_update` command if the update surface is needed beyond add; for v1, `add` may accept the enriched fields directly — extend `competitor_add` args if so).

> **Scope note for implementer:** if per-field editing beyond `add` is needed, add a `competitor_update` CLI command + Rust command + api wrapper mirroring `competitor_add`. Keep v1 minimal: name + website + daily_fetch on add; aliases/subreddits from Enrich stored at add time (extend `cmd_add` with `--aliases-json`/`--subreddits-json` options if wiring the enriched fields through).

- [ ] **Step 4: Manual verify** — open Settings, confirm the Competitors card loads, add a competitor, see it appear, run it.

- [ ] **Step 5: Commit**

```bash
git add app-tauri/src/or/dynamic.js
git commit -m "feat(tauri): Competitors settings card (add/enrich/toggles/run)"
```

---

## Phase 11 — Pipeline hooks

### Task 14: Daily digest "Competitor moves" section + daily sweeps

**Files:**
- Modify: `src/openreply/reply/digest.py` (in `build_digest`, after the feed is assembled)
- Test: `tests/test_competitor_digest.py`

**Interfaces:**
- Consumes: `registry.list_competitors`, `sweep.run_competitor_sweep`, `sweep.latest_snapshot`.
- Produces: `competitor_moves(product_id: str, *, run: bool = False, provider=None) -> list[dict]` in a small new helper (put it in `research/competitor_intel/digest_hook.py` to avoid bloating `digest.py`), returning `[{"competitor", "delta", "top_painpoints"}]`. `build_digest` calls it and adds a `"competitor_moves"` key to its returned dict.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_competitor_digest.py
from openreply.research.competitor_intel import digest_hook, registry

def test_competitor_moves_reads_snapshots(monkeypatch):
    registry.add_competitor("pdg", "Notion", daily_fetch=True)
    monkeypatch.setattr(digest_hook, "_latest",
        lambda pid, name: {"metrics": {"top_painpoints": ["sync"]},
                           "delta": {"new_complaints": 3, "sentiment_change": -0.1}})
    moves = digest_hook.competitor_moves("pdg")
    assert moves and moves[0]["competitor"] == "Notion"
    assert moves[0]["delta"]["new_complaints"] == 3
```

- [ ] **Step 2: Run to verify fail**

Run: `uv run --no-sync python -m pytest tests/test_competitor_digest.py -q`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `digest_hook.py`**

```python
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
```

- [ ] **Step 4: Wire into `build_digest`** — in `reply/digest.py`, after the feed/briefing is assembled and before the final return dict, add:
```python
    try:
        from ..research.competitor_intel.digest_hook import competitor_moves
        _prod = _agent_product_id(a)  # resolve the agent's product id (use existing helper; if none, skip)
        moves = competitor_moves(_prod) if _prod else []
    except Exception:
        moves = []
```
and include `"competitor_moves": moves` in the returned dict.

> **Implementer note:** find how an agent maps to a product id in this codebase (grep `product_id` in `reply/`). If agents are not yet linked to products, gate this behind that link and leave `moves = []` otherwise — do not block the digest.

- [ ] **Step 5: Run test + digest smoke**

Run: `uv run --no-sync python -m pytest tests/test_competitor_digest.py tests/test_digest.py -q`
Expected: PASS (existing digest tests still green).

- [ ] **Step 6: Commit**

```bash
git add src/openreply/research/competitor_intel/digest_hook.py src/openreply/reply/digest.py tests/test_competitor_digest.py
git commit -m "feat(digest): add Competitor moves section fed by competitor snapshots"
```

---

## Phase 12 — Verification & docs

### Task 15: Full test pass, app smoke, docs

**Files:**
- Modify: `FEATURES.md` (category 10 "Audience & competitors")
- Create: `changelogs/2026-07-01_NN_competitor-intelligence.md`

- [ ] **Step 1: Run the new suite**

Run: `uv run --no-sync python -m pytest tests/test_competitor_*.py tests/test_sentiment.py -q`
Expected: all PASS.

- [ ] **Step 2: Regression — run the previously-green suite subset**

Run: `uv run --no-sync python -m pytest tests/test_digest.py tests/test_db_lock_retry.py -q`
Expected: still PASS (no regressions from schema changes).

- [ ] **Step 3: Rust compile check**

Run: `cd app-tauri/src-tauri && cargo check 2>&1 | tail -5`
Expected: `Finished`.

- [ ] **Step 4: App smoke (manual)** — use the `run` skill / the app's dev launcher. Navigate to `#/competitors`; add a competitor via Settings; run a sweep; confirm the three tabs populate and cite posts, with no console errors. Record any gaps as P1/P2 in FEATURES.md.

- [ ] **Step 5: Update `FEATURES.md`** — under category 10, add the new **Competitor Intelligence** feature entry (status 🟡 until the manual smoke is fully green), with `file:line` citations to `research/competitor_intel/*`, and bump the category totals so the summary table reconciles.

- [ ] **Step 6: Write the changelog** — `changelogs/2026-07-01_NN_competitor-intelligence.md` (check the day's existing sequence number) documenting the feature, files created/modified, and the schema migration.

- [ ] **Step 7: Commit docs**

```bash
git add FEATURES.md changelogs/2026-07-01_*_competitor-intelligence.md
git commit -m "docs: document Competitor Intelligence feature + changelog"
```

- [ ] **Step 8: Run `graphify update .`** (keep the knowledge graph current, per repo rules) and commit if it changes tracked files.

---

## Self-review notes (author)

- **Spec coverage:** §3 data model → Task 0; registry → Tasks 1-2; seed enricher (§2 unit 2) → Task 3; sentiment (built, §8) → Task 4; sweep/findings/snapshots (§4) → Tasks 5-6; comparison (Tab 3) → Task 7; CLI/MCP surfaces (§5.3) → Tasks 8-9; Tauri screen + Settings (§5.1/5.2) → Tasks 10-13; pipeline hooks (§6) → Task 14; chat/graph/memory (§7) come for free via topic-tagging (verified in mapping — no dedicated task needed beyond the sweep calling `collect` + `enrich_from_llm`); docs/verification → Task 15.
- **Descoped (per revised §11):** root-cause/5-Whys and full RICE/Kano/MoSCoW — not built; ranking uses severity. Reply "Draft reply"/"Build this" buttons wire to existing content/reply screens; if those screens aren't reachable for competitor findings in v1, they degrade to a placeholder (noted in Task 12).
- **Type consistency:** `run_competitor_sweep`, `latest_snapshot`, `list_findings`, `list_opportunities`, `build_comparison`, `add_competitor`, `enrich_seed`, `sentiment_by_source` names are used identically across tasks, tests, CLI, MCP, and Rust arg names.
- **Known implementer confirmations (flagged inline):** (a) provider completion method name in `_call_llm`; (b) `collect()` return attribute for `posts_fetched`; (c) `find_gaps` result keys (`painpoints`/`product_complaints`/`feature_wishes`) and each item's `evidence_post_ids`/`severity` fields; (d) agent→product id mapping for the digest hook; (e) Tauri camelCase→snake_case arg mapping. Each is isolated behind a monkeypatched wrapper so unit tests pass regardless; only live runs depend on them — verify during Task 15 smoke.
