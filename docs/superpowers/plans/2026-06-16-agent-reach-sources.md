# Agent Reach Sources + In-App Credential Flow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port Agent Reach's portable platform readers into native OpenReply sources, fix Reddit to a robust tiered cascade, and add an in-app browser-login → cookie-capture → store → verify → use credential flow.

**Architecture:** Each source is a `fetch_<name>(query, limit) -> list[dict]` module emitting the common posts-row shape (never raises). Cookie/key-gated sources read creds through a new `core/credentials.py` backed by a `source_credentials` SQLite table. The desktop app gets a "Reach Connections" screen that opens platform logins in the system browser (existing `open_url` IPC), extracts the session cookie from the browser, stores+verifies it, after which the matching source uses it. Reddit's first-class fetch becomes a 4-tier cascade (PRAW → cookie → proxy JSON → RSS).

**Tech Stack:** Python 3.10+ (`httpx`, `sqlite-utils`, `feedparser`), Tauri 2 (Rust `commands.rs`), vanilla-JS app (`api.js`, screens), pytest.

**Scope honesty (discovered from the upstream code):**
- Full native HTTP sources: `v2ex`, `web_reader`, `bilibili`, `xueqiu`, `exa_search`, `reddit_free` + Reddit cascade.
- Reuse-not-rebuild: `twitter` "free" = wire existing `x_twitter.py` to the new credential layer.
- Partial by platform nature: `xiaoyuzhou` (episode metadata), `linkedin` (Jina read of public URLs), `xiaohongshu` (best-effort cookie port).

---

## File Structure

**New Python files**
- `src/openreply/core/credentials.py` — credential store accessor (get/set/delete/verify).
- `src/openreply/sources/v2ex.py` · `web_reader.py` · `bilibili.py` · `xueqiu.py` · `exa_search.py` · `xiaoyuzhou.py` · `linkedin.py` · `xiaohongshu.py` · `reddit_free.py` — fetchers.
- `tests/test_v2ex.py` · `test_web_reader.py` · `test_bilibili.py` · `test_xueqiu.py` · `test_exa_search.py` · `test_xiaoyuzhou.py` · `test_linkedin.py` · `test_xiaohongshu.py` · `test_reddit_free.py` · `test_credentials.py` · `test_reddit_cascade.py`.

**Modified Python files**
- `src/openreply/core/db.py` — `source_credentials` table in `init_schema`.
- `src/openreply/sources/_cookie_extract.py` — generalize X-only → multi-platform cookie registry.
- `src/openreply/sources/__init__.py` — imports + `__all__` + docstring tiers.
- `src/openreply/sources/collect_adapter.py` — `collect_<name>` per source.
- `src/openreply/core/public_client.py` — add proxy support.
- `src/openreply/fetch/posts.py` · `fetch/search.py` — tiered cascade.
- `src/openreply/mcp/server.py` — `openreply_fetch_<name>` + `openreply_creds_list` / `openreply_creds_verify`.
- `src/openreply/cli/main.py` — source dispatch + `creds` subcommands.
- `src/openreply/sources/source_families.py` — REDDIT_FAMILY includes `reddit_free`.
- `pyproject.toml` — only if a new pure-Python dep is needed (target: none).

**Modified app files**
- `app-tauri/src/screens/reachConnections.js` — new screen (create).
- `app-tauri/src/main.js` — sidebar tab + route.
- `app-tauri/src/api.js` — `credsList/credsImportBrowser/credsSaveManual/credsVerify/credsDelete`.
- `app-tauri/src-tauri/src/commands.rs` + `main.rs` — 5 creds IPC commands.
- `app-tauri/src/lib/postLink.js` — REDDIT_FAMILY includes `reddit_free`.

**Docs**
- `docs/manual-todo/agent-reach-cookies.md`, `changelogs/2026-06-16_NN_*.md`, `FEATURES.md`.

---

## Phase 1 — Credential layer (foundation)

### Task 1: `source_credentials` table

**Files:** Modify `src/openreply/core/db.py:203` (`init_schema`); Test `tests/test_credentials.py`.

- [ ] **Step 1: Write failing test**
```python
# tests/test_credentials.py
from openreply.core.db import get_db, init_schema

def test_source_credentials_table_created(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENREPLY_DB", str(tmp_path / "t.db"))
    get_db.cache_clear()
    db = get_db(); init_schema(db)
    assert "source_credentials" in db.table_names()
```
- [ ] **Step 2: Run** `pytest tests/test_credentials.py::test_source_credentials_table_created -v` → FAIL.
- [ ] **Step 3:** In `init_schema`, after the `trend_series` block add:
```python
    if "source_credentials" not in db.table_names():
        db["source_credentials"].create(
            {
                "source": str,        # e.g. "reddit", "xueqiu", "xiaohongshu"
                "cookie_json": str,   # JSON map of cookie name->value
                "username": str,
                "kind": str,          # "cookie" | "api_key"
                "saved_at": str,
                "last_verified_at": str,
            },
            pk="source",
        )
```
- [ ] **Step 4: Run** the test → PASS.
- [ ] **Step 5: Commit**
```bash
git add src/openreply/core/db.py tests/test_credentials.py
git commit -m "feat(db): source_credentials table for per-source auth"
```

### Task 2: `core/credentials.py` accessor

**Files:** Create `src/openreply/core/credentials.py`; Test `tests/test_credentials.py`.

- [ ] **Step 1: Add failing test**
```python
def test_set_get_delete_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENREPLY_DB", str(tmp_path / "t.db"))
    from openreply.core.db import get_db; get_db.cache_clear()
    from openreply.core import credentials as C
    assert C.get_credential("reddit") is None
    C.set_credential("reddit", {"reddit_session": "abc"}, username="u", kind="cookie")
    cred = C.get_credential("reddit")
    assert cred["cookies"]["reddit_session"] == "abc"
    assert cred["username"] == "u"
    C.delete_credential("reddit")
    assert C.get_credential("reddit") is None
```
- [ ] **Step 2: Run** → FAIL (module missing).
- [ ] **Step 3: Implement**
```python
"""Per-source credential store (cookies / api keys). Never raises on read."""
from __future__ import annotations
import json
from datetime import datetime, timezone
from .db import get_db, init_schema

def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")

def get_credential(source: str) -> dict | None:
    try:
        db = get_db(); init_schema(db)
        row = db["source_credentials"].get(source)
    except Exception:
        return None
    if not row:
        return None
    try:
        cookies = json.loads(row.get("cookie_json") or "{}")
    except Exception:
        cookies = {}
    return {"source": source, "cookies": cookies,
            "username": row.get("username") or "",
            "kind": row.get("kind") or "cookie",
            "last_verified_at": row.get("last_verified_at")}

def set_credential(source: str, cookies: dict, username: str = "",
                   kind: str = "cookie", verified: bool = False) -> None:
    db = get_db(); init_schema(db)
    db["source_credentials"].upsert({
        "source": source, "cookie_json": json.dumps(cookies),
        "username": username, "kind": kind, "saved_at": _now(),
        "last_verified_at": _now() if verified else None,
    }, pk="source")

def delete_credential(source: str) -> None:
    try:
        db = get_db(); init_schema(db)
        db["source_credentials"].delete(source)
    except Exception:
        pass

def cookie_header(source: str) -> str:
    """'k=v; k2=v2' header string for a source, or '' if none."""
    cred = get_credential(source)
    if not cred:
        return ""
    return "; ".join(f"{k}={v}" for k, v in cred["cookies"].items())
```
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit**
```bash
git add src/openreply/core/credentials.py tests/test_credentials.py
git commit -m "feat(core): credential store accessor (get/set/delete/cookie_header)"
```

### Task 3: Generalize `_cookie_extract.py` to a platform registry

**Files:** Modify `src/openreply/sources/_cookie_extract.py`; Test `tests/test_credentials.py`.

The file already reads Firefox/Chrome/Brave/Safari cookie DBs for X. Add a registry and a generic `extract_cookies(source)` that returns `{}` non-fatally.

- [ ] **Step 1: Add failing test**
```python
def test_extract_cookies_unknown_source_returns_empty():
    from openreply.sources._cookie_extract import extract_cookies
    assert extract_cookies("not_a_real_source") == {}
```
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3:** Add near the top, replacing the X-only constants usage:
```python
COOKIE_REGISTRY = {
    "reddit":      (["reddit.com"],                    ["reddit_session"]),
    "twitter":     (["x.com", "twitter.com"],          ["auth_token", "ct0"]),
    "xiaohongshu": (["xiaohongshu.com"],               ["web_session", "a1", "webId"]),
    "linkedin":    (["linkedin.com"],                  ["li_at", "JSESSIONID"]),
    "xueqiu":      (["xueqiu.com"],                    ["xq_a_token", "u"]),
    "bilibili":    (["bilibili.com"],                  ["SESSDATA", "bili_jct"]),
}

def extract_cookies(source: str, browser: str | None = None) -> dict:
    """Best-effort extract of a source's session cookies from local browsers.
    Returns {} on any failure (locked DB, missing browser, unknown source)."""
    spec = COOKIE_REGISTRY.get(source)
    if not spec:
        return {}
    domains, names = spec
    try:
        return _extract_for(domains, names, browser)  # generalized from the X path
    except Exception:
        return {}
```
Refactor the existing X reader bodies into `_extract_for(domains, names, browser)` (keep the per-browser readers; just parametrize domains/names instead of the hard-coded `_X_DOMAINS`/`_X_COOKIE_NAMES`).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit**
```bash
git add src/openreply/sources/_cookie_extract.py tests/test_credentials.py
git commit -m "feat(sources): multi-platform cookie extraction registry"
```

---

## Phase 2 — Zero-config sources

> **Shared posts-row template** (every source returns rows of this exact shape; `permalink=None` for non-Reddit so the app doesn't build a broken reddit.com link):
> ```python
> {"id","sub","source_type","author","title","selftext","url","score",
>  "upvote_ratio","num_comments","created_utc","is_self","over_18",
>  "flair","permalink","fetched_at"}
> ```
> Use `from ._http import polite_get`; `_now_iso()` for `fetched_at`; never raise (catch → `[]`).

### Task 4: `v2ex` source (public API)

**Files:** Create `src/openreply/sources/v2ex.py`; Test `tests/test_v2ex.py`.

- [ ] **Step 1: Failing test**
```python
# tests/test_v2ex.py
import respx, httpx
from openreply.sources.v2ex import fetch_v2ex

@respx.mock
def test_fetch_v2ex_shape():
    respx.get("https://www.v2ex.com/api/topics/hot.json").mock(
        return_value=httpx.Response(200, json=[
            {"id": 1, "title": "T", "url": "https://v2ex.com/t/1",
             "content": "body", "replies": 3, "node": {"name":"python","title":"Python"}}]))
    rows = fetch_v2ex("python", limit=10)
    assert rows and rows[0]["source_type"] == "v2ex"
    assert rows[0]["title"] == "T" and rows[0]["permalink"] is None

def test_fetch_v2ex_never_raises(monkeypatch):
    monkeypatch.setattr("openreply.sources.v2ex.polite_get",
                        lambda *a, **k: (_ for _ in ()).throw(Exception("net")))
    assert fetch_v2ex("x") == []
```
- [ ] **Step 2: Run** `pytest tests/test_v2ex.py -v` → FAIL.
- [ ] **Step 3: Implement** (hot topics + node search; map `replies`→`num_comments`):
```python
"""V2EX — public API (hot topics + node topics). Zero-config."""
from __future__ import annotations
from datetime import datetime, timezone
from ._http import polite_get

def _now_iso(): return datetime.now(timezone.utc).isoformat(timespec="seconds")

def _row(it: dict) -> dict:
    node = it.get("node") or {}
    return {
        "id": f"v2ex_{it.get('id') or hash(it.get('url','')) & 0xffffffff:x}",
        "sub": (node.get("name") or "v2ex")[:60],
        "source_type": "v2ex",
        "author": ((it.get("member") or {}).get("username") or ""),
        "title": (it.get("title") or "")[:300],
        "selftext": (it.get("content") or "")[:2000],
        "url": it.get("url") or "",
        "score": 0, "upvote_ratio": None,
        "num_comments": int(it.get("replies") or 0),
        "created_utc": float(it.get("created") or 0.0),
        "is_self": 1, "over_18": 0, "flair": (node.get("title") or None),
        "permalink": None, "fetched_at": _now_iso(),
    }

def fetch_v2ex(query: str, limit: int = 50, **_) -> list[dict]:
    try:
        r = polite_get("https://www.v2ex.com/api/topics/hot.json"); r.raise_for_status()
        items = r.json()
    except Exception:
        return []
    q = (query or "").lower()
    rows = [_row(it) for it in items]
    if q:
        rows = [x for x in rows if q in x["title"].lower() or q in x["selftext"].lower()] or rows
    return rows[:limit]
```
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git add src/openreply/sources/v2ex.py tests/test_v2ex.py && git commit -m "feat(sources): v2ex public-API source"`

### Task 5: `web_reader` source (Jina Reader)

**Files:** Create `src/openreply/sources/web_reader.py`; Test `tests/test_web_reader.py`.
`fetch_web_reader(query)` treats `query` as a URL, fetches `https://r.jina.ai/<url>`, returns ONE post row (title = first markdown H1 or the URL; selftext = first 2000 chars).

- [ ] **Step 1: Failing test**
```python
import respx, httpx
from openreply.sources.web_reader import fetch_web_reader

@respx.mock
def test_web_reader_one_row():
    respx.get("https://r.jina.ai/https://example.com").mock(
        return_value=httpx.Response(200, text="# Title\n\nBody text here"))
    rows = fetch_web_reader("https://example.com")
    assert len(rows) == 1 and rows[0]["source_type"] == "web"
    assert rows[0]["title"] == "Title" and "Body text" in rows[0]["selftext"]

def test_web_reader_non_url_returns_empty():
    assert fetch_web_reader("") == []
```
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**
```python
"""Web reader — clean any URL to markdown via Jina Reader. Zero-config."""
from __future__ import annotations
import re
from datetime import datetime, timezone
from ._http import polite_get

def _now_iso(): return datetime.now(timezone.utc).isoformat(timespec="seconds")

def fetch_web_reader(query: str, limit: int = 1, **_) -> list[dict]:
    url = (query or "").strip()
    if not url:
        return []
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    try:
        r = polite_get(f"https://r.jina.ai/{url}", headers={"Accept": "text/plain"})
        r.raise_for_status()
        text = r.text
    except Exception:
        return []
    m = re.search(r"^#\s+(.+)$", text, re.M)
    title = (m.group(1) if m else url)[:300]
    return [{
        "id": f"web_{hash(url) & 0xffffffff:x}", "sub": "web", "source_type": "web",
        "author": "", "title": title, "selftext": text[:2000], "url": url,
        "score": 0, "upvote_ratio": None, "num_comments": 0, "created_utc": 0.0,
        "is_self": 1, "over_18": 0, "flair": None, "permalink": None,
        "fetched_at": _now_iso(),
    }]
```
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git add src/openreply/sources/web_reader.py tests/test_web_reader.py && git commit -m "feat(sources): web_reader (Jina Reader) source"`

### Task 6: `bilibili` source (search API)

**Files:** Create `src/openreply/sources/bilibili.py`; Test `tests/test_bilibili.py`.
Endpoint: `https://api.bilibili.com/x/web-interface/search/all/v2?keyword=<q>&page=1`. Optional `BILIBILI_PROXY` env. Parse `data.result[*]` where `result_type=="video"` → `data` list of videos (`title` has `<em>` HTML — strip tags; `description`, `author`, `play`→score, `bvid`→url `https://www.bilibili.com/video/<bvid>`, `pubdate`→created_utc).

- [ ] **Step 1: Failing test** (mock the search endpoint, assert shape + tag-strip + `source_type=="bilibili"` + never-raise). Mirror the v2ex test structure.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** following the template; strip `<[^>]+>` from titles; read `proxy=os.environ.get("BILIBILI_PROXY")` and pass to `polite_get(..., proxy=proxy)` if the helper supports it, else `httpx.get(..., proxies=proxy)` in a try/except.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git add src/openreply/sources/bilibili.py tests/test_bilibili.py && git commit -m "feat(sources): bilibili search-API source"`

### Task 7: `xiaoyuzhou` source (episode metadata)

**Files:** Create `src/openreply/sources/xiaoyuzhou.py`; Test `tests/test_xiaoyuzhou.py`.
Scope: given an episode/podcast URL (`xiaoyuzhoufm.com/episode/<id>`), fetch the page, parse the `<title>` and the `<meta name="description">`/JSON-LD show notes → ONE post row (`source_type="xiaoyuzhou"`). No audio download/transcription in this plan (that reuses the existing transcribe module in a later effort — note it in the docstring).

- [ ] **Step 1: Failing test** — mock an episode HTML page, assert one row with title + description, never-raise. 
- [ ] **Step 2: Run** → FAIL. → **Step 3: Implement** (regex/`<title>` + meta description; `is_self=1`). → **Step 4:** PASS. → **Step 5: Commit** `feat(sources): xiaoyuzhou episode-metadata source`.

---

## Phase 3 — Key-gated source

### Task 8: `exa_search` (Exa REST API + key)

**Files:** Create `src/openreply/sources/exa_search.py`; Test `tests/test_exa_search.py`.
Endpoint `POST https://api.exa.ai/search` with header `x-api-key: $EXA_API_KEY`, body `{"query": q, "numResults": limit, "contents": {"text": true}}`. No key → `[]`. Parse `results[*]` (`title`, `url`, `text`→selftext, `publishedDate`→created_utc, `author`).

- [ ] **Step 1: Failing test** — `monkeypatch.delenv("EXA_API_KEY", raising=False)` → `fetch_exa_search("x") == []`; then with key set + mocked `respx` POST, assert shape.
- [ ] **Step 2: Run** → FAIL. → **Step 3: Implement** (read `os.environ.get("EXA_API_KEY")`; `httpx.post` via `polite_get`'s session or a small `polite_post` — if none exists, use `httpx.post` in try/except). → **Step 4:** PASS. → **Step 5: Commit** `feat(sources): exa_search REST source (EXA_API_KEY)`.

---

## Phase 4 — Cookie-gated sources

### Task 9: `xueqiu` (cookie-warm + optional token)

**Files:** Create `src/openreply/sources/xueqiu.py`; Test `tests/test_xueqiu.py`.
Warm the cookie jar by GET `https://xueqiu.com` first (sets `xq_a_token`), then call search `https://xueqiu.com/query/v1/search/status.json?count=<limit>&q=<q>` with `Referer: https://xueqiu.com/`. If `credentials.cookie_header("xueqiu")` is non-empty, send it (better quota). Parse `list[*]` (`text`→title/selftext stripped of HTML, `target`→url, `created_at` ms→created_utc, `reply_count`→num_comments, `like_count`→score).

- [ ] **Step 1: Failing test** — mock homepage + search endpoints, assert shape + never-raise.
- [ ] **Step 2:** FAIL → **Step 3:** Implement (cookie warm via a shared `httpx.Client`; inject stored cookie header). → **Step 4:** PASS. → **Step 5: Commit** `feat(sources): xueqiu source (cookie-warm + stored token)`.

### Task 10: `xiaohongshu` (best-effort cookie port)

**Files:** Create `src/openreply/sources/xiaohongshu.py`; Test `tests/test_xiaohongshu.py`.
Requires `credentials.get_credential("xiaohongshu")`; if absent → `[]` (no raise). With cookie, call the web search endpoint used by Agent Reach's `xiaohongshu.py` (port the request building + the `web_session` cookie header). Parse note cards → posts rows (`source_type="xiaohongshu"`). Heavily anti-bot: on non-200/JSON-decode error → `[]`.

- [ ] **Step 1: Failing test** — no cookie → `[]`; with cookie + mocked endpoint → shape. 
- [ ] **Step 2:** FAIL → **Step 3:** Implement (port from `agent-reach/agent_reach/channels/xiaohongshu.py`, swapping its config-cookie read for `credentials.cookie_header("xiaohongshu")`). → **Step 4:** PASS. → **Step 5: Commit** `feat(sources): xiaohongshu cookie source (best-effort)`.

### Task 11: `linkedin` (Jina read of public URLs)

**Files:** Create `src/openreply/sources/linkedin.py`; Test `tests/test_linkedin.py`.
`fetch_linkedin(query)` where `query` is a LinkedIn URL → read via Jina Reader (reuse `web_reader` logic) → one row `source_type="linkedin"`. Non-LinkedIn URL or empty → `[]`. Docstring notes deep profile/company search needs the upstream MCP (future).

- [ ] **Step 1: Failing test** — mock `r.jina.ai/...linkedin...`, assert one row; empty → `[]`.
- [ ] **Step 2:** FAIL → **Step 3:** Implement (delegate to a shared `_jina_read(url)` extracted from Task 5; set `source_type="linkedin"`). Refactor Task 5 to expose `_jina_read`. → **Step 4:** PASS. → **Step 5: Commit** `feat(sources): linkedin public-URL reader`.

### Task 12: Wire existing `x_twitter` to the credential layer

**Files:** Modify `src/openreply/sources/x_twitter.py`; Test `tests/test_x_twitter_creds.py`.
Add: if no ScrapeCreators key, fall back to `credentials.get_credential("twitter")` (auth_token/ct0) before giving up. Keep current behaviour when the paid key is present.

- [ ] **Step 1: Failing test** — with no paid key but a stored twitter cookie, the free path is attempted (mock it); with neither → `[]`.
- [ ] **Step 2:** FAIL → **Step 3:** Implement the fallback branch (do not remove the existing path). → **Step 4:** PASS. → **Step 5: Commit** `feat(sources): x_twitter falls back to stored cookie (free path)`.

---

## Phase 5 — Reddit cascade (priority)

### Task 13: Proxy support in `public_client`

**Files:** Modify `src/openreply/core/public_client.py`; Test `tests/test_reddit_cascade.py`.
In `_get_rss` (and any JSON getter), read `proxy = load_config().reddit_proxy or os.environ.get("REDDIT_PROXY")` and pass `proxies=proxy` to `httpx.get` when set.

- [ ] **Step 1: Failing test** — monkeypatch `httpx.get` to assert it receives `proxies` when `REDDIT_PROXY` is set.
- [ ] **Step 2:** FAIL → **Step 3:** Implement (thread the proxy through; default None keeps current behaviour). → **Step 4:** PASS. → **Step 5: Commit** `feat(reddit): proxy support on the public RSS path`.

### Task 14: Cookie-JSON Reddit tier + `reddit_free` source

**Files:** Create `src/openreply/sources/reddit_free.py`; Test `tests/test_reddit_free.py`.
`fetch_reddit_free(query, sub=None, limit=50)`: if `credentials.cookie_header("reddit")` present, GET `https://www.reddit.com/search.json?q=<q>&limit=<limit>` (or `/r/<sub>/search.json`) with that Cookie + a browser UA + optional `REDDIT_PROXY` → full JSON (score/num_comments). Map to posts rows with real `permalink` (Reddit family). If no cookie → fall back to existing `public_client.public_search` (RSS). Never raise.

- [ ] **Step 1: Failing test** — with cookie + mocked `search.json`, assert rows include `score`/`num_comments` and `source_type` in the reddit family; without cookie, assert it calls `public_search` (monkeypatched).
- [ ] **Step 2:** FAIL → **Step 3:** Implement. → **Step 4:** PASS. → **Step 5: Commit** `feat(reddit): reddit_free cookie/proxy source with RSS fallback`.

### Task 15: Tiered cascade in first-class `fetch/posts.py` + `fetch/search.py`

**Files:** Modify `src/openreply/fetch/posts.py`, `src/openreply/fetch/search.py`; Test `tests/test_reddit_cascade.py`.
Replace the `auth ? _fetch_auth : _fetch_public` branch with a cascade: try PRAW (mode=="auth") → cookie JSON (if `credentials.cookie_header("reddit")`) → public proxy JSON → RSS; log the served tier via `log_fetch_end(..., extra={"tier": ...})` if supported, else include in the existing log dict.

- [ ] **Step 1: Failing test** — with `mode!="auth"` and a stored reddit cookie, assert the cookie tier is used (monkeypatch each tier to a sentinel); with nothing, assert RSS is used and no exception bubbles.
- [ ] **Step 2:** FAIL → **Step 3:** Implement a small `_cascade(...)` helper shared by both files (extract to a `fetch/_reddit_tiers.py` to keep both thin). → **Step 4:** PASS. → **Step 5: Commit** `feat(reddit): 4-tier fetch cascade (praw→cookie→proxy→rss)`.

---

## Phase 6 — Wiring (registry, collect, MCP, CLI, families)

### Task 16: Register sources

**Files:** Modify `src/openreply/sources/__init__.py`, `collect_adapter.py`, `source_families.py`; Test `tests/test_sources_registry.py`.

- [ ] **Step 1: Failing test**
```python
def test_new_sources_exported():
    import openreply.sources as S
    for fn in ["fetch_v2ex","fetch_web_reader","fetch_bilibili","fetch_xueqiu",
               "fetch_exa_search","fetch_xiaoyuzhou","fetch_linkedin",
               "fetch_xiaohongshu","fetch_reddit_free"]:
        assert hasattr(S, fn)
```
- [ ] **Step 2:** FAIL → **Step 3:** Add imports + `__all__` entries; add `collect_<name>` (use `_run_simple_list` for v2ex/bilibili/xueqiu/exa/xiaohongshu/reddit_free; web_reader/linkedin/xiaoyuzhou take a URL so give them a thin `collect_*` that calls fetch with the topic's seed URL list or skips keyword expansion); add `reddit_free` to `REDDIT_FAMILY` in `source_families.py`. → **Step 4:** PASS. → **Step 5: Commit** `feat(sources): register Agent Reach sources (init/collect/families)`.

### Task 17: MCP tools

**Files:** Modify `src/openreply/mcp/server.py`; Test `tests/test_mcp_reach_tools.py`.
Add `openreply_fetch_<name>` for each (mirror `openreply_fetch_gnews`), plus `openreply_creds_list()` (returns per-source status via `credentials` + a live `verify`) and `openreply_creds_verify(source)`.

- [ ] **Step 1: Failing test** — import server module, assert the tool functions exist and `openreply_fetch_v2ex` returns a list (monkeypatch `fetch_v2ex`).
- [ ] **Step 2:** FAIL → **Step 3:** Implement. (Do NOT add MCP tools for import/save/delete creds — local-only.) → **Step 4:** PASS. → **Step 5: Commit** `feat(mcp): fetch tools for Agent Reach sources + creds status`.

### Task 18: CLI dispatch + `creds` subcommands

**Files:** Modify `src/openreply/cli/main.py`; Test `tests/test_cli_reach.py`.
Add new source names to the source-list help + dispatch branch; add `openreply creds list|import|save|verify|delete` subcommands calling `core.credentials` + `_cookie_extract.extract_cookies`.

- [ ] **Step 1: Failing test** — invoke the CLI parser for `creds list` (capture JSON output), assert it runs without error on an empty DB.
- [ ] **Step 2:** FAIL → **Step 3:** Implement. → **Step 4:** PASS. → **Step 5: Commit** `feat(cli): reach source dispatch + creds subcommands`.

---

## Phase 7 — Desktop app (credential flow)

### Task 19: Rust IPC commands

**Files:** Modify `app-tauri/src-tauri/src/commands.rs`, `main.rs`; (build check).
Add 5 `#[tauri::command]` fns that shell to the sidecar CLI `creds` subcommands (follow the existing `run_cli`/sidecar-invoking command pattern in `commands.rs`): `creds_list`, `creds_import_browser(source, browser)`, `creds_save_manual(source, cookie)`, `creds_verify(source)`, `creds_delete(source)`. Register all five in `main.rs` `generate_handler!`.

- [ ] **Step 1:** Implement the five commands mirroring an existing sidecar command (JSON stdout → `serde_json::Value`).
- [ ] **Step 2:** Add to `tauri::generate_handler![...]` in `main.rs`.
- [ ] **Step 3: Verify build** Run: `cd app-tauri/src-tauri && cargo check` → expect success.
- [ ] **Step 4: Commit** `git add app-tauri/src-tauri/src/commands.rs app-tauri/src-tauri/src/main.rs && git commit -m "feat(app): creds IPC commands (list/import/save/verify/delete)"`

### Task 20: `api.js` methods

**Files:** Modify `app-tauri/src/api.js`; Test `app-tauri/src/api.test.mjs`.
Add:
```js
credsList:          ()              => invoke('creds_list'),
credsImportBrowser: (source, browser) => invoke('creds_import_browser', { source, browser }),
credsSaveManual:    (source, cookie)  => invoke('creds_save_manual', { source, cookie }),
credsVerify:        (source)        => invoke('creds_verify', { source }),
credsDelete:        (source)        => invoke('creds_delete', { source }),
```
- [ ] **Step 1:** Add the methods near `openUrl`. **Step 2:** `node --test app-tauri/src/api.test.mjs` (or existing test runner) green. **Step 3: Commit** `feat(app): api.js creds methods`.

### Task 21: `reachConnections.js` screen + sidebar tab

**Files:** Create `app-tauri/src/screens/reachConnections.js`; Modify `app-tauri/src/main.js`.
Screen renders a card per gated source with: status badge (from `api.credsList()`), **Open login in browser** (`api.openUrl(LOGIN_URLS[source])`), **Import from browser** (`api.credsImportBrowser(source)` then re-render), a **manual paste** `<details>` (textarea → `api.credsSaveManual(source, value)`), **Verify** (`api.credsVerify`), **Disconnect** (`api.credsDelete`). `exa_search` card = API-key input → `credsSaveManual("exa_search", key)`. Add a sidebar nav entry + route in `main.js` pointing to a `loadReachConnections(contentEl)` export.

```js
const LOGIN_URLS = {
  reddit: "https://www.reddit.com/login",
  twitter: "https://x.com/login",
  xiaohongshu: "https://www.xiaohongshu.com",
  linkedin: "https://www.linkedin.com/login",
  xueqiu: "https://xueqiu.com",
  bilibili: "https://www.bilibili.com",
};
```
- [ ] **Step 1:** Create the screen module (follow `connections.js` structure: `export async function loadReachConnections(contentEl)`, `esc()` helper, card HTML, `window.refreshIcons?.()`).
- [ ] **Step 2:** Register the tab in `main.js` (sidebar item + dispatch to `loadReachConnections`).
- [ ] **Step 3: Manual smoke** Run: `cd app-tauri && npm run tauri:dev`; open the new tab; click **Open login in browser** for Reddit → system browser opens reddit.com; **Import from browser** after logging in → badge flips to Connected (or shows the manual-paste hint).
- [ ] **Step 4: Commit** `git add app-tauri/src/screens/reachConnections.js app-tauri/src/main.js && git commit -m "feat(app): Reach Connections screen (browser-login → cookie capture → verify)"`

---

## Phase 8 — Docs

### Task 22: manual-todo, changelog, FEATURES.md

**Files:** Create `docs/manual-todo/agent-reach-cookies.md`; Create `changelogs/2026-06-16_NN_agent-reach-sources.md`; Modify `FEATURES.md`.

- [ ] **Step 1:** Write the cookie guide (per-platform: which cookie, Cookie-Editor steps, proxy env vars `REDDIT_PROXY`/`BILIBILI_PROXY`, `EXA_API_KEY`).
- [ ] **Step 2:** Changelog entry (Type: Feature) listing all new sources + the credential flow + Reddit cascade, with Files Created/Modified.
- [ ] **Step 3:** Add a "Reach Connections / Multi-source" section to FEATURES.md with status emojis (✅ v2ex/web_reader/bilibili/xueqiu/exa, 🟡 xiaohongshu/linkedin/xiaoyuzhou/twitter-free, ✅ reddit cascade) + `file:line` citations.
- [ ] **Step 4: Commit** `git add docs/manual-todo/agent-reach-cookies.md changelogs/ FEATURES.md && git commit -m "docs: Agent Reach sources changelog + manual-todo + FEATURES"`

### Task 23: Full suite + graph sync

- [ ] **Step 1:** Run `pytest tests/ -v` → all green (cookie/key tests skip when creds absent).
- [ ] **Step 2:** Run `graphify update .` to refresh the knowledge graph.
- [ ] **Step 3:** Final review of the branch diff; open PR `feature/agent-reach-sources` → `multi-source`.

---

## Self-Review Notes
- **Spec coverage:** every spec §2 source has a task (4–12,14); Reddit fix §3 = Tasks 13–15; credential layer §"Credential layer" = Tasks 1–3; in-app flow §"In-app credential flow" = Tasks 19–21; wiring §"Per-source wiring" = Tasks 16–18; docs/testing = Tasks 22–23.
- **Honest scoping:** xiaohongshu/linkedin/xiaoyuzhou/twitter-free are explicitly partial/reuse, matching what the upstream code actually supports.
- **Type consistency:** `credentials.get_credential` returns `{"cookies": {...}}`; `cookie_header(source)` used by xueqiu/xiaohongshu/reddit_free; `extract_cookies(source)` returns a flat `{name: value}` dict fed into `set_credential(source, cookies)`.
