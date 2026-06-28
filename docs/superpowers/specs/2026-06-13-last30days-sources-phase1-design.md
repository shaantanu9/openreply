# Phase 1 — Port last30days source layer into OpenReply (reddit-myind)

**Date:** 2026-06-13
**Status:** Design approved, pending spec review
**Owner:** shaantanu98
**Reference codebase:** `/Users/shantanubombatkar/Documents/GitHub/fintech_repos/last30days-skill`

## Background

`last30days` is a multi-source social-research engine scored by engagement.
OpenReply already has ~50 source adapters and an MCP/collect pipeline, so most of
`last30days` would duplicate existing capability. This is the first of three
phases that bring its *unique* value into OpenReply:

- **Phase 1 (this spec):** add the 8 source families OpenReply lacks, wired into
  the existing `collect` + MCP pipeline, key-gated, configurable from both
  `.env` and the frontend Settings BYOK modal, and gracefully skipped when a
  key/binary is absent.
- **Phase 2 (later spec):** entity-resolution pre-research brain + engagement /
  "Best Takes" scoring + cross-source cluster merge.
- **Phase 3 (later spec):** the "last 30 days" recency-brief experience in the
  Tauri UI + ELI5 mode + shareable HTML export.

This spec covers **Phase 1 only**.

## Goal

Add these sources as native OpenReply adapters (rewritten to OpenReply conventions,
behavior ported from the cited `last30days` modules — not vendored):

| Source | Auth / key | Cost | last30days reference |
|---|---|---|---|
| **Polymarket** | none (public) | Free | `lib/polymarket.py` |
| **TikTok** | `SCRAPECREATORS_API_KEY` | 100 free, then PAYG | `lib/tiktok.py` |
| **Instagram** (Reels) | `SCRAPECREATORS_API_KEY` | same key | `lib/instagram.py` |
| **Threads** | `SCRAPECREATORS_API_KEY` | same key | `lib/threads.py` |
| **Pinterest** | `SCRAPECREATORS_API_KEY` | same key | `lib/pinterest.py` |
| **TruthSocial** | `TRUTHSOCIAL_TOKEN` (bearer) | Free | `lib/truthsocial.py` |
| **Digg** | none — needs `digg-pp-cli` on PATH | Free | `lib/digg.py` |
| **X / Twitter** | multi-backend resolution chain (below) | Free → PAYG | `lib/cookie_extract.py`, `lib/bird_x.py`, `lib/xai_x.py`, `lib/xquik.py` |

### X / Twitter — multi-backend resolution chain ("add all")

A single `fetch_x(query, limit)` resolves a working backend in priority order,
skipping each step if its prerequisite is absent:

1. **Cookie extraction** (`cookie_extract.py`, stdlib only): if `AUTH_TOKEN` /
   `CT0` are not already set, attempt to extract them from local browser
   cookie stores (Safari / Chrome / Brave / Firefox). Populates the env for
   step 2.
2. **Bird** (`bird_x.py`): if `AUTH_TOKEN` (+`CT0`) present **and** Node.js is
   on PATH, run the vendored `bird-search.mjs` GraphQL client. Endpoint:
   Twitter GraphQL via x.com.
3. **xAI** (`xai_x.py`): if `XAI_API_KEY` present, call
   `https://api.x.ai/v1/responses` (pure httpx, live X search).
4. **Xquik** (`xquik.py`): if `XQUIK_API_KEY` present, call
   `https://xquik.com/api/v1` (pure httpx, full engagement metrics).

If none resolve, `fetch_x` returns `[{"_error": "no X backend available — set "
"AUTH_TOKEN/CT0, XAI_API_KEY, or XQUIK_API_KEY, or log into x.com in a local "
"browser"}]`, which the pipeline filters out (graceful skip).

## Architecture & conventions

Every adapter follows the existing OpenReply source contract (confirmed against
`sources/producthunt.py`, `sources/_http.py`, `sources/collect_adapter.py`):

1. **Module:** `src/openreply/sources/<name>.py` exposing `fetch_<name>(query,
   limit)` (X uses `fetch_x`). Pure-httpx sources use `sources/_http.py`
   helpers (`polite_get`, `USER_AGENT`, `DEFAULT_TIMEOUT`).
2. **Output:** the common posts-row dict — `id, sub, source_type, author,
   title, selftext, url, score, upvote_ratio, num_comments, created_utc,
   is_self, over_18, flair, permalink, fetched_at`.
3. **Key gating:** read keys via `os.getenv`. Missing key/binary → return
   `[{"_error": "<actionable message>"}]`. No exceptions thrown, no blocking.
4. **Registration:** add a `run_<name>` wrapper in `collect_adapter.py`
   following the `log_fetch_start → loop keywords → _persist → log_fetch_end`
   pattern; register it in the `SOURCES` dict. Export `fetch_<name>` from
   `sources/__init__.py`.
5. **Vendoring (X/bird only):** copy the MIT-licensed `bird-search` Node client
   into `src/openreply/sources/vendor/bird-search/`, preserving its `package.json`
   + LICENSE. This is the one non-Python dependency; it self-skips when Node is
   absent.

### posts-row mapping per source

- **Polymarket:** `title` = market question; `score` = volume (int); `selftext`
  = outcomes + `%` odds; `source_type` = `polymarket`; `url` =
  `polymarket.com/event/<slug>`. Common-word disambiguation ported from
  `relevance.LOW_SIGNAL_QUERY_TOKENS`.
- **TikTok / Instagram:** `title` = caption (first line); `selftext` = full
  caption (+ transcript when fetched); `score` = likes; `num_comments` =
  comments; `flair` = `views=<n>`; `source_type` = `tiktok` / `instagram`.
- **Threads:** `selftext` = post text; `score` = likes; `num_comments` =
  replies; `source_type` = `threads`.
- **Pinterest:** `title` = pin title; `selftext` = description; `flair` =
  `saves=<n>`; `source_type` = `pinterest`.
- **TruthSocial:** `selftext` = HTML-stripped content; `score` = favourites;
  `source_type` = `truthsocial`.
- **Digg:** one row per story cluster; `title` = cluster headline; `selftext` =
  TLDR + top X-post quotes; `source_type` = `digg`.
- **X:** `author` = `@handle`; `selftext` = tweet text; `score` = likes;
  `num_comments` = replies; `source_type` = `x`.

## Key configuration (env + frontend, graceful skip)

New BYOK keys to wire end-to-end: `SCRAPECREATORS_API_KEY`, `TRUTHSOCIAL_TOKEN`,
`AUTH_TOKEN`, `CT0`, `XAI_API_KEY`, `XQUIK_API_KEY`. (Polymarket & Digg need
none.)

- **Rust (`app-tauri/src-tauri/src/commands.rs`):** add the 6 keys to the
  `ALLOWED` allowlist in `byok_set`, and add masked entries to the `byok_status`
  JSON (reuse the existing `mask` helper). No new commands needed — the existing
  read/write/0600-perms/process-env-mirror logic covers them.
- **Frontend (`app-tauri/src/screens/settings.js`):** add input rows in the
  BYOK modal "Reddit + sources" tab — masked field, "skip if empty" hint, and a
  "Get a key" link per provider (ScrapeCreators, xAI, Xquik; TruthSocial =
  browser-token instructions; X cookies = "log into x.com" note).
- **Graceful skip:** missing key → `_error` row → filtered → source contributes
  nothing, silently. The UI source picker shows a small "needs key" badge for
  un-configured keyed sources.

## UI source picker

All 8 must appear in the collect source picker (OpenReply has hidden sources
before — e.g. Steam/Bluesky were registered but not surfaced). Add the new
`source_type` values to: the picker list, `source_families.py` display labels,
and the JS-side source label/`postLink.js` map where applicable.

## Out of scope (Phase 1)

Entity-resolution brain, engagement/"Best Takes" scoring, cross-source cluster
merge, recency-brief UI, ELI5, shareable HTML. Those are Phases 2 & 3.

## Testing & verification

- **Unit test per adapter** (mocked HTTP / mocked `subproc` for Digg & bird):
  assert posts-row shape on a fixture success response **and** clean
  `_error`/empty list on missing-key / missing-binary. Mirror the existing
  `tests/` source tests.
- **Registration test:** every new source id resolves in `SOURCES` and appears
  in the picker list.
- **Manual end-to-end in the running app:** collect one topic with keys set
  (real fetch lands rows) and one with keys unset (graceful skip, no crash,
  badge shows). Verify via the Tauri dev app.
- **Repo rules:** add a `changelogs/` entry; run `codegraph sync` +
  `graphify update .` before the final commit.

## Risks / decisions

- **Node dependency for bird X backend:** the PyInstaller sidecar does not
  bundle Node. Bird self-skips when Node is absent; the xAI / Xquik httpx
  backends and cookie-extracted bird path cover the no-Node case. Documented,
  not blocking.
- **ScrapeCreators billing:** four sources share one paid key. Keep them
  opt-in in the picker and show the "100 free credits then PAYG" note so users
  aren't surprise-billed.
- **TruthSocial / X token longevity:** browser-derived tokens expire; the
  `_error` message tells the user how to refresh. No silent stale-token hangs
  (honor existing per-source timeout budget `OPENREPLY_SOURCE_TIMEOUT_SEC`).
- **Cookie extraction & OS permissions:** Safari cookie DB may require Full Disk
  Access; extraction failure is non-fatal (falls through to key-based backends).

## Build order (for the implementation plan)

1. Pure-httpx, no-key sources first (Polymarket) — proves the adapter+register+
   picker+test loop end-to-end with zero credentials.
2. ScrapeCreators family (TikTok, Instagram, Threads, Pinterest) — one key, four
   adapters sharing request helpers.
3. TruthSocial (token), Digg (CLI gate).
4. X multi-backend chain + vendored bird client (most complex; last).
5. BYOK Rust + frontend Settings wiring + UI picker surfacing (cross-cutting).
6. Tests, changelog, codegraph/graphify sync.
