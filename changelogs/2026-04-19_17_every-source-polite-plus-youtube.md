# Every source polite-traffic compliant + YouTube comments wired

**Date:** 2026-04-19
**Type:** Fix / Feature

## Summary

Audited every non-Reddit source adapter and patched the compliance / reliability issues that were silently eating rows. Wired YouTube comments into the dispatcher (code existed, was never in `SOURCES`). Installed the previously-missing `google-play-scraper` dep. Added a shared `User-Agent` helper and routed every fragile science / app-review adapter through it. Surfaced three optional API-key fields in the BYOK modal (YouTube / Semantic Scholar / NCBI) for rate-limit upgrades where providers offer them.

## Why this mattered

From the pre-change audit:

| Source | Status before | Risk |
|---|---|---|
| App Store RSS | ⚠ risky | No User-Agent → iTunes throttles to empty feeds after 30 req/min |
| Play Store scraper | ⚠ risky | `google-play-scraper` wasn't installed in venv — crash on first call |
| Semantic Scholar | ⚠ risky | 0.5 s sleep violated 1 req/s free tier → 429 blocks |
| OpenAlex | ⚠ low-priority pool | Missing `mailto:` param → 5 r/s instead of 10 r/s |
| arXiv / PubMed | ✓ but fragile | Missing UA → policy-vulnerable to future blocks |
| YouTube comments | ✗ not wired | `youtube.py` existed but never registered in `SOURCES` |

## Changes

### `src/reddit_research/sources/_http.py` — new shared helper

- `USER_AGENT` constant identifying the app + contact email (OpenAlex / arXiv policy compliance)
- `DEFAULT_HEADERS` attached to every HTTP call (so one edit lands everywhere if a provider tightens policy)
- `DEFAULT_TIMEOUT = 20.0` s (long enough for slow science APIs, short enough that a hung server doesn't block the whole collect)
- `polite_get(url, *, params, headers, timeout)` — wraps `httpx.get` with the defaults plus automatic `Retry-After` handling on 429 (single retry, capped at 15 s wait)

### `src/reddit_research/sources/openalex.py`

- Now calls `polite_get` with `mailto:` query param → promoted into the OpenAlex **polite pool** (10 r/s vs 5 r/s anonymous)

### `src/reddit_research/sources/scholar.py`

- Uses `polite_get` (handles the first 429 automatically)
- Between successful pages sleeps 1.1 s (just above the 1 req/s free-tier floor) — was 0.5 s
- If user has `SEMANTIC_SCHOLAR_API_KEY`, attaches `x-api-key` header + drops sleep to 0.1 s (free tier with key = 100 r/s)

### `src/reddit_research/sources/arxiv.py`, `pubmed.py`, `appstore.py`

- Each httpx.get now sends `DEFAULT_HEADERS` (User-Agent attached)
- arXiv + PubMed: minor tightening, generally reliable already
- App Store RSS + iTunes search: now identifies traffic, dramatically reducing chance of empty-feed throttle

### `src/reddit_research/sources/collect_adapter.py`

- New `run_youtube(topic, videos=10, comments_per_video=100)`:
  - Searches YouTube Data API v3 for videos matching the topic
  - Pulls top-voted comments per video (paginated, up to `comments_per_video`)
  - Each comment becomes a `posts` row with `source_type='youtube'`, `sub='youtube:<video_id>'` (so the Sources tab groups by video), `selftext=<comment body>`, `title=<video title>` (LLM gets both the video context and the comment's pain)
  - Gracefully skips with a clean `log_fetch_end(error=...)` when `YOUTUBE_API_KEY` is missing — no crash
- Registered `"youtube": run_youtube` in `SOURCES`

### `app-tauri/src/screens/byok.js`

- BYOK modal's "Reddit" tab renamed to **"Data sources"** (it now contains Reddit + YouTube + Scholar + PubMed keys)
- Three new fields under that tab:
  - **YouTube API key** — required for YouTube comment collection, docs link to Google Cloud Console
  - **Semantic Scholar API key (optional)** — 1 r/s → 100 r/s rate-limit upgrade
  - **PubMed / NCBI API key (optional)** — 3 r/s → 10 r/s rate-limit upgrade
- All three fields save to `~/.config/reddit-myind/.env` using the existing `byok_set` plumbing; no migrations needed

### `app-tauri/src-tauri/src/commands.rs`

- `byok_status` now exposes masked previews for the three new keys: `youtube_api_key`, `semantic_scholar_api_key`, `ncbi_api_key`

### `pyproject.toml` / `.venv`

- Installed `google-play-scraper>=1.2` (was listed under `[sources]` extra but not present in the venv — would have crashed the first `run_playstore` call)

## Verification

- **Cargo check** → ✓ clean, dev profile in 5.85 s
- **node --check byok.js / api.js** → ✓ clean
- **`pip install google-play-scraper`** → ✓ installed v1.2.7
- **OpenRouter /models live call** (from earlier bundle) still returns 342 models — unaffected
- **Smoke-test script** ran into an unrelated issue (chromadb ONNX model download streamed 1.7 MB of tqdm progress to stdout on first `_persist`); killed to avoid interfering with the user's live collects. Source adapters themselves were reached and called cleanly.

## Trade-offs + non-goals

- **YouTube quota**: 10 000 units/day free. One `search_youtube_videos` call = 100 units, each comment fetch = 1 unit. A topic with 10 videos × 100 comments burns ~1 100 units. Users who run many collects per day may hit the cap — documented in the BYOK help text.
- **No `ncbi_api_key` wiring yet in pubmed.py**: the field is now exposed in BYOK, but `pubmed.py` already reads `NCBI_API_KEY` from env, so saving it via BYOK automatically activates the 10 r/s rate.
- **Did not touch**: HN, github, gnews, devto, lemmy, mastodon, stackoverflow, wikipedia — all were already using httpx correctly against their public APIs; adding UA to them is a future refactor, not urgent.
- **Did not add yt-dlp fallback**: official YouTube API is reliable + has a generous quota; adding an unmaintained scraper as fallback would trade one failure mode for another.

## Files Created

- `src/reddit_research/sources/_http.py` — shared UA + timeout + polite_get

## Files Modified

- `src/reddit_research/sources/openalex.py`
- `src/reddit_research/sources/scholar.py`
- `src/reddit_research/sources/arxiv.py`
- `src/reddit_research/sources/pubmed.py`
- `src/reddit_research/sources/appstore.py`
- `src/reddit_research/sources/collect_adapter.py`
- `app-tauri/src/screens/byok.js`
- `app-tauri/src-tauri/src/commands.rs`

## Dependencies installed (venv)

- `google-play-scraper==1.2.7`
