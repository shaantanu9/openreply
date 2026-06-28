# Agent Reach → OpenReply native sources + in-app credential flow

> **Date:** 2026-06-16 · **Status:** Design approved, ready for implementation plan
> **Source repo studied:** `~/Documents/GitHub/myind-openreply-ref/agent-reach` (Agent Reach v1.5.0, MIT)
> **Target:** `reddit-myind` (OpenReply) — `src/openreply/sources/` + `app-tauri/`
> **Companion:** `docs/specs/SOURCE_ADDITION_PLAYBOOK.md` (the 6–7 file wiring recipe this follows)

## Summary

Agent Reach is a Python CLI/library that gives AI agents read + search access to
13+ internet platforms via free, no-API-key backends. OpenReply already has ~40 native
sources in `src/openreply/sources/`, each emitting the common **posts-row** shape that
feeds dedup + graph + sentiment + audience clustering for free.

This project **ports Agent Reach's logic** (not the package) into native OpenReply
sources for the platforms OpenReply lacks, fixes Reddit fetching to a robust tiered
cascade, and adds an **in-app credential flow**: every cookie-gated source shows its
status in the desktop app, opens the platform login in the system browser on click,
captures the session cookie/token, stores it locally, verifies it, and wires it into
the fetchers.

## Goals

1. Add 10 native sources following `SOURCE_ADDITION_PLAYBOOK.md`.
2. Make Reddit "work properly" — full-fidelity data (score/comments/pagination) whenever
   a cookie or proxy is available; never a hard 403 failure.
3. In-app credential management: browser-login → cookie-capture → store → verify → use,
   for every cookie-gated source.
4. Everything wired through repo **and** app (CLI, MCP, Tauri IPC, source picker).

## Non-goals

- Vendoring or depending on the `agent-reach` PyPI package at runtime.
- Re-implementing sources OpenReply already has well (github, rss, youtube) — except the
  two free overlaps explicitly chosen (twitter_free, reddit_free).
- OS-keychain credential storage (noted as future hardening; v1 uses local SQLite).
- Heavy/native deps in the sidecar (no playwright/yt-dlp added unless unavoidable).

## Architecture

Each source is a module `fetch_<name>(query, limit=50, **opts) -> list[dict]` returning
rows in the common posts shape, **never raising** (catch → `[]`), using
`sources/_http.polite_get` for HTTP, and lazy-importing optional deps. Cookie/key-gated
sources load their credential through a new `core/credentials.py` accessor and degrade
to `[]` + a doctor-style hint when the credential is absent or expired.

### Sources to add (10) and auth tiers

| Source | Tier | Backend approach | Login URL (browser) |
|---|---|---|---|
| `v2ex` | zero-config | Public `v2ex.com/api/v2` JSON | — |
| `web_reader` | zero-config | Jina Reader `r.jina.ai/<url>` → markdown | — |
| `xiaoyuzhou` (小宇宙) | zero-config | Public episode pages/API | — |
| `bilibili` | zero-config (+proxy) | Public web API; optional `BILIBILI_PROXY` | — |
| `exa_search` | key-gated | `EXA_API_KEY` (free tier) | — (API-key field) |
| `xueqiu` (雪球) | cookie-gated | Token cookie (`xq_a_token`) | https://xueqiu.com |
| `xiaohongshu` (小红书) | cookie-gated | `web_session` cookie | https://www.xiaohongshu.com |
| `linkedin` | cookie-gated | `li_at` cookie | https://www.linkedin.com/login |
| `twitter_free` | cookie/CLI | `auth_token`+`ct0` cookie; fallback to paid `x_twitter` | https://x.com/login |
| `reddit_free` | cookie/proxy | `reddit_session` cookie; see Reddit fix | https://www.reddit.com/login |

All cookie/key-gated sources never raise — `[]` + hint when creds absent.

### Reddit fix — tiered cascade

Upgrade `fetch/posts.py` + `fetch/search.py` from single-mode to a cascade that
auto-selects the best working tier (no API change to callers); log which tier served
the request:

1. **PRAW auth** (existing) — when Reddit OAuth connected (`config.mode == "auth"`).
2. **Cookie session** (new) — `reddit_session` cookie from `core/credentials.py` →
   authenticated JSON with score / comments / deep pagination.
3. **Public JSON via proxy** (new) — `REDDIT_PROXY` env routes around server-IP 403s.
4. **RSS** (existing `public_client`) — last-resort zero-config fallback.

`reddit_free` source = the cookie/proxy path exposed as a standalone source for the
multi-source collect picker; the cascade lives in `fetch/` for the first-class Reddit
flows. Both share the cookie loader and proxy config.

### Credential layer

- **`core/credentials.py`** — `get_credential(source) -> dict | None`,
  `set_credential(source, cookie_json, username, kind)`, `delete_credential(source)`,
  `verify_credential(source) -> (ok, message, username)`. Backed by a new SQLite table.
- **DB migration** — `source_credentials(source TEXT PRIMARY KEY, cookie_json TEXT,
  username TEXT, kind TEXT, saved_at TEXT, last_verified_at TEXT)` created in
  `core/db.py` `init_schema` (lazy-create tolerant, matches existing pattern).
- **Extend `sources/_cookie_extract.py`** — generalize beyond X to a registry of
  `{source: (domains, cookie_names)}`; reuse the existing Firefox/Chrome/Brave/Safari
  readers. Auto-extract is non-fatal: failure → `{}` so the UI falls back to manual paste.

### In-app credential flow

**New screen** `app-tauri/src/screens/reachConnections.js` + a sidebar tab in `main.js`.
One card per cookie-gated / key-gated source:

1. **Status badge** from a live `verify_credential` — ⚪ Not connected · 🟢 Connected
   (*username*) · 🟡 Needs re-login.
2. **"Open login in browser"** → `api.openUrl(loginUrl)` (existing `open_url` IPC) opens
   the platform login in the system browser.
3. **"Import from browser"** → `creds_import_browser` extracts the session cookie from the
   user's browser and stores it.
4. **Manual-paste fallback** — Cookie-Editor instructions + paste field → `creds_save_manual`.
   Shown when auto-extract fails (e.g. Chrome 127+ app-bound encryption).
5. **Auto-verify** — store then immediately `creds_verify`, flip the badge.
6. `exa_search` card = API-key field only (no browser step).

**Command-registration triangle** (per `tauri-python-sidecar-app` skill) — new commands
registered across all three layers:

| Command | CLI | MCP tool | Rust `commands.rs` | `api.js` |
|---|---|---|---|---|
| `creds_list` | ✓ | `openreply_creds_list` | ✓ | `credsList()` |
| `creds_import_browser` | ✓ | — | ✓ | `credsImportBrowser(source, browser?)` |
| `creds_save_manual` | ✓ | — | ✓ | `credsSaveManual(source, cookie)` |
| `creds_verify` | ✓ | `openreply_creds_verify` | ✓ | `credsVerify(source)` |
| `creds_delete` | ✓ | — | ✓ | `credsDelete(source)` |

(`import_browser` / `save_manual` / `delete` are local-machine credential ops — exposed
via CLI + Tauri IPC but NOT as MCP tools, to avoid remote agents writing credentials.)

## Per-source wiring (the playbook, ×10)

For each source, the 6–7 file trail:
1. `src/openreply/sources/<name>.py` — the fetcher (posts-row, never-raise).
2. `src/openreply/sources/__init__.py` — import + `__all__` + docstring tier lists.
3. `src/openreply/sources/collect_adapter.py` — `collect_<name>` (via `_run_simple_list` or
   custom for cookie/proxy flows).
4. `src/openreply/mcp/server.py` — `openreply_fetch_<name>` tool.
5. `src/openreply/cli/main.py` — source-list help + dispatch branch.
6. `pyproject.toml` — only if a new pure-Python dep is required (prefer none).
7. `source_families.py` + `app-tauri/src/lib/postLink.js` — only for new source families
   (reddit-like / video-like) so rows stay visible to sentiment/sources/audience.

## Error handling

- Never-raise on every adapter; `log_fetch_start` / `log_fetch_end(..., error=...)` on all.
- Credential absence/expiry → `[]` + a hint string surfaced in fetch logs and the
  Reach Connections cards.
- Browser cookie extraction failures are non-fatal → manual-paste fallback.
- Proxy errors on Reddit tier 3 → fall through to RSS tier 4.

## Testing

- One `tests/test_<name>.py` per source: asserts posts-shape rows or `[]`, never raises.
  Network calls mocked; cookie/key tests skip when creds absent (`pytest.mark.skipif`).
- `tests/test_reddit_cascade.py` — mocks each tier, asserts correct tier selection and
  graceful fall-through.
- `tests/test_credentials.py` — set/get/delete/verify round-trip against a temp DB;
  `_cookie_extract` registry returns `{}` on locked/missing browser DB (no raise).
- `pytest tests/ -v` green before commit.

## Storage & security notes

- Credentials in local SQLite (openreply DB), same trust boundary as the rest of the local
  app data. File perms inherited from the app data dir.
- Manual-todo doc `docs/manual-todo/agent-reach-cookies.md` captures the one-time per-user
  steps (Cookie-Editor install, which cookie per platform, proxy env vars).
- Future hardening (out of scope): OS keychain (macOS Keychain / Tauri stronghold),
  cookie encryption at rest.

## Acceptance

- [ ] Each new source: `fetch_<name>("test")` returns posts-shaped rows or `[]`.
- [ ] Rows appear in `posts` after `collect_<name>`; selectable in app collect picker.
- [ ] `openreply_fetch_<name>` callable via MCP/CLI.
- [ ] Reddit returns full-fidelity rows (score/comments) when a cookie is connected;
      never hard-403s (falls to RSS).
- [ ] Reach Connections screen: open-login → import → verify flips badge to Connected
      for at least one platform end-to-end.
- [ ] `pytest tests/ -v` green; FEATURES.md + changelog updated.

## Commit plan (one feature = one commit, explicit paths)

1. `feat(sources): credential layer + source_credentials table`
2. `feat(sources): zero-config sources (v2ex, web_reader, xiaoyuzhou, bilibili)`
3. `feat(sources): exa_search key-gated source`
4. `feat(sources): cookie-gated sources (xiaohongshu, linkedin, xueqiu, twitter_free)`
5. `feat(reddit): tiered fetch cascade + reddit_free source + proxy`
6. `feat(app): Reach Connections screen + creds IPC (commands.rs/main.rs/api.js)`
7. `docs: changelog + FEATURES.md + manual-todo cookies guide`
