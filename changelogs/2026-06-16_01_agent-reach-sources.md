# Agent Reach sources + in-app credential flow + Reddit cascade

**Date:** 2026-06-16
**Type:** Feature

## Summary

Ported Agent Reach's portable platform readers into native Gap Map sources,
upgraded Reddit fetching to a robust tiered cascade, and added an in-app
"Reach Connections" flow where every cookie/key-gated source can be logged into
from the browser, its session cookie captured, stored locally, verified, and
used for collection. All sources emit the common posts-row shape, never raise,
and degrade to `[]` (with a hint) when a credential is absent.

## Changes

- **10 new sources** (`src/gapmap/sources/`):
  - Zero-config: `v2ex` (public API), `web_reader` (Jina Reader), `bilibili`
    (search API, optional `BILIBILI_PROXY`), `xiaoyuzhou` (episode metadata).
  - Key-gated: `exa_search` (Exa REST, `EXA_API_KEY` or stored key).
  - Cookie-gated: `xueqiu` (cookie-warm + optional token), `xiaohongshu`
    (best-effort cookie), `linkedin` (public-URL reader), and `reddit_free`
    (cookie/proxy JSON with RSS fallback).
  - `x_twitter` now falls back to a stored `twitter` credential (auth_token/ct0)
    for its free bird path.
- **Reddit cascade** (`fetch/posts.py`, `fetch/search.py`, `fetch/_reddit_tiers.py`):
  PRAW → cookie-JSON(+proxy) → RSS. Connected users get full score/comments;
  no one hits a hard 403. `REDDIT_PROXY` support added to `core/public_client.py`.
- **Credential layer**: `core/credentials.py` (get/set/delete/verify, cookie_header,
  api_key) backed by a new `source_credentials` SQLite table; `_cookie_extract.py`
  generalized from X-only to a multi-platform `COOKIE_REGISTRY` + `extract_cookies()`.
- **Reach Connections backend** (`research/reach_connections.py`): list/verify/
  import_browser/save_manual/delete, with per-source login URLs and live checks.
- **Wiring**: registered in `sources/__init__.py`, `collect_adapter.SOURCES`,
  `source_families.REDDIT_FAMILY` (reddit_free), MCP tools (`gapmap_fetch_*`,
  `gapmap_read_*`, `gapmap_creds_list/verify`), and CLI (`gapmap creds …`).
- **Desktop app**: `creds_*` Tauri IPC (`commands.rs` + `main.rs`), `api.js`
  `creds*` methods, and a new **Connections** sidebar screen
  (`screens/reachConnections.js`) with browser-login → import → verify per source.

## Files Created

- `src/gapmap/core/credentials.py`
- `src/gapmap/sources/{v2ex,web_reader,bilibili,xiaoyuzhou,exa_search,xueqiu,xiaohongshu,linkedin,reddit_free}.py`
- `src/gapmap/fetch/_reddit_tiers.py`
- `src/gapmap/research/reach_connections.py`
- `app-tauri/src/screens/reachConnections.js`
- `tests/{_reach_mock,test_credentials,test_v2ex,test_web_reader,test_bilibili,test_xiaoyuzhou,test_exa_search,test_xueqiu,test_linkedin,test_xiaohongshu,test_x_twitter_creds,test_reddit_free,test_reddit_cascade,test_reach_sources_registered,test_reach_connections}.py`
- `docs/manual-todo/agent-reach-cookies.md`
- `docs/superpowers/specs/2026-06-16-agent-reach-sources-design.md`, `docs/superpowers/plans/2026-06-16-agent-reach-sources.md`

## Files Modified

- `src/gapmap/core/db.py` — `source_credentials` table in `init_schema`.
- `src/gapmap/core/public_client.py` — `_proxy()` + proxy-aware httpx clients.
- `src/gapmap/sources/_cookie_extract.py` — `COOKIE_REGISTRY` + `extract_cookies()`.
- `src/gapmap/sources/{__init__,collect_adapter,source_families,x_twitter}.py` — registration + twitter cookie fallback.
- `src/gapmap/fetch/{posts,search}.py` — tiered cascade.
- `src/gapmap/mcp/server.py` — fetch/read/creds MCP tools.
- `src/gapmap/cli/main.py` — `creds` subcommands.
- `app-tauri/src-tauri/src/{commands,main}.rs`, `app-tauri/src/{api.js,main.js}`, `app-tauri/index.html` — IPC + screen + nav.
