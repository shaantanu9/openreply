# last30days Source Layer — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 8 new data-source adapters (Polymarket, TruthSocial, Digg, TikTok, Instagram, Threads, Pinterest, X/Twitter) to Gap Map's collect pipeline, configurable from `.env` and the frontend Settings BYOK modal, each gracefully skipped when its key/binary is missing.

**Architecture:** Each source is a `src/gapmap/sources/<name>.py` module exposing `fetch_<name>(query, limit)` that returns Gap Map's common posts-row dict and returns `[{"_error": "..."}]` when unconfigured. Keyed sources read `os.getenv`. Adapters register via a `run_<name>` wrapper in `collect_adapter.py` `SOURCES`. The 6 new keys are added to the Rust BYOK allowlist + status and to the `byok.js` modal. The 4 ScrapeCreators sources share a `_scrapecreators.py` request helper. X resolves through a backend chain (cookie-extract → bird/Node → xAI → Xquik).

**Tech Stack:** Python 3.12 + httpx (sources), pytest + monkeypatch (tests), Rust/Tauri (`commands.rs` BYOK), vanilla JS (`byok.js`, `collect.js`), behavior ported from `/Users/shantanubombatkar/Documents/GitHub/fintech_repos/last30days-skill/skills/last30days/scripts/lib/`.

---

## Conventions (read once before any task)

**The posts-row shape** every `fetch_*` must return (one dict per item). Copied from `sources/producthunt.py:_row`:

```python
{
    "id": "<source>_<stable_id>",   # globally unique; prefix avoids cross-source collision
    "sub": "<source>",               # coarse bucket label
    "source_type": "<source>",       # the source_type tag (polymarket/x/tiktok/…)
    "author": "<handle or [anon]>",
    "title": "<≤200 chars>",
    "selftext": "<body text>",
    "url": "<canonical web url>",
    "score": 0,                       # engagement int (likes/votes/volume/favourites)
    "upvote_ratio": None,
    "num_comments": 0,
    "created_utc": 0.0,               # unix seconds; 0.0 if unknown
    "is_self": 1,
    "over_18": 0,
    "flair": "",                      # short tag string, e.g. "views=12000"
    "permalink": "<url>",
    "fetched_at": _now_iso(),
}
```

**Shared mini-helper** (paste into each new source module):

```python
from datetime import datetime, timezone

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")
```

**Graceful-skip contract:** if the key/binary is missing, return a single-element
list `[{"_error": "<actionable message>"}]`. Never raise. `collect_adapter.py`
filters `_error` rows before `_persist` (confirmed at `collect_adapter.py:244`).

**Test pattern** (no network — monkeypatch the module's HTTP call). All source
tests live in `tests/test_<name>.py`. Template:

```python
import gapmap.sources.<name> as mod

class _FakeResp:
    def __init__(self, payload, status=200):
        self._payload = payload
        self.status_code = status
    def json(self): return self._payload
    def raise_for_status(self): pass

def test_<name>_missing_key_skips(monkeypatch):
    monkeypatch.delenv("<ENV_KEY>", raising=False)
    rows = mod.fetch_<name>("test", limit=5)
    assert rows == [] or (len(rows) == 1 and "_error" in rows[0])

def test_<name>_maps_rows(monkeypatch):
    monkeypatch.setenv("<ENV_KEY>", "x")  # omit for keyless sources
    monkeypatch.setattr(mod.httpx, "get", lambda *a, **k: _FakeResp(<FIXTURE>))
    rows = mod.fetch_<name>("test", limit=5)
    assert rows and rows[0]["source_type"] == "<name>"
    assert "id" in rows[0] and "score" in rows[0]
```

**Reference dir** (cited as `REF/<file>` below):
`/Users/shantanubombatkar/Documents/GitHub/fintech_repos/last30days-skill/skills/last30days/scripts/lib/`

**Run tests with:** `python3 -m pytest tests/test_<name>.py -v` from repo root.

---

## Task 1: Polymarket adapter (keyless — proves the loop)

**Files:**
- Create: `src/gapmap/sources/polymarket.py`
- Test: `tests/test_polymarket.py`
- Reference: `REF/polymarket.py` (Gamma `/public-search`, `_parse_outcome_prices`, `_format_price_movement`)

- [ ] **Step 1: Write the failing test**

```python
# tests/test_polymarket.py
import gapmap.sources.polymarket as mod

class _FakeResp:
    def __init__(self, payload, status=200):
        self._payload, self.status_code = payload, status
    def json(self): return self._payload
    def raise_for_status(self): pass

_FIXTURE = {
    "events": [{
        "title": "Will X happen by 2026?",
        "slug": "will-x-happen",
        "volume": 66000,
        "markets": [{
            "outcomes": "[\"Yes\", \"No\"]",
            "outcomePrices": "[\"0.74\", \"0.26\"]",
            "volume": 66000,
            "oneMonthPriceChange": 0.12,
        }],
    }]
}

def test_polymarket_maps_rows(monkeypatch):
    monkeypatch.setattr(mod.httpx, "get", lambda *a, **k: _FakeResp(_FIXTURE))
    rows = mod.fetch_polymarket("X", limit=5)
    assert rows and rows[0]["source_type"] == "polymarket"
    assert rows[0]["score"] == 66000
    assert "74" in rows[0]["selftext"]  # Yes odds rendered as %
    assert rows[0]["url"].endswith("will-x-happen")

def test_polymarket_empty_on_http_error(monkeypatch):
    def _boom(*a, **k): raise mod.httpx.HTTPError("down")
    monkeypatch.setattr(mod.httpx, "get", _boom)
    assert mod.fetch_polymarket("X", limit=5) == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_polymarket.py -v`
Expected: FAIL — `ModuleNotFoundError: gapmap.sources.polymarket`

- [ ] **Step 3: Write the implementation**

```python
# src/gapmap/sources/polymarket.py
"""Polymarket prediction-market search via the public Gamma API.

No API key required (public read-only, generous rate limits). Behavior
ported from last30days lib/polymarket.py: search events, render the Yes/No
outcome odds as percentages, use market volume as the engagement score.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

import httpx

_GAMMA_SEARCH = "https://gamma-api.polymarket.com/public-search"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _odds_text(markets: list[dict]) -> str:
    """Render 'Yes 74% · No 26%' from the first market's outcome prices.

    Both `outcomes` and `outcomePrices` arrive as JSON-encoded strings
    (Gamma quirk) — parse defensively.
    """
    if not markets:
        return ""
    m = markets[0]
    try:
        outs = m.get("outcomes")
        prices = m.get("outcomePrices")
        outs = json.loads(outs) if isinstance(outs, str) else (outs or [])
        prices = json.loads(prices) if isinstance(prices, str) else (prices or [])
    except (ValueError, TypeError):
        return ""
    parts = []
    for name, price in zip(outs, prices):
        try:
            pct = round(float(price) * 100)
        except (ValueError, TypeError):
            continue
        parts.append(f"{name} {pct}%")
    return " · ".join(parts)


def _row(ev: dict[str, Any]) -> dict[str, Any]:
    markets = ev.get("markets") or []
    slug = ev.get("slug") or ""
    vol = ev.get("volume") or (markets[0].get("volume") if markets else 0) or 0
    return {
        "id": f"pm_{slug or ev.get('id') or ev.get('title','')[:40]}",
        "sub": "polymarket",
        "source_type": "polymarket",
        "author": "[market]",
        "title": (ev.get("title") or "")[:200],
        "selftext": _odds_text(markets),
        "url": f"https://polymarket.com/event/{slug}" if slug else "",
        "score": int(vol or 0),
        "upvote_ratio": None,
        "num_comments": 0,
        "created_utc": 0.0,
        "is_self": 1,
        "over_18": 0,
        "flair": "prediction-market",
        "permalink": f"https://polymarket.com/event/{slug}" if slug else "",
        "fetched_at": _now_iso(),
    }


def fetch_polymarket(query: str, limit: int = 20) -> list[dict]:
    try:
        r = httpx.get(
            _GAMMA_SEARCH,
            params={"q": query, "limit_per_type": min(50, limit)},
            timeout=20,
        )
        r.raise_for_status()
    except httpx.HTTPError:
        return []
    events = ((r.json() or {}).get("events")) or []
    return [_row(e) for e in events[:limit]]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest tests/test_polymarket.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add src/gapmap/sources/polymarket.py tests/test_polymarket.py
git commit -m "feat(sources): add Polymarket prediction-market adapter"
```

---

## Task 2: TruthSocial adapter (TRUTHSOCIAL_TOKEN)

**Files:**
- Create: `src/gapmap/sources/truthsocial.py`
- Test: `tests/test_truthsocial.py`
- Reference: `REF/truthsocial.py` (`/api/v2/search?type=statuses`, `parse_truthsocial_response`, `_strip_html`)

- [ ] **Step 1: Write the failing test**

```python
# tests/test_truthsocial.py
import gapmap.sources.truthsocial as mod

class _FakeResp:
    def __init__(self, payload, status=200):
        self._payload, self.status_code = payload, status
    def json(self): return self._payload
    def raise_for_status(self): pass

_FIXTURE = {"statuses": [{
    "id": "111",
    "content": "<p>Big news <br/>today</p>",
    "url": "https://truthsocial.com/@x/posts/111",
    "favourites_count": 42,
    "reblogs_count": 3,
    "replies_count": 7,
    "created_at": "2026-06-01T12:00:00.000Z",
    "account": {"acct": "realX", "display_name": "Real X"},
}]}

def test_truthsocial_missing_token_skips(monkeypatch):
    monkeypatch.delenv("TRUTHSOCIAL_TOKEN", raising=False)
    rows = mod.fetch_truthsocial("news", limit=5)
    assert len(rows) == 1 and "_error" in rows[0]

def test_truthsocial_maps_rows(monkeypatch):
    monkeypatch.setenv("TRUTHSOCIAL_TOKEN", "tok")
    monkeypatch.setattr(mod.httpx, "get", lambda *a, **k: _FakeResp(_FIXTURE))
    rows = mod.fetch_truthsocial("news", limit=5)
    assert rows[0]["source_type"] == "truthsocial"
    assert rows[0]["score"] == 42
    assert rows[0]["author"] == "realX"
    assert "Big news" in rows[0]["selftext"] and "<p>" not in rows[0]["selftext"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_truthsocial.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Write the implementation**

```python
# src/gapmap/sources/truthsocial.py
"""Truth Social search via its Mastodon-compatible API.

Requires TRUTHSOCIAL_TOKEN (bearer token copied from browser dev tools).
Without it, degrades gracefully to a single _error row. Ported from
last30days lib/truthsocial.py.
"""
from __future__ import annotations

import os
import re
from datetime import datetime, timezone
from typing import Any

import httpx

_SEARCH_URL = "https://truthsocial.com/api/v2/search"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _token() -> str | None:
    return os.getenv("TRUTHSOCIAL_TOKEN") or None


def _strip_html(html: str) -> str:
    text = re.sub(r"<br\s*/?>", "\n", html or "")
    text = re.sub(r"<[^>]+>", "", text)
    return text.strip()


def _ts(created: str) -> float:
    try:
        return datetime.fromisoformat((created or "").replace("Z", "+00:00")).timestamp()
    except (ValueError, AttributeError):
        return 0.0


def _row(s: dict[str, Any]) -> dict[str, Any]:
    acct = s.get("account") or {}
    handle = acct.get("acct") or acct.get("username") or "[anon]"
    text = _strip_html(s.get("content") or "")
    return {
        "id": f"ts_{s.get('id')}",
        "sub": "truthsocial",
        "source_type": "truthsocial",
        "author": handle,
        "title": text[:200] or f"Truth by {handle}",
        "selftext": text,
        "url": s.get("url") or "",
        "score": int(s.get("favourites_count") or 0),
        "upvote_ratio": None,
        "num_comments": int(s.get("replies_count") or 0),
        "created_utc": _ts(s.get("created_at") or ""),
        "is_self": 1,
        "over_18": 0,
        "flair": f"reblogs={int(s.get('reblogs_count') or 0)}",
        "permalink": s.get("url") or "",
        "fetched_at": _now_iso(),
    }


def fetch_truthsocial(query: str, limit: int = 30) -> list[dict]:
    tok = _token()
    if not tok:
        return [{"_error": "TRUTHSOCIAL_TOKEN not set — copy the bearer token from "
                 "truthsocial.com browser dev tools (Network tab)"}]
    try:
        r = httpx.get(
            _SEARCH_URL,
            params={"q": query, "type": "statuses", "limit": str(min(40, limit))},
            headers={"Authorization": f"Bearer {tok}"},
            timeout=30,
        )
        r.raise_for_status()
    except httpx.HTTPError:
        return []
    statuses = ((r.json() or {}).get("statuses")) or []
    return [_row(s) for s in statuses[:limit]]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest tests/test_truthsocial.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add src/gapmap/sources/truthsocial.py tests/test_truthsocial.py
git commit -m "feat(sources): add Truth Social adapter (TRUTHSOCIAL_TOKEN)"
```

---

## Task 3: Digg adapter (digg-pp-cli on PATH)

**Files:**
- Create: `src/gapmap/sources/digg.py`
- Test: `tests/test_digg.py`
- Reference: `REF/digg.py` (`_build_search_args`, `_run_cli`, `parse_digg_response`, `_build_url`)

- [ ] **Step 1: Write the failing test**

```python
# tests/test_digg.py
import json
import gapmap.sources.digg as mod

_CLI_OUT = json.dumps({"results": [{
    "clusterUrlId": "abc123",
    "title": "AI agents go mainstream",
    "tldr": "Everyone is shipping agents.",
    "rank": 3,
    "postCount": 40,
    "uniqueAuthors": 25,
}]})

def test_digg_missing_binary_skips(monkeypatch):
    monkeypatch.setattr(mod.shutil, "which", lambda _b: None)
    rows = mod.fetch_digg("ai agents", limit=5)
    assert len(rows) == 1 and "_error" in rows[0]

def test_digg_maps_rows(monkeypatch):
    monkeypatch.setattr(mod.shutil, "which", lambda _b: "/usr/local/bin/digg-pp-cli")
    monkeypatch.setattr(mod, "_run_cli", lambda *a, **k: json.loads(_CLI_OUT))
    rows = mod.fetch_digg("ai agents", limit=5)
    assert rows[0]["source_type"] == "digg"
    assert rows[0]["url"].endswith("abc123")
    assert "Everyone is shipping" in rows[0]["selftext"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_digg.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Write the implementation**

```python
# src/gapmap/sources/digg.py
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest tests/test_digg.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add src/gapmap/sources/digg.py tests/test_digg.py
git commit -m "feat(sources): add Digg AI-1000 adapter (digg-pp-cli gate)"
```

---

## Task 4: ScrapeCreators shared request helper

**Files:**
- Create: `src/gapmap/sources/_scrapecreators.py`
- Test: `tests/test_scrapecreators_helper.py`
- Reference: `REF/tiktok.py`, `REF/instagram.py` (`SCRAPECREATORS_API_KEY`, base `https://api.scrapecreators.com`, header `x-api-key`)

- [ ] **Step 1: Write the failing test**

```python
# tests/test_scrapecreators_helper.py
import gapmap.sources._scrapecreators as sc

def test_key_missing_returns_none(monkeypatch):
    monkeypatch.delenv("SCRAPECREATORS_API_KEY", raising=False)
    assert sc.api_key() is None

def test_error_row_shape():
    row = sc.error_row("tiktok")
    assert "_error" in row and "SCRAPECREATORS_API_KEY" in row["_error"]

def test_get_passes_key_header(monkeypatch):
    captured = {}
    monkeypatch.setenv("SCRAPECREATORS_API_KEY", "k1")
    class _R:
        status_code = 200
        def json(self): return {"ok": True}
        def raise_for_status(self): pass
    def _fake_get(url, **kw):
        captured.update(kw); captured["url"] = url
        return _R()
    monkeypatch.setattr(sc.httpx, "get", _fake_get)
    out = sc.get("/v1/tiktok/search", params={"query": "x"})
    assert out == {"ok": True}
    assert captured["headers"]["x-api-key"] == "k1"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_scrapecreators_helper.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Write the implementation**

```python
# src/gapmap/sources/_scrapecreators.py
"""Shared ScrapeCreators request helper for the TikTok / Instagram /
Threads / Pinterest adapters. One key (SCRAPECREATORS_API_KEY) powers all
four; 100 free credits then PAYG. Header auth is `x-api-key`.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone

import httpx

BASE = "https://api.scrapecreators.com"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def api_key() -> str | None:
    return os.getenv("SCRAPECREATORS_API_KEY") or None


def error_row(source: str) -> dict:
    return {"_error": f"SCRAPECREATORS_API_KEY not set — required for {source}. "
            "Get a key at scrapecreators.com (100 free credits, then pay-as-you-go)."}


def get(path: str, *, params: dict, timeout: float = 30.0) -> dict | None:
    """GET BASE+path with the key header. Returns parsed JSON, or None on
    any HTTP error (caller maps None → []). Returns None if no key."""
    key = api_key()
    if not key:
        return None
    try:
        r = httpx.get(
            f"{BASE}{path}",
            params=params,
            headers={"x-api-key": key},
            timeout=timeout,
        )
        r.raise_for_status()
    except httpx.HTTPError:
        return None
    return r.json() or {}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest tests/test_scrapecreators_helper.py -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add src/gapmap/sources/_scrapecreators.py tests/test_scrapecreators_helper.py
git commit -m "feat(sources): add shared ScrapeCreators request helper"
```

---

## Task 5: TikTok adapter

**Files:**
- Create: `src/gapmap/sources/tiktok.py`
- Test: `tests/test_tiktok.py`
- Reference: `REF/tiktok.py` — endpoint `/v1/tiktok/search`. **Port the exact response-JSON key extraction from `REF/tiktok.py`'s search-parse block** (the `_row` below uses the documented engagement fields; verify field names like `aweme_id`, `desc`, `statistics.digg_count/play_count/comment_count`, `author.unique_id` against that file and adjust the `.get()` paths if ScrapeCreators changed them).

- [ ] **Step 1: Write the failing test**

```python
# tests/test_tiktok.py
import gapmap.sources.tiktok as mod

_FIXTURE = {"search_item_list": [{
    "aweme_info": {
        "aweme_id": "7311",
        "desc": "best ai tools #ai",
        "share_url": "https://www.tiktok.com/@x/video/7311",
        "statistics": {"digg_count": 1200, "play_count": 50000, "comment_count": 30},
        "author": {"unique_id": "creatorx"},
        "create_time": 1717200000,
    }
}]}

def test_tiktok_missing_key_skips(monkeypatch):
    monkeypatch.delenv("SCRAPECREATORS_API_KEY", raising=False)
    rows = mod.fetch_tiktok("ai tools", limit=5)
    assert len(rows) == 1 and "_error" in rows[0]

def test_tiktok_maps_rows(monkeypatch):
    monkeypatch.setenv("SCRAPECREATORS_API_KEY", "k")
    monkeypatch.setattr(mod.sc, "get", lambda *a, **k: _FIXTURE)
    rows = mod.fetch_tiktok("ai tools", limit=5)
    assert rows[0]["source_type"] == "tiktok"
    assert rows[0]["score"] == 1200
    assert rows[0]["author"] == "creatorx"
    assert "views=50000" in rows[0]["flair"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_tiktok.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Write the implementation**

```python
# src/gapmap/sources/tiktok.py
"""TikTok keyword search via ScrapeCreators. Score = likes (digg_count),
views in flair. Ported from last30days lib/tiktok.py.
"""
from __future__ import annotations

from typing import Any

from . import _scrapecreators as sc


def _row(info: dict[str, Any]) -> dict[str, Any]:
    stats = info.get("statistics") or {}
    author = (info.get("author") or {}).get("unique_id") or "[anon]"
    desc = (info.get("desc") or "").strip()
    aid = info.get("aweme_id") or ""
    return {
        "id": f"tt_{aid}",
        "sub": "tiktok",
        "source_type": "tiktok",
        "author": author,
        "title": desc[:200] or f"TikTok by {author}",
        "selftext": desc,
        "url": info.get("share_url") or f"https://www.tiktok.com/@{author}/video/{aid}",
        "score": int(stats.get("digg_count") or 0),
        "upvote_ratio": None,
        "num_comments": int(stats.get("comment_count") or 0),
        "created_utc": float(info.get("create_time") or 0),
        "is_self": 1,
        "over_18": 0,
        "flair": f"views={int(stats.get('play_count') or 0)}",
        "permalink": info.get("share_url") or "",
        "fetched_at": sc.now_iso(),
    }


def fetch_tiktok(query: str, limit: int = 20) -> list[dict]:
    if sc.api_key() is None:
        return [sc.error_row("TikTok")]
    data = sc.get("/v1/tiktok/search", params={"query": query})
    if data is None:
        return []
    items = data.get("search_item_list") or []
    out = []
    for it in items[:limit]:
        info = it.get("aweme_info") or it
        if info.get("aweme_id"):
            out.append(_row(info))
    return out
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest tests/test_tiktok.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add src/gapmap/sources/tiktok.py tests/test_tiktok.py
git commit -m "feat(sources): add TikTok adapter (ScrapeCreators)"
```

---

## Task 6: Instagram (Reels) adapter

**Files:**
- Create: `src/gapmap/sources/instagram.py`
- Test: `tests/test_instagram.py`
- Reference: `REF/instagram.py` — endpoint `/v1/instagram/search` (verify path + JSON keys `like_count`, `play_count`, `comment_count`, `caption.text`, `user.username`, `code`/`shortcode` against the file).

- [ ] **Step 1: Write the failing test**

```python
# tests/test_instagram.py
import gapmap.sources.instagram as mod

_FIXTURE = {"items": [{
    "id": "991",
    "code": "Cabc",
    "caption": {"text": "ai reel"},
    "like_count": 800,
    "play_count": 12000,
    "comment_count": 12,
    "user": {"username": "iguser"},
    "taken_at": 1717200000,
}]}

def test_instagram_missing_key_skips(monkeypatch):
    monkeypatch.delenv("SCRAPECREATORS_API_KEY", raising=False)
    rows = mod.fetch_instagram("ai", limit=5)
    assert len(rows) == 1 and "_error" in rows[0]

def test_instagram_maps_rows(monkeypatch):
    monkeypatch.setenv("SCRAPECREATORS_API_KEY", "k")
    monkeypatch.setattr(mod.sc, "get", lambda *a, **k: _FIXTURE)
    rows = mod.fetch_instagram("ai", limit=5)
    assert rows[0]["source_type"] == "instagram"
    assert rows[0]["score"] == 800
    assert rows[0]["url"].endswith("Cabc/")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_instagram.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Write the implementation**

```python
# src/gapmap/sources/instagram.py
"""Instagram Reels keyword search via ScrapeCreators. Score = like_count,
views (play_count) in flair. Ported from last30days lib/instagram.py.
"""
from __future__ import annotations

from typing import Any

from . import _scrapecreators as sc


def _row(it: dict[str, Any]) -> dict[str, Any]:
    user = (it.get("user") or {}).get("username") or "[anon]"
    cap = ((it.get("caption") or {}).get("text") or "").strip()
    code = it.get("code") or it.get("shortcode") or ""
    return {
        "id": f"ig_{it.get('id') or code}",
        "sub": "instagram",
        "source_type": "instagram",
        "author": user,
        "title": cap[:200] or f"Reel by {user}",
        "selftext": cap,
        "url": f"https://www.instagram.com/reel/{code}/" if code else "",
        "score": int(it.get("like_count") or 0),
        "upvote_ratio": None,
        "num_comments": int(it.get("comment_count") or 0),
        "created_utc": float(it.get("taken_at") or 0),
        "is_self": 1,
        "over_18": 0,
        "flair": f"views={int(it.get('play_count') or 0)}",
        "permalink": f"https://www.instagram.com/reel/{code}/" if code else "",
        "fetched_at": sc.now_iso(),
    }


def fetch_instagram(query: str, limit: int = 20) -> list[dict]:
    if sc.api_key() is None:
        return [sc.error_row("Instagram")]
    data = sc.get("/v1/instagram/search", params={"query": query})
    if data is None:
        return []
    items = data.get("items") or data.get("results") or []
    return [_row(it) for it in items[:limit] if (it.get("id") or it.get("code"))]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest tests/test_instagram.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add src/gapmap/sources/instagram.py tests/test_instagram.py
git commit -m "feat(sources): add Instagram Reels adapter (ScrapeCreators)"
```

---

## Task 7: Threads adapter

**Files:**
- Create: `src/gapmap/sources/threads.py`
- Test: `tests/test_threads.py`
- Reference: `REF/threads.py` — endpoint `/v1/threads/search` (verify keys `caption.text`/`text`, `like_count`, `reply_count`, `username`, `code`).

- [ ] **Step 1: Write the failing test**

```python
# tests/test_threads.py
import gapmap.sources.threads as mod

_FIXTURE = {"posts": [{
    "id": "55", "code": "Tabc",
    "text": "threads take on ai",
    "like_count": 60, "reply_count": 4,
    "username": "thuser", "taken_at": 1717200000,
}]}

def test_threads_missing_key_skips(monkeypatch):
    monkeypatch.delenv("SCRAPECREATORS_API_KEY", raising=False)
    rows = mod.fetch_threads("ai", limit=5)
    assert len(rows) == 1 and "_error" in rows[0]

def test_threads_maps_rows(monkeypatch):
    monkeypatch.setenv("SCRAPECREATORS_API_KEY", "k")
    monkeypatch.setattr(mod.sc, "get", lambda *a, **k: _FIXTURE)
    rows = mod.fetch_threads("ai", limit=5)
    assert rows[0]["source_type"] == "threads"
    assert rows[0]["score"] == 60 and rows[0]["author"] == "thuser"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_threads.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Write the implementation**

```python
# src/gapmap/sources/threads.py
"""Threads keyword search via ScrapeCreators. Score = like_count.
Ported from last30days lib/threads.py.
"""
from __future__ import annotations

from typing import Any

from . import _scrapecreators as sc


def _row(p: dict[str, Any]) -> dict[str, Any]:
    user = p.get("username") or "[anon]"
    text = (p.get("text") or (p.get("caption") or {}).get("text") or "").strip()
    code = p.get("code") or ""
    return {
        "id": f"th_{p.get('id') or code}",
        "sub": "threads",
        "source_type": "threads",
        "author": user,
        "title": text[:200] or f"Thread by {user}",
        "selftext": text,
        "url": f"https://www.threads.net/@{user}/post/{code}" if code else "",
        "score": int(p.get("like_count") or 0),
        "upvote_ratio": None,
        "num_comments": int(p.get("reply_count") or 0),
        "created_utc": float(p.get("taken_at") or 0),
        "is_self": 1,
        "over_18": 0,
        "flair": "",
        "permalink": f"https://www.threads.net/@{user}/post/{code}" if code else "",
        "fetched_at": sc.now_iso(),
    }


def fetch_threads(query: str, limit: int = 20) -> list[dict]:
    if sc.api_key() is None:
        return [sc.error_row("Threads")]
    data = sc.get("/v1/threads/search", params={"query": query})
    if data is None:
        return []
    items = data.get("posts") or data.get("results") or []
    return [_row(p) for p in items[:limit] if (p.get("id") or p.get("code"))]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest tests/test_threads.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add src/gapmap/sources/threads.py tests/test_threads.py
git commit -m "feat(sources): add Threads adapter (ScrapeCreators)"
```

---

## Task 8: Pinterest adapter

**Files:**
- Create: `src/gapmap/sources/pinterest.py`
- Test: `tests/test_pinterest.py`
- Reference: `REF/pinterest.py` — endpoint `/v1/pinterest/search` (verify keys `id`, `title`/`grid_title`, `description`, `repin_count` (saves), `pinner.username`, `board.name`).

- [ ] **Step 1: Write the failing test**

```python
# tests/test_pinterest.py
import gapmap.sources.pinterest as mod

_FIXTURE = {"results": [{
    "id": "99", "grid_title": "AI workflow",
    "description": "a useful pin about ai",
    "repin_count": 300, "comment_count": 2,
    "pinner": {"username": "pinuser"}, "board": {"name": "AI"},
}]}

def test_pinterest_missing_key_skips(monkeypatch):
    monkeypatch.delenv("SCRAPECREATORS_API_KEY", raising=False)
    rows = mod.fetch_pinterest("ai", limit=5)
    assert len(rows) == 1 and "_error" in rows[0]

def test_pinterest_maps_rows(monkeypatch):
    monkeypatch.setenv("SCRAPECREATORS_API_KEY", "k")
    monkeypatch.setattr(mod.sc, "get", lambda *a, **k: _FIXTURE)
    rows = mod.fetch_pinterest("ai", limit=5)
    assert rows[0]["source_type"] == "pinterest"
    assert "saves=300" in rows[0]["flair"]
    assert rows[0]["url"].endswith("/pin/99/")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_pinterest.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Write the implementation**

```python
# src/gapmap/sources/pinterest.py
"""Pinterest keyword search via ScrapeCreators. Saves (repin_count) are
the engagement signal. Ported from last30days lib/pinterest.py.
"""
from __future__ import annotations

from typing import Any

from . import _scrapecreators as sc


def _row(p: dict[str, Any]) -> dict[str, Any]:
    pid = p.get("id") or ""
    desc = (p.get("description") or "").strip()
    title = (p.get("title") or p.get("grid_title") or desc[:80]).strip()
    user = (p.get("pinner") or {}).get("username") or "[anon]"
    return {
        "id": f"pin_{pid}",
        "sub": "pinterest",
        "source_type": "pinterest",
        "author": user,
        "title": title[:200] or f"Pin {pid}",
        "selftext": desc,
        "url": f"https://www.pinterest.com/pin/{pid}/" if pid else "",
        "score": int(p.get("repin_count") or 0),
        "upvote_ratio": None,
        "num_comments": int(p.get("comment_count") or 0),
        "created_utc": 0.0,
        "is_self": 1,
        "over_18": 0,
        "flair": f"saves={int(p.get('repin_count') or 0)}",
        "permalink": f"https://www.pinterest.com/pin/{pid}/" if pid else "",
        "fetched_at": sc.now_iso(),
    }


def fetch_pinterest(query: str, limit: int = 20) -> list[dict]:
    if sc.api_key() is None:
        return [sc.error_row("Pinterest")]
    data = sc.get("/v1/pinterest/search", params={"query": query})
    if data is None:
        return []
    items = data.get("results") or data.get("pins") or []
    return [_row(p) for p in items[:limit] if p.get("id")]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest tests/test_pinterest.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add src/gapmap/sources/pinterest.py tests/test_pinterest.py
git commit -m "feat(sources): add Pinterest adapter (ScrapeCreators)"
```

---

## Task 9: Browser cookie extraction helper (for X auth)

**Files:**
- Create: `src/gapmap/sources/_cookie_extract.py`
- Test: `tests/test_cookie_extract.py`
- Reference: `REF/cookie_extract.py` (stdlib-only Firefox/Chrome/Brave/Safari cookie reading). For Phase 1 port **only** the function that returns X's `auth_token` + `ct0` cookies; full multi-browser support can be trimmed to whatever `REF/cookie_extract.py` exposes as the X entrypoint.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_cookie_extract.py
import gapmap.sources._cookie_extract as ce

def test_returns_none_when_no_cookies(monkeypatch):
    # Force every browser path to find nothing.
    monkeypatch.setattr(ce, "_extract_x_cookies_all_browsers", lambda: {})
    assert ce.x_auth_from_browsers() is None

def test_returns_pair_when_present(monkeypatch):
    monkeypatch.setattr(
        ce, "_extract_x_cookies_all_browsers",
        lambda: {"auth_token": "AAA", "ct0": "BBB"},
    )
    out = ce.x_auth_from_browsers()
    assert out == {"auth_token": "AAA", "ct0": "BBB"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_cookie_extract.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Write the implementation**

Port the browser cookie-store reading from `REF/cookie_extract.py` (stdlib
`sqlite3` over the Chrome/Brave/Firefox/Safari cookie DBs). Public surface
required by the test and Task 10:

```python
# src/gapmap/sources/_cookie_extract.py
"""Best-effort extraction of X/Twitter auth cookies (auth_token + ct0)
from local browser stores, so X search works with zero config when the
user is logged into x.com. Stdlib only. Any failure (locked DB, missing
Full Disk Access on Safari, encrypted Chrome cookies) is non-fatal and
returns {} — the X adapter then falls back to env keys.

Ported from last30days lib/cookie_extract.py (MIT). Trim to the X path.
"""
from __future__ import annotations

# ... port _is_wsl, profile-dir discovery, and the per-browser sqlite3
# readers from REF/cookie_extract.py. Each reader looks up cookies for
# host '.x.com'/'.twitter.com' named 'auth_token' and 'ct0'.

def _extract_x_cookies_all_browsers() -> dict:
    """Try each installed browser; return the first {'auth_token','ct0'}
    pair found, else {}. Never raises."""
    # for reader in (_chrome, _brave, _firefox, _safari): try/except → merge
    return {}


def x_auth_from_browsers() -> dict | None:
    """Return {'auth_token','ct0'} if both present, else None."""
    pair = _extract_x_cookies_all_browsers()
    if pair.get("auth_token") and pair.get("ct0"):
        return {"auth_token": pair["auth_token"], "ct0": pair["ct0"]}
    return None
```

> Implementation note: the full per-browser readers are ~250 lines in
> `REF/cookie_extract.py`. Copy them verbatim into the elided section,
> renaming the public entrypoint to `_extract_x_cookies_all_browsers`.
> Keep every `try/except` so a single locked DB never breaks the chain.

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest tests/test_cookie_extract.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add src/gapmap/sources/_cookie_extract.py tests/test_cookie_extract.py
git commit -m "feat(sources): add browser cookie extraction for X auth"
```

---

## Task 10: X / Twitter adapter (multi-backend resolution chain)

**Files:**
- Create: `src/gapmap/sources/x_twitter.py`
- Test: `tests/test_x_twitter.py`
- Reference: `REF/xai_x.py` (`https://api.x.ai/v1/responses`, `XAI_API_KEY`), `REF/xquik.py` (`https://xquik.com/api/v1`, `XQUIK_API_KEY`), `REF/bird_x.py` (`AUTH_TOKEN`/`CT0` + Node), `REF/cookie_extract.py`.

> Backend priority: (1) cookie-extract populates `AUTH_TOKEN`/`CT0` → (2) bird if those + Node present → (3) xAI if `XAI_API_KEY` → (4) Xquik if `XQUIK_API_KEY`. First backend that yields rows wins. Bird is **optional** (needs the vendored Node client from Task 10b + Node on PATH); the chain works without it via xAI/Xquik. All backends emit the same posts-row shape (`source_type="x"`, `score`=likes).

- [ ] **Step 1: Write the failing test**

```python
# tests/test_x_twitter.py
import gapmap.sources.x_twitter as mod

def test_x_no_backend_skips(monkeypatch):
    for k in ("AUTH_TOKEN", "CT0", "XAI_API_KEY", "XQUIK_API_KEY"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setattr(mod.ce, "x_auth_from_browsers", lambda: None)
    rows = mod.fetch_x("ai agents", limit=5)
    assert len(rows) == 1 and "_error" in rows[0]

def test_x_xai_backend_maps_rows(monkeypatch):
    for k in ("AUTH_TOKEN", "CT0", "XQUIK_API_KEY"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setattr(mod.ce, "x_auth_from_browsers", lambda: None)
    monkeypatch.setenv("XAI_API_KEY", "xai-k")
    monkeypatch.setattr(mod, "_fetch_xai", lambda q, n: [{
        "id": "1", "author_handle": "@dev", "text": "agents are great",
        "url": "https://x.com/dev/status/1", "likes": 99, "replies": 5,
        "created_utc": 1717200000.0,
    }])
    rows = mod.fetch_x("agents", limit=5)
    assert rows[0]["source_type"] == "x"
    assert rows[0]["author"] == "dev"  # @ stripped
    assert rows[0]["score"] == 99
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_x_twitter.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Write the implementation**

```python
# src/gapmap/sources/x_twitter.py
"""X / Twitter search via a backend resolution chain:

  1. cookie-extract → populate AUTH_TOKEN/CT0 from a logged-in browser
  2. bird (vendored Node client) if AUTH_TOKEN/CT0 + Node present
  3. xAI live search if XAI_API_KEY present
  4. Xquik if XQUIK_API_KEY present

The first backend that returns rows wins. Each backend returns a list of
intermediate dicts {id, author_handle, text, url, likes, replies,
created_utc}; _row() maps those to the common posts-row shape.
Ported from last30days lib/{bird_x,xai_x,xquik,cookie_extract}.py.
"""
from __future__ import annotations

import os
import shutil
from datetime import datetime, timezone
from typing import Any

import httpx

from . import _cookie_extract as ce


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _row(t: dict[str, Any]) -> dict[str, Any]:
    handle = str(t.get("author_handle") or "").lstrip("@") or "[anon]"
    text = (t.get("text") or "").strip()
    return {
        "id": f"x_{t.get('id')}",
        "sub": "x",
        "source_type": "x",
        "author": handle,
        "title": text[:200] or f"X post by @{handle}",
        "selftext": text,
        "url": t.get("url") or "",
        "score": int(t.get("likes") or 0),
        "upvote_ratio": None,
        "num_comments": int(t.get("replies") or 0),
        "created_utc": float(t.get("created_utc") or 0),
        "is_self": 1,
        "over_18": 0,
        "flair": "",
        "permalink": t.get("url") or "",
        "fetched_at": _now_iso(),
    }


def _fetch_bird(query: str, limit: int) -> list[dict]:
    """Run the vendored bird-search.mjs Node client. Returns [] if Node or
    the vendored client is absent, or AUTH_TOKEN/CT0 missing.
    Port the subprocess call + JSON parse from REF/bird_x.py."""
    if not (os.getenv("AUTH_TOKEN") and shutil.which("node")):
        return []
    # ... port REF/bird_x.py subprocess invocation of vendor/bird-search/
    #     bird-search.mjs; map each tweet → {id, author_handle, text, url,
    #     likes, replies, created_utc}.
    return []


def _fetch_xai(query: str, limit: int) -> list[dict]:
    """xAI live X search via https://api.x.ai/v1/responses. Port the
    request + response parse from REF/xai_x.py. Returns [] on error."""
    key = os.getenv("XAI_API_KEY")
    if not key:
        return []
    # ... port REF/xai_x.py: POST X_SEARCH_PROMPT, parse cited X posts →
    #     intermediate dicts. Return [] on any httpx.HTTPError.
    return []


def _fetch_xquik(query: str, limit: int) -> list[dict]:
    """Xquik REST search via https://xquik.com/api/v1. Port the request +
    parse from REF/xquik.py (full engagement metrics). [] on error."""
    key = os.getenv("XQUIK_API_KEY")
    if not key:
        return []
    # ... port REF/xquik.py GET with XQUIK_API_KEY → intermediate dicts.
    return []


def fetch_x(query: str, limit: int = 20) -> list[dict]:
    # 1. Try to populate AUTH_TOKEN/CT0 from a logged-in browser.
    if not os.getenv("AUTH_TOKEN"):
        pair = ce.x_auth_from_browsers()
        if pair:
            os.environ.setdefault("AUTH_TOKEN", pair["auth_token"])
            os.environ.setdefault("CT0", pair["ct0"])

    # 2-4. Try each backend in priority order; first non-empty wins.
    for backend in (_fetch_bird, _fetch_xai, _fetch_xquik):
        try:
            items = backend(query, limit)
        except Exception:
            items = []
        if items:
            return [_row(t) for t in items[:limit]]

    return [{"_error": "no X backend available — log into x.com in a browser, "
             "or set XAI_API_KEY or XQUIK_API_KEY in Settings"}]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest tests/test_x_twitter.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add src/gapmap/sources/x_twitter.py tests/test_x_twitter.py
git commit -m "feat(sources): add X/Twitter adapter with backend resolution chain"
```

---

## Task 10b: Vendor the bird-search Node client (optional X backend)

**Files:**
- Create: `src/gapmap/sources/vendor/bird-search/` (copy from `REF/vendor/bird-search/`)

- [ ] **Step 1: Copy the vendored client + license**

```bash
mkdir -p src/gapmap/sources/vendor
cp -R "/Users/shantanubombatkar/Documents/GitHub/fintech_repos/last30days-skill/skills/last30days/scripts/lib/vendor/bird-search" \
      src/gapmap/sources/vendor/bird-search
ls src/gapmap/sources/vendor/bird-search/  # expect: bird-search.mjs, package.json, LICENSE
```

- [ ] **Step 2: Wire the path in `_fetch_bird`**

In `src/gapmap/sources/x_twitter.py`, set the client path and finish the port:

```python
from pathlib import Path
_BIRD_MJS = Path(__file__).parent / "vendor" / "bird-search" / "bird-search.mjs"
```

Then port the `subprocess.run(["node", str(_BIRD_MJS), ...])` invocation + JSON-decode-retry loop from `REF/bird_x.py` into `_fetch_bird`.

- [ ] **Step 3: Verify it self-skips without Node**

Run: `python3 -m pytest tests/test_x_twitter.py -v`
Expected: PASS (backend still self-skips when Node/keys absent; chain unaffected)

- [ ] **Step 4: Commit**

```bash
git add src/gapmap/sources/vendor/bird-search src/gapmap/sources/x_twitter.py
git commit -m "feat(sources): vendor bird-search Node client for X (optional backend)"
```

---

## Task 11: Register all 8 sources in the Python pipeline

**Files:**
- Modify: `src/gapmap/sources/__init__.py` (add imports + `__all__`)
- Modify: `src/gapmap/sources/collect_adapter.py` (add `run_*` wrappers + `SOURCES` entries)
- Test: `tests/test_new_sources_registered.py`

- [ ] **Step 1: Write the failing registration test**

```python
# tests/test_new_sources_registered.py
from gapmap.sources.collect_adapter import SOURCES

NEW = ["polymarket", "truthsocial", "digg", "tiktok",
       "instagram", "threads", "pinterest", "x"]

def test_new_sources_in_registry():
    for s in NEW:
        assert s in SOURCES, f"{s} missing from SOURCES"
        assert callable(SOURCES[s])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_new_sources_registered.py -v`
Expected: FAIL — `assert 'polymarket' in SOURCES`

- [ ] **Step 3: Add exports to `__init__.py`**

Append to the import block and `__all__` in `src/gapmap/sources/__init__.py`:

```python
from .polymarket import fetch_polymarket
from .truthsocial import fetch_truthsocial
from .digg import fetch_digg
from .tiktok import fetch_tiktok
from .instagram import fetch_instagram
from .threads import fetch_threads
from .pinterest import fetch_pinterest
from .x_twitter import fetch_x
```

Add their names to `__all__`:

```python
    "fetch_polymarket", "fetch_truthsocial", "fetch_digg",
    "fetch_tiktok", "fetch_instagram", "fetch_threads",
    "fetch_pinterest", "fetch_x",
```

- [ ] **Step 4: Add `run_*` wrappers in `collect_adapter.py`**

The 7 keyword-list sources use the existing `_run_simple_list` helper. Add
these definitions near the other `run_*` functions (e.g. after `run_producthunt`):

```python
def run_polymarket(topic_or_keywords, limit: int = 20) -> int:
    from .polymarket import fetch_polymarket
    return _run_simple_list(topic_or_keywords, "polymarket", fetch_polymarket, limit)

def run_truthsocial(topic_or_keywords, limit: int = 30) -> int:
    from .truthsocial import fetch_truthsocial
    return _run_simple_list(topic_or_keywords, "truthsocial", fetch_truthsocial, limit)

def run_digg(topic_or_keywords, limit: int = 20) -> int:
    from .digg import fetch_digg
    return _run_simple_list(topic_or_keywords, "digg", fetch_digg, limit)

def run_tiktok(topic_or_keywords, limit: int = 20) -> int:
    from .tiktok import fetch_tiktok
    return _run_simple_list(topic_or_keywords, "tiktok", fetch_tiktok, limit)

def run_instagram(topic_or_keywords, limit: int = 20) -> int:
    from .instagram import fetch_instagram
    return _run_simple_list(topic_or_keywords, "instagram", fetch_instagram, limit)

def run_threads(topic_or_keywords, limit: int = 20) -> int:
    from .threads import fetch_threads
    return _run_simple_list(topic_or_keywords, "threads", fetch_threads, limit)

def run_pinterest(topic_or_keywords, limit: int = 20) -> int:
    from .pinterest import fetch_pinterest
    return _run_simple_list(topic_or_keywords, "pinterest", fetch_pinterest, limit)

def run_x(topic_or_keywords, limit: int = 20) -> int:
    from .x_twitter import fetch_x
    return _run_simple_list(topic_or_keywords, "x", fetch_x, limit)
```

- [ ] **Step 5: Register them in the `SOURCES` dict**

Add inside the `SOURCES: dict[str, Any] = { ... }` literal (after the
`acled` entry, before the closing `}`):

```python
    # last30days Phase-1 social + prediction-market sources.
    "polymarket":  run_polymarket,    # free, no key
    "digg":        run_digg,          # free, needs digg-pp-cli on PATH
    "truthsocial": run_truthsocial,   # TRUTHSOCIAL_TOKEN
    "tiktok":      run_tiktok,        # SCRAPECREATORS_API_KEY
    "instagram":   run_instagram,     # SCRAPECREATORS_API_KEY
    "threads":     run_threads,       # SCRAPECREATORS_API_KEY
    "pinterest":   run_pinterest,     # SCRAPECREATORS_API_KEY
    "x":           run_x,             # AUTH_TOKEN/CT0 | XAI_API_KEY | XQUIK_API_KEY
```

- [ ] **Step 6: Run test to verify it passes**

Run: `python3 -m pytest tests/test_new_sources_registered.py -v`
Expected: PASS (1 passed)

- [ ] **Step 7: Run the full new-source test suite**

Run: `python3 -m pytest tests/test_polymarket.py tests/test_truthsocial.py tests/test_digg.py tests/test_tiktok.py tests/test_instagram.py tests/test_threads.py tests/test_pinterest.py tests/test_x_twitter.py tests/test_new_sources_registered.py -v`
Expected: all PASS

- [ ] **Step 8: Commit**

```bash
git add src/gapmap/sources/__init__.py src/gapmap/sources/collect_adapter.py tests/test_new_sources_registered.py
git commit -m "feat(sources): register 8 last30days sources in collect pipeline"
```

---

## Task 12: Surface the 8 sources in the collect UI picker

**Files:**
- Modify: `app-tauri/src/screens/collect.js` (the two `SOURCE_LABELS` maps at ~621 and ~1027)

- [ ] **Step 1: Add labels to the first `SOURCE_LABELS` map (~line 621)**

After the `acled: 'ACLED',` line, add:

```javascript
    polymarket: 'Polymarket', x: 'X / Twitter', tiktok: 'TikTok',
    instagram: 'Instagram', threads: 'Threads', pinterest: 'Pinterest',
    truthsocial: 'Truth Social', digg: 'Digg',
```

- [ ] **Step 2: Add the same labels to the second `SOURCE_LABELS` map (~line 1027)**

Append the identical 8 key/label pairs to the map on line ~1027 (the
`trustpilot: 'Trustpilot', producthunt: 'Product Hunt', …` one).

- [ ] **Step 3: Manually verify in the running app**

Run the Tauri dev app, open the Collect screen, confirm all 8 new sources
appear (by label) in the source picker/grid. (Do NOT add them to
`AGGRESSIVE_SOURCES` — keyed/social sources stay opt-in so users aren't
surprise-billed or stalled on missing keys.)

- [ ] **Step 4: Commit**

```bash
git add app-tauri/src/screens/collect.js
git commit -m "feat(ui): surface 8 new sources in collect picker"
```

---

## Task 13: Add the 6 new keys to the BYOK Settings modal (frontend)

**Files:**
- Modify: `app-tauri/src/screens/byok.js` (the source-key rows array, after the `bsky_app_password` row at ~line 165)

- [ ] **Step 1: Add key rows**

Append these objects to the same array that holds `youtube_api_key` /
`bsky_handle` (each is `{ key, envKey, label, placeholder, help }`):

```javascript
  {
    key: 'scrapecreators_api_key', envKey: 'SCRAPECREATORS_API_KEY',
    label: 'ScrapeCreators API key (optional)', placeholder: 'sc-…',
    help: 'Unlocks TikTok, Instagram, Threads & Pinterest. 100 free credits then pay-as-you-go at <a href="https://scrapecreators.com" target="_blank">scrapecreators.com</a>. Sources skip silently if empty.',
  },
  {
    key: 'truthsocial_token', envKey: 'TRUTHSOCIAL_TOKEN',
    label: 'Truth Social token (optional)', placeholder: 'bearer token',
    help: 'Bearer token from truthsocial.com browser dev tools (Network tab). Unlocks the Truth Social source.',
  },
  {
    key: 'x_auth_token', envKey: 'AUTH_TOKEN',
    label: 'X auth_token cookie (optional)', placeholder: 'auth_token cookie',
    help: 'From x.com cookies (auth_token). Pair with ct0 below. Or just stay logged into x.com in your browser and the app reads it automatically.',
  },
  {
    key: 'x_ct0', envKey: 'CT0',
    label: 'X ct0 cookie (optional)', placeholder: 'ct0 cookie',
    help: 'The ct0 cookie from x.com. Pairs with auth_token above.',
  },
  {
    key: 'xai_api_key', envKey: 'XAI_API_KEY',
    label: 'xAI API key (optional, for X)', placeholder: 'xai-…',
    help: 'Live X search via xAI. Get a key at <a href="https://x.ai" target="_blank">x.ai</a>. Used as an X backend if browser cookies are absent.',
  },
  {
    key: 'xquik_api_key', envKey: 'XQUIK_API_KEY',
    label: 'Xquik API key (optional, for X)', placeholder: 'xquik key',
    help: 'X search with full engagement metrics via <a href="https://xquik.com" target="_blank">xquik.com</a>. Used as an X backend.',
  },
```

- [ ] **Step 2: Manually verify the rows render**

Run the Tauri dev app → Settings → BYOK modal → "Reddit + sources" tab.
Confirm all 6 rows appear with masked inputs and the help links. (The save
path calls `api.byokSet(envKey, value)`, which hits the Rust command updated
in Task 14 — until Task 14 lands, saving these returns "key not allowed".)

- [ ] **Step 3: Commit**

```bash
git add app-tauri/src/screens/byok.js
git commit -m "feat(ui): add 6 source keys to BYOK settings modal"
```

---

## Task 14: Allow the 6 new keys in the Rust BYOK backend

**Files:**
- Modify: `app-tauri/src-tauri/src/commands.rs` (`ALLOWED` array in `byok_set` ~line 6210; `byok_status` JSON ~line 6178)

- [ ] **Step 1: Add the keys to the `ALLOWED` allowlist**

In `byok_set`, add to the `const ALLOWED: &[&str]` array (after `BSKY_APP_PASSWORD`):

```rust
        "SCRAPECREATORS_API_KEY",
        "TRUTHSOCIAL_TOKEN",
        "AUTH_TOKEN",
        "CT0",
        "XAI_API_KEY",
        "XQUIK_API_KEY",
```

- [ ] **Step 2: Add masked entries to the `byok_status` JSON**

In `byok_status`, add to the returned `json!({ ... })` (after `ncbi_api_key`):

```rust
        "scrapecreators_api_key": mask(&["SCRAPECREATORS_API_KEY"]),
        "truthsocial_token":      mask(&["TRUTHSOCIAL_TOKEN"]),
        "x_auth_token":           mask(&["AUTH_TOKEN"]),
        "x_ct0":                  mask(&["CT0"]),
        "xai_api_key":            mask(&["XAI_API_KEY"]),
        "xquik_api_key":          mask(&["XQUIK_API_KEY"]),
```

(The `byok.js` rows use these exact status-JSON keys — `scrapecreators_api_key`,
`truthsocial_token`, `x_auth_token`, `x_ct0`, `xai_api_key`, `xquik_api_key` —
to render their "set/unset" preview.)

- [ ] **Step 3: Compile the Rust backend**

Run: `cd app-tauri/src-tauri && cargo check`
Expected: compiles clean (no new warnings on the changed lines)

- [ ] **Step 4: End-to-end manual verification**

Run the Tauri dev app:
1. Settings → BYOK → save a dummy `SCRAPECREATORS_API_KEY` → reopen modal → confirm it shows masked/"set".
2. Confirm `~/.config/gapmap/.env` (or `~/.config/reddit-myind/.env`) contains the key with `0600` perms.
3. Clear it → confirm the row shows "unset" and the key is removed from the file.

- [ ] **Step 5: Commit**

```bash
git add app-tauri/src-tauri/src/commands.rs
git commit -m "feat(byok): allow 6 last30days source keys in BYOK backend"
```

---

## Task 15: Source-family labels, changelog, and graph sync

**Files:**
- Modify: `src/gapmap/sources/source_families.py` (only if any new `source_type` needs a subtype label — the 8 new ones are single-family, so likely no change; confirm none fragment)
- Create: `changelogs/2026-06-13_01_last30days-source-layer-phase1.md`

- [ ] **Step 1: Confirm no source-family fragmentation**

The 8 new `source_type` values (`polymarket`, `x`, `tiktok`, `instagram`,
`threads`, `pinterest`, `truthsocial`, `digg`) are each a single family —
none use subtypes like `youtube_transcript`. Verify nothing in
`source_families.py` needs them added (they fall through `normalize_source_type`
unchanged). No edit expected; note it explicitly if one is needed.

- [ ] **Step 2: Write the changelog entry**

```markdown
# last30days Source Layer — Phase 1

**Date:** 2026-06-13
**Type:** Feature

## Summary

Added 8 new data-source adapters ported from the last30days skill —
Polymarket, Truth Social, Digg, TikTok, Instagram, Threads, Pinterest, and
X/Twitter — wired into the existing collect pipeline, configurable from the
Settings BYOK modal, and gracefully skipped when their key/binary is missing.

## Changes

- New source adapters in src/gapmap/sources/ following the posts-row contract
- Shared ScrapeCreators request helper (_scrapecreators.py) for the 4 IG-family sources
- Browser cookie extraction (_cookie_extract.py) + multi-backend X chain
- Registered all 8 in collect_adapter.SOURCES and sources/__init__.py
- Surfaced in the collect UI source picker (opt-in; not in AGGRESSIVE_SOURCES)
- 6 new BYOK keys (SCRAPECREATORS_API_KEY, TRUTHSOCIAL_TOKEN, AUTH_TOKEN, CT0,
  XAI_API_KEY, XQUIK_API_KEY) wired through commands.rs + byok.js

## Files Created

- src/gapmap/sources/{polymarket,truthsocial,digg,tiktok,instagram,threads,pinterest,x_twitter}.py
- src/gapmap/sources/{_scrapecreators,_cookie_extract}.py
- src/gapmap/sources/vendor/bird-search/ (vendored Node client)
- tests/test_{polymarket,truthsocial,digg,tiktok,instagram,threads,pinterest,x_twitter,cookie_extract,scrapecreators_helper,new_sources_registered}.py

## Files Modified

- src/gapmap/sources/__init__.py (exports)
- src/gapmap/sources/collect_adapter.py (run_* wrappers + SOURCES)
- app-tauri/src/screens/collect.js (picker labels)
- app-tauri/src/screens/byok.js (6 key rows)
- app-tauri/src-tauri/src/commands.rs (ALLOWED + byok_status)
```

- [ ] **Step 3: Sync the knowledge graphs**

Run: `codegraph sync && graphify update .`
Expected: "Synced N changed files" (N ≥ 14). If 0 synced, run `codegraph index`.

- [ ] **Step 4: Commit**

```bash
git add changelogs/2026-06-13_01_last30days-source-layer-phase1.md src/gapmap/sources/source_families.py .codegraph graphify-out
git commit -m "docs(changelog): last30days source layer Phase 1 + graph sync"
```

---

## Final verification

- [ ] Run the whole new suite: `python3 -m pytest tests/test_polymarket.py tests/test_truthsocial.py tests/test_digg.py tests/test_tiktok.py tests/test_instagram.py tests/test_threads.py tests/test_pinterest.py tests/test_x_twitter.py tests/test_cookie_extract.py tests/test_scrapecreators_helper.py tests/test_new_sources_registered.py -v` → all PASS
- [ ] `cd app-tauri/src-tauri && cargo check` → clean
- [ ] Manual: collect a topic with TikTok selected + a real `SCRAPECREATORS_API_KEY` → rows land; collect with the key cleared → source shows done with 0 posts, no crash, no hang
- [ ] Manual: X with browser logged into x.com → rows land via cookie/bird or xAI/Xquik; with no backend → 0 posts, graceful

---

## Notes for the implementer

- **The `# ... port from REF/...` markers in Tasks 9 & 10** are the only spots that require copying upstream code rather than typing what's shown. Those modules (`cookie_extract.py` ~250 lines, `bird_x.py`/`xai_x.py`/`xquik.py` request+parse) are too long to inline verbatim and their exact HTTP/JSON shapes must match the live APIs — copy them from the cited `REF/` files and adapt only the function names + the final dict keys to the intermediate shape `{id, author_handle, text, url, likes, replies, created_utc}`.
- **ScrapeCreators JSON keys** (Tasks 5-8): the `_row` mappings use the documented field names; if a live response differs, the cited `REF/<source>.py` `parse_*` block is authoritative — adjust the `.get()` paths and update the test fixture to a real captured response.
- **Don't** add the keyed/social sources to `AGGRESSIVE_SOURCES` in `collect.js` — they stay opt-in.
- **Per-source timeout:** all sources honor the existing `GAPMAP_SOURCE_TIMEOUT_SEC` budget via the parallel fan-out; no per-adapter timeout wiring needed.
