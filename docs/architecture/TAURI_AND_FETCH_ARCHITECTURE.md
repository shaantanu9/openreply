# Tauri App & Reddit/Multi‑Source Fetch — Deep Architecture Guide

> **Purpose:** A from-scratch, end-to-end explanation of (1) how the Tauri 2 desktop
> app is wired (frontend ↔ Rust ↔ Python sidecar), and (2) how subreddits and posts
> get fetched without the official Reddit API. Written so you can **reuse this
> architecture to build a social‑media content‑creation tool.**
>
> Companion to the higher-level `ARCHITECTURE.md` at repo root. This doc goes deeper
> on the two areas you asked about and adds a "how to repurpose this" section at the end.
>
> Last mapped: 2026-06-26. Citations are `path:line` against the current tree.

---

## 0. TL;DR mental model

```
┌──────────────────────────────────────────────────────────────────────┐
│  OpenReply.app   (one macOS/Win/Linux desktop binary)                    │
│                                                                        │
│  ┌────────────────┐   invoke()    ┌──────────────┐  argv + stdin/out  │
│  │  Frontend      │ ─────────────► │  Rust core   │ ─────────────────► │
│  │  vanilla JS    │ ◄───────────── │  (Tauri)     │ ◄───── NDJSON ──── │
│  │  Vite build    │  Tauri events  │  commands.rs │                    │
│  └────────────────┘                └──────────────┘                    │
│         ▲                                  │                           │
│         │                                  ▼                           │
│         │                       ┌────────────────────────┐            │
│         │                       │  Python sidecar         │            │
│         │                       │  openreply-cli (PyInstaller│            │
│         │                       │  ONEDIR) OR dev .venv   │            │
│         │                       └────────────────────────┘            │
│         │                                  │                           │
│         └──────────── SQLite (openreply.db, WAL) ◄─────────────────────── │
└──────────────────────────────────────────────────────────────────────┘
```

Three rules that explain almost everything:

1. **The Rust layer never does business logic.** Every `#[tauri::command]` is a thin
   bridge that shells out to the **same Python package** (`openreply`) — either the
   bundled `openreply-cli` binary (prod) or `.venv/bin/python -m openreply.cli.main` (dev).
   No logic is duplicated between CLI, MCP server, and desktop app.
2. **SQLite is the single shared state.** Python writes it; Rust reads it directly
   for hot paths (1 ms) and the frontend polls its mtime to know when to refresh.
3. **Reddit is fetched without the official API** via a **tier cascade**
   (PRAW → cookie `.json` → RSS), so it degrades gracefully and needs no app credentials.

---

# PART A — The Tauri App

## A1. Process model & the "command registration triangle"

A Tauri command only works if it's declared in **three** places. Miss one and the
frontend gets `command not found`:

| # | Place | File | What it does |
|---|-------|------|--------------|
| 1 | **Definition** | `app-tauri/src-tauri/src/commands.rs` | `#[tauri::command] pub async fn start_collect(...)` |
| 2 | **Registration** | `app-tauri/src-tauri/src/main.rs:353-749` | `tauri::generate_handler![start_collect, build_graph, ...]` (~200 commands) |
| 3 | **Invocation** | `app-tauri/src/api.js` | `invoke('start_collect', { topic, aggressive, ... })` |

Each command in `commands.rs` is intentionally tiny — it builds an argv vector and
hands it to one of the `run_cli*` helpers:

```rust
// app-tauri/src-tauri/src/commands.rs  (representative)
#[tauri::command]
pub async fn start_collect(app: AppHandle, topic: String, aggressive: bool) -> Result<Value, String> {
    run_cli_streaming(&app,
        vec!["research", "collect", "--topic", &topic, "--aggressive", "--json"],
        "collect:progress", "collect:done")
        .await.map_err(err_to_string)
}
```

Command families registered (see `main.rs:353-749`):
- **Research:** `start_collect`, `build_graph`, `enrich_graph`, `run_gap_discovery`, `synthesize_insights`
- **Chat:** `start_chat`, `cancel_chat`, `chat_conv_list/get/save`
- **Data:** `run_query` (native rusqlite, no sidecar), `ingest_file`, `ingest_video`, `export_html`
- **Product:** `product_create/list/signals`
- **License/BYOK:** `license_activate`, `byok_status`, `byok_set`
- **Persona agents:** `persona_agent_list/chat/teach_video`

## A2. How the Python sidecar is spawned

All spawn logic lives in **`app-tauri/src-tauri/src/cli.rs`**. There are **three
execution strategies**, tried in order of speed:

### Strategy 1 — Long-lived daemon (warm interpreter) — preferred
- Python is started **once per session** as `... daemon` and kept alive
  (`cli.rs:241-350` dev, `cli.rs:638-741` prod).
- Protocol: one JSON **request per line on stdin**, one JSON **response per line on
  stdout**. Handshake on boot: daemon prints `{"_daemon_ready": true}` (`cli.rs:315-340`).
- Timeouts: handshake `DAEMON_HANDSHAKE_TIMEOUT_SECS` (60 s, covers cold imports);
  per-request `DAEMON_REQUEST_TIMEOUT_SECS` (120 s); lock wait
  `DAEMON_LOCK_TIMEOUT_DEV_SECS=3` / `_PROD_SECS=4` (`cli.rs:388-389`).
- Why: avoids paying Python interpreter + import cost (300–2000 ms) on every call.

### Strategy 2 — One-shot subprocess (fallback) — `cli.rs:1029-1066`
- If the daemon is busy/wedged, spawn a fresh process for this one call.
- Reads full stdout, parses as JSON. On non-JSON (a Python traceback) it returns a
  sentinel `{_parse_error: true, _raw: "..."}` so the frontend shows the real error
  instead of a silent empty state.

### Strategy 3 — Streaming — `run_cli_streaming()` `cli.rs:1169-1231`
- For long jobs (collect, enrich). Spawns the process and streams **stdout line by
  line** to the frontend as Tauri events (`app.emit("collect:progress", line)`),
  scrubbing secrets first (`scrub_secrets`, `cli.rs:1125`). On exit, emits a
  `collect:done` payload `{ code, error_class, hint }`.

### Binary resolution & the dev bypass — `cli.rs:41-73, 168-188`
```
prod:  app.shell().sidecar("openreply-cli")          // PyInstaller ONEDIR, ~390 MB
dev:   walk up to 5 parent dirs for .venv/bin/python
       (override with OPENREPLY_DEV_PYTHON)
```
The dev bypass exists because a freshly-built/unsigned PyInstaller binary can hang
**2+ minutes** under macOS Gatekeeper on first spawn. In dev you run the raw `.venv`
Python instead. (This is the battle-tested pattern from the `tauri-python-sidecar-app` skill.)

### Environment injected into every spawn
- `OPENREPLY_DATA_DIR` → the app data dir (so Python writes the same SQLite the app reads)
- `PYTHONUNBUFFERED=1` → so streamed lines arrive immediately
- `OPENREPLY_FFMPEG_PATH` → bundled ffmpeg for video ingest (`build_sidecar_cmd`, `cli.rs:175-188`)

### Mutual exclusion / single-flight — `cli.rs:785-848, 1175-1194`
Tauri-managed state slots prevent two heavy jobs colliding:

| State slot | Guards |
|---|---|
| `ActiveJob` / `ActiveJobPid` | collect/enrich (prod CommandChild vs dev OS PID) |
| `ActiveChat` / `ActiveChatPid` | chat (allowed to run **in parallel** with a collect) |
| `ActiveStream` | `openreply stream` firehose |
| `ActiveEnrich` / `ActiveGraphOps` | dedup graph enrichment per topic |
| `CollectCancelMarker` | distinguishes user-cancel from real error on exit |

Starting a second collect while one runs returns
`"another collect is already running. Cancel it first."`

## A3. Tauri config, capabilities & security

`app-tauri/src-tauri/tauri.conf.json`:
- **`externalBin`** (`:82-88`): `binaries/openreply-cli`, `binaries/ffmpeg`.
  **`resources`**: `binaries/openreply-cli-onedir/**/*` (ONEDIR avoids per-spawn temp
  extraction that ONEFILE suffers).
- **`assetProtocol.scope`** (`:54-65`): whitelists `$APPDATA/openreply/**`,
  `$APPLOCALDATA/paper_pdf_cache/**`, etc. — required for `fetch(asset://…)` to read
  bundled/generated files (PDFs, exports).
- **CSP** (`:41-53`): `default-src 'self'`; `connect-src` whitelists the exact
  outbound hosts (Reddit, arXiv, OpenAlex, Anthropic, OpenAI, Ollama).
- **`capabilities/default.json`**: restricts shell execution to the `openreply-cli`
  binary only and whitelists the ~50 event names the frontend listens to.

## A4. The frontend (vanilla JS + Vite)

- **Entry:** `app-tauri/index.html` (`.app` grid: sidebar | main) → loads
  `app-tauri/src/main.js`.
- **Routing:** hash-based. `main.js:62-125` maps `window.location.hash` →
  `renderXxx(main, ctx)`. 50+ routes: `/` home, `/topics`, `/topic/...`,
  `/collect/...`, `/research-home`, `/audience`, `/chat`, `/settings`, `/why/...` (the
  per-page explainer/tour system), product/discovery screens.

### The API layer — `app-tauri/src/api.js` (the most important frontend file)
This wraps **every** `invoke()` with four behaviors:

1. **In-flight dedup + TTL cache** (`cachedInvoke`, `:1-100`): identical calls share
   one promise; results memoized (default 5 s; `cli_info` 30 s, `byok_status` 60 s).
   Caps at 200 entries, evicts oldest 25%. Stops sidebar "pogo-sticking" from
   re-spawning sidecars.
2. **localStorage SWR** (cross-session): heavy build outputs (`get_findings`,
   `product_signals`, framework outputs) cached 7 days → instant first paint.
3. **Timeout wrapper** (`invokeWithTimeout`, `:140`): default 90 s, overridable per
   call via `{ __timeoutMs }` (LLM calls pass `300_000`).
4. **Parse-error surfacing** (`throwIfParseError`): turns the `_parse_error` sentinel
   into a thrown JS error with the raw Python traceback.

**Cache invalidation** (`mutated()`, `:351-375`): after any write, `INVALIDATE_MAP`
clears the affected read keys (memory + localStorage) and dispatches a
`openreply:changed` event so open screens refresh.

**Freshness poller** (`:377-430`): every 5 s (and on tab focus) calls the cheap
`db_mtime` command; if the SQLite mtime changed (e.g. MCP server or background CLI
wrote it), it clears the cache and fires `openreply:db-changed`.

### Receiving streamed results
Screens subscribe to Tauri events through thin `api.onXxx` wrappers:
```js
api.onCollectProgress(line => renderLine(line));   // listen('collect:progress')
api.onCollectDone(({code, error_class, hint}) => ...);
api.onEnrichProgress / onChatProgress / onFleetProgress / onAcademicProgress
```
Some streams are **NDJSON with a sentinel** (`{"__fleet": "stage", "data": {...}}`) so
log lines and structured progress travel the same channel and are disambiguated by the
`__fleet` / `__academic` key.

## A5. Data layer

- One SQLite file, **`openreply.db`** (WAL mode), in the data dir:
  - macOS `~/Library/Application Support/openreply/` · Linux `~/.local/share/openreply/` ·
    Windows `%APPDATA%\openreply\`
- **Rust reads it directly** for hot paths via `app-tauri/src-tauri/src/db.rs`
  (`query_db()`, `:1-136`) — read-only WAL connection, `:named`/`?1` params, rows →
  JSON. ~1–10 ms vs 300–2000 ms through the sidecar. Used by `run_query`,
  `topic_insights_cached`, `hypothesis_list_native`.
- **Chat conversations** are fully owned by Rust (read+write), `db.rs:138-200`, so chat
  persistence keeps working even mid-collect (2 s busy_timeout for WAL contention).

## A6. End-to-end: "Start collect" click

```
collect.js → api.startCollect(topic, true)
  → invoke('start_collect', {topic, aggressive:true})        [api.js: timeout+mutate]
    → commands.rs::start_collect  builds argv
      → cli.rs::run_cli_streaming  (single-flight check)
        → spawn  openreply research collect --topic … --aggressive --json
          env OPENREPLY_DATA_DIR, PYTHONUNBUFFERED=1
        → each stdout line → app.emit("collect:progress", scrub(line))
      → on exit → app.emit("collect:done", {code, error_class, hint})
  ← collect.js renders lines live; freshness poller sees openreply.db mtime change → refresh
```

---

# PART B — How subreddits & posts get fetched

The whole point: **no official Reddit API key is required.** The system reaches Reddit
through public JSON endpoints (optionally with a stored session cookie) and falls back
to RSS. Everything is **fail-soft** — a failure degrades to a weaker tier rather than
throwing.

## B1. The tier cascade — `src/openreply/fetch/_reddit_tiers.py:1-104`

```
run_cascade([ ("praw",   _fetch_auth),      # Tier 1: official API IF creds configured
              ("cookie", cookie_posts),     # Tier 2: public .json + session cookie
              ("rss",    _fetch_public) ])  # Tier 3: RSS (titles/bodies, no scores)
→ tries each in order, first NON-EMPTY result wins, returns (rows, tier_name)
→ never raises
```

- **Tier 1 PRAW** — only when `config.mode == "auth"` (Reddit OAuth creds present).
  Factory: `core/client.py:get_reddit()`.
- **Tier 2 Cookie** — the default real path. `_cookie_get(path, params, cookie)`
  (`_reddit_tiers.py:60-68`) hits Reddit's `.json` endpoints with a custom User-Agent,
  optional `REDDIT_PROXY`, 20 s timeout, and parses `data.data.children[].data`.
  - `cookie_posts(sub, sort, limit, time_filter)` → `/r/{sub}/{sort}.json`
    (sort ∈ hot/new/top/rising/controversial; `time_filter` applies to top/controversial).
  - `cookie_search(query, sub, sort, time_filter, limit)` → `/search.json` or
    `/r/{sub}/search.json` with `restrict_sr` when sub-scoped.
- **Tier 3 RSS** — `core/public_client.py` public path; titles/bodies only, no scores.

## B2. The free-fetch shortcut — `src/openreply/sources/reddit_free.py:1-91`

`fetch_reddit_free(query, sub=None, limit=50)` (`:67`):
1. Looks up `creds.cookie_header("reddit")` → the stored `reddit_session` cookie.
2. Cookie present → `_authed_search()` hits `/search.json` (`restrict_sr=1` if scoped,
   `raw_json=1`), 20 s timeout, optional proxy.
3. Cookie missing / auth fails → falls back to `public_search()` (RSS). Never raises.

**Post row shape** (`_row()`, `:44-64`) — this is the canonical content record the whole
app speaks in:
```json
{
  "id": "...", "sub": "...", "source_type": "reddit_free",
  "author": "...", "title": "≤300 chars", "selftext": "≤4000 chars",
  "url": "...", "score": 0, "upvote_ratio": 0.0, "num_comments": 0,
  "created_utc": 0.0, "is_self": true, "over_18": false,
  "flair": "...", "permalink": "...", "fetched_at": "ISO-8601"
}
```

## B3. Subreddit discovery — `src/openreply/research/discover.py:302-424`

`discover_subs(topic, limit=10)` turns a free-text topic into a ranked list of subs:

1. **Canonicalize the topic** (`_canonicalize_topic`, `:199-299`):
   - Cache lookup in `topic_canonicalizations` table; on miss, ask the LLM.
   - LLM returns JSON: `{ canonical, variants[], confidence, search_keywords:[{keyword, relevance}] }`
     (prompt at `:67-94`). Defensive JSON parse (strips markdown fences/prose).
   - `warm_llm()` (`:177-196`) fires a tiny completion at app start to absorb
     Ollama/serverless cold-start.
2. **Multi-phase search** against `/subreddits/search.json`:
   - Phase 1 canonical topic · Phase 2 high+medium expanded keywords · Phase 3 single-token fallback.
   - Union into a case-insensitive `seen` map.
3. **Rank** (`:367-371`): public, non-NSFW, ≥1000 subscribers; score =
   `log10(subscribers) + relevance_bonus` (name match +1.5, description match +0.4).
4. **Return** each sub: `{ name, title, subscribers, description(≤200), url, relevance }`,
   plus a confirmation payload `{ auto_corrected, needs_confirmation, reason }` where
   `reason ∈ direct_match | high_confidence_typo_correction | low_confidence_canonicalization | weak_sub_relevance | canonicalization_unavailable`.

## B4. The collect orchestrator — `src/openreply/research/collect.py:318-650+`

`collect(topic, subs=None, ...) -> CollectResult` runs **three Reddit phases** plus a
parallel external-source fan-out.

```
Reddit phases
─────────────
1. subs = subs or discover_subs(topic, 10)["subs"]
2. TOP posts per sub:  fetch_posts(sub, sort="top", time_filter="month")  +  ("year")
                       limit_per_sub = 50 (100 if aggressive)
3. SEARCH fan-out:    _build_search_worklist(:97-131) round-robins keywords ×
                       categories {pain, features, complaints, diy}
                       budget OPENREPLY_MAX_SEARCH_QUERIES=24, OPENREPLY_SEARCH_WORKERS=4,
                       1 s politeness/req → search_reddit(query, sub)
4. (optional) HISTORICAL backfill via PullPush (pre-May-2025):
                       fetch_historical(sub, "submission", days, limit)
                       aggressive→730 d/150 per sub; deep→1095 d/1000 per sub

External sources (parallel)
───────────────────────────
OPENREPLY_PARALLEL_SOURCES=10 threads, OPENREPLY_SOURCE_TIMEOUT_SEC=240
HN, arXiv, GitHub, StackOverflow, Dev.to, App/Play Store, Google News, PubMed,
OpenAlex, Trustpilot, ProductHunt, RSS bundles, Trends, YouTube, DuckDuckGo, …
errors captured per-source; one flaky provider never blocks the rest
```

**Tagging & persistence** (`_tag_posts`, `:188-309`):
- Semantic relevance gate (embedder, threshold ~0.28); optional strict quality gate.
- Upsert `posts` → junction `topic_posts(topic, post_id, source, added_at)`.
- Enqueue into `extraction_queue` for async LLM enrichment (composite PK = no dupes on reruns).

`CollectResult` (`@dataclass`): `{ topic, subs[], posts_fetched, by_source{}, errors[] }`.

### Preset modes
| Mode | Sources | Reddit | Historical | Time |
|---|---|---|---|---|
| default (fast) | ~10 baseline | discovery + top + search | off | ~2–3 min |
| `--aggressive` | 18–20 sweep | + max limits | 730 d | 10–30 min |
| `--aggressive --deep` | 18–20 | 1000/sub | 1095 d | longest |

## B5. Two-phase collect (keeps the UI instant) — `app-tauri/src/lib/redditEnrich.js:1-90`

Reddit's full pass takes ~15 min, which would block the graph. So the frontend splits it:

- **Phase 1 (foreground, ~2–3 min):** run external sources with `skip_reddit=ON`; the
  enrich worker builds the graph immediately → user sees results fast.
- **Phase 2 (background, ~15 min):** `markRedditPending(topic, opts)` stores a flag in
  `localStorage` (`openreply.collect.reddit_pending::{topic}`), shows a non-blocking banner,
  then reruns `startCollect()` Reddit-only; posts fold into the graph incrementally.

## B6. Rate limiting, caching, error handling

- **Politeness:** 2 s between Reddit JSON calls, 1 s in the search phase; httpx respects HTTP 429.
- **Caching:** session cookie in `source_credentials`; embedder model kept in RAM; LLM
  canonicalizations cached in `topic_canonicalizations`; `extraction_queue` dedups work.
- **Fail-soft chain:** PRAW→cookie→RSS; discovery skips failed keyword queries; no
  embedder → ungated; no LLM → use typed topic verbatim. Every fetch is audited in the
  `fetches` table (`kind, params_json, started_at, ended_at, rows, error`).

## B7. The fetch surface (CLI + MCP)

**CLI** (`src/openreply/cli/main.py`):
| Command | Args |
|---|---|
| `openreply fetch posts` | `--sub --sort --limit --time` |
| `openreply fetch comments` | `--post --depth --limit` |
| `openreply fetch sub-comments` | `--sub --limit --save` |
| `openreply fetch historical` | `--sub --kind --days --limit` |
| `openreply fetch user` | `--name --kind --limit` |
| `openreply search` | `--query --sub --sort --time --limit` |
| `openreply stream` | `--sub --keywords --watch --name` |
| `openreply research discover` | `--topic --limit` |
| `openreply research canonicalize` | `--topic` |
| `openreply research collect` | `--topic --subs --per-sub --per-query --categories --historical --sources --aggressive --deep --skip-reddit --skip-extraction` |

**MCP** (`src/openreply/mcp/server.py`): `openreply_fetch_posts/comments/user/search`,
`openreply_sub_stats`, `openreply_discover_subs`, `openreply_collect`, `openreply_fetch_reddit_free`.
`openreply_sub_stats` returns `{ sub, posts_stored, avg_score, avg_comments, max_score,
first/last_post_utc, top_authors[] }`.

---

# PART C — The wider data engine (context)

## C1. ~61 source adapters, one contract — `src/openreply/sources/collect_adapter.py`
Every source is a module-level `run_<source>(topic_or_keywords, **opts) -> int` that
persists to `posts` and returns a count. No dynamic registry — the active list is
explicit in `research/collect.py`. Categories: social/community (reddit, lemmy,
mastodon, bluesky, threads, x, tiktok, instagram, truthsocial, bilibili, xiaohongshu,
v2ex), product/reviews (appstore, playstore, trustpilot, producthunt, alternativeto),
news/trends (hn, gnews, trends, devto), academic (arxiv, pubmed, scholar,
semantic_scholar, openalex, crossref, dblp, europepmc), code/Q&A (stackoverflow,
stackexchange×8, github_trending, github_issues, duckduckgo, exa, tavily), market/econ
(worldbank, fred, bis, yfinance, openmeteo, polymarket), plus rss bundles, youtube,
gdelt, acled, linkedin, wikipedia, steam, npmstats, discourse.

## C2. Credentials / Reach Connections — `src/openreply/core/credentials.py`
Table `source_credentials(source PK, cookie_json, username, kind, saved_at,
last_verified_at)`. Helpers: `get_credential`, `set_credential`, `mark_verified`,
`cookie_header(source)` → `Cookie: k=v; …`, `api_key(source)`. Flow: the app captures a
browser login's cookies → `set_credential(...)` → a source-specific `verify_*()` stamps
`last_verified_at` → adapters read the cookie/key at fetch time. This is how
cookie-gated sources (x, linkedin, xueqiu, xiaohongshu, bilibili) authenticate.

## C3. Analysis → output pipeline
`collect → canonicalize/tag → find_gaps (4 LLM extractors: painpoints/features/
complaints/diy) → graph build+enrich (MiniLM ONNX semantic edges) → export
(markdown brief, PPTX deck, DOCX)`. Owners: `research/gaps.py`, `research/insights.py`,
`graph/*`, `research/export_*`.

---

# PART D — Repurposing this for a social‑media content‑creation tool

You already have, for free, the hardest 70%: a cross-platform desktop shell, a
warm-Python sidecar bridge with streaming, a resilient multi-platform **ingestion**
layer, cookie-based **auth per platform**, an LLM provider abstraction, and a local
SQLite store. A content-creation tool is mostly **adding an outbound (publish) half**
to this inbound (fetch) engine.

## D1. What to reuse as-is
| Need | Reuse |
|---|---|
| Desktop shell, packaging, updates | `app-tauri/` Tauri 2 + ONEDIR sidecar (`tauri.conf.json`, `cli.rs`) |
| Per-platform auth (X, IG, LinkedIn, TikTok…) | `source_credentials` + Reach Connections cookie capture |
| Pull trends/competitor content to ideate from | the ~61 fetch adapters + `discover_subs`/`collect` |
| LLM generation (captions, hooks, scripts) | `analyze/providers/*` (8 providers, auto-resolved) |
| Streaming long jobs to a responsive UI | `run_cli_streaming` + `collect:progress` event pattern |
| Local persistence, instant reads | `openreply.db` (WAL) + native rusqlite read path (`db.rs`) |

## D2. What to add (the outbound half)
1. **A `publish/` package in Python**, mirroring `sources/` but for posting:
   `publish/<platform>.py` each exposing `post_<platform>(content, media, creds) -> dict`.
   Reuse `credentials.cookie_header()/api_key()` exactly as the fetch adapters do.
   Start with API-based platforms (X API, LinkedIn API, Meta Graph for IG/FB) before
   cookie-only ones.
2. **A content model in SQLite**: `drafts(id, body, platforms_json, media_json, status,
   scheduled_at, created_at)`, `publish_log(draft_id, platform, posted_at, remote_id,
   error)`. Follow the `posts`/`fetches` upsert + audit pattern in `core/db.py`.
3. **CLI commands** under a new `content` Typer group: `content draft`, `content
   generate --from-topic`, `content schedule`, `content publish` — so the same surface
   is callable from CLI, MCP, and the desktop app (the triangle in A1).
4. **Tauri commands + screens**: a "Composer" screen (multi-platform preview), a
   "Calendar/Queue" screen (driven by `scheduled_at`), and a "Connections" screen
   (already mostly built as Reach Connections). Add `start_publish`/`publish_status`
   streaming commands following A2/A6.
5. **Scheduling**: reuse the existing `research schedule-enable/tick` pattern
   (`cli/main.py`) — a `content schedule-tick` that the app calls on a timer to fire due
   drafts. For background firing while the app is closed, see the `postiz` skill.

## D3. Generation loop (ideate → draft → schedule → publish)
```
1. INGEST   collect(topic) or discover_subs(topic)   → real audience language in `posts`
2. IDEATE   find_gaps + LLM over top posts            → angles/hooks that resonate
3. DRAFT    providers.complete(prompt, system)        → platform-tuned captions/threads
4. PREVIEW  Composer screen renders per-platform      → human edit
5. SCHEDULE write `drafts` row with scheduled_at      → Calendar screen
6. PUBLISH  publish/<platform>.post_*(creds)          → publish_log + remote_id
7. MEASURE  reuse fetch adapters to pull back metrics → close the loop
```

## D4. Relevant skills already installed
- **`postiz`** — social scheduling/publishing patterns (the closest prior art for D2/D5).
- **`meta-ads-app-launch`** + the `Meta_ads_mcp` tools — IG/FB publishing & boosting.
- **`tauri-python-sidecar-app`** — the canonical patterns for everything in Part A
  (invoke this before touching `cli.rs`/`tauri.conf.json`).
- **`fastmcp-app-integration`** — to expose the new `content` commands as MCP tools.

## D5. First milestone (smallest end-to-end slice)
Wire **one** platform with an official API (X is simplest): add
`publish/x.py::post_tweet`, a `content publish --platform x --draft <id>` CLI command,
register a `start_publish` Tauri command, and a minimal Composer screen that calls it
and listens for `publish:done`. That proves the outbound path through all three layers
before you fan out to more platforms and scheduling.

---

## Appendix — key files

```
app-tauri/
  index.html                         frontend shell (sidebar + main grid)
  src/main.js                        hash router → renderXxx
  src/api.js                         invoke wrapper: cache, dedup, timeout, invalidation, poller
  src/lib/redditEnrich.js            two-phase collect (foreground externals / background reddit)
  src-tauri/src/main.rs              generate_handler![] command registration (:353-749)
  src-tauri/src/commands.rs          thin #[tauri::command] bridges
  src-tauri/src/cli.rs               sidecar spawn: daemon / one-shot / streaming (:41-1242)
  src-tauri/src/db.rs                native rusqlite reads + chat read/write
  src-tauri/tauri.conf.json          externalBin, resources, CSP, assetProtocol scope
  src-tauri/capabilities/default.json  shell + event permissions

src/openreply/
  cli/main.py                        Typer entry: fetch / research / mcp / auth / ingest / feeds
  sources/reddit_free.py             cookie/RSS free fetch (:1-91)
  sources/collect_adapter.py         ~61 run_<source>() adapters
  sources/source_families.py         family rollups
  fetch/_reddit_tiers.py             PRAW→cookie→RSS cascade (:1-104)
  fetch/posts.py · comments.py · search.py · users.py · historical.py · stream.py
  research/discover.py               discover_subs + _canonicalize_topic (:199-424)
  research/collect.py                collect() orchestrator (:318-650+)
  research/gaps.py · insights.py     4-extractor gap analysis
  core/credentials.py                source_credentials store (Reach Connections)
  core/db.py                         SQLite schema + upserts (WAL, retry-on-locked)
  core/public_client.py · core/client.py   RSS public path · PRAW factory
  analyze/providers/*                8 LLM providers, auto-resolved
  mcp/server.py                      FastMCP tool registry
```
